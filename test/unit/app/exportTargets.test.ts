import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import { configureExportTargets } from '../../../src/extension-backend/app/exportTargets';
import { SECRET_KEYS } from '../../../src/extension-backend/app/credentials';
import type { UserConfigStore } from '../../../src/extension-backend/app/UserConfigStore';
import type { ExportConfig, UserConfig } from '../../../src/extension-backend/domain/types';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const win = vscode.window as Mutable<typeof vscode.window>;

function makeUserConfig(exportCfg: ExportConfig = {}) {
  let current: Partial<UserConfig> = { export: exportCfg };
  return {
    patches: [] as Partial<UserConfig>[],
    get: () => current as UserConfig,
    set: async function (this: { patches: Partial<UserConfig>[] }, patch: Partial<UserConfig>) {
      this.patches.push(patch);
      current = { ...current, ...patch };
    },
  };
}

function makeSecrets() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k),
    set: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  };
}

describe('configureExportTargets', () => {
  const orig = {
    quickPick: win.showQuickPick,
    inputBox: win.showInputBox,
    info: win.showInformationMessage,
  };
  afterEach(() => {
    win.showQuickPick = orig.quickPick;
    win.showInputBox = orig.inputBox;
    win.showInformationMessage = orig.info;
  });

  it('adds a webhook target with validated name and https URL', async () => {
    const cfg = makeUserConfig();
    const secrets = makeSecrets();
    const inputs = ['team', 'https://mallard.team.example.com'];
    const nameValidators: Array<(v: string) => string | undefined> = [];
    win.showQuickPick = (async (items: readonly vscode.QuickPickItem[]) =>
      (items as ReadonlyArray<{ action?: string }>).find((i) => i.action === 'add-webhook')) as never;
    win.showInputBox = (async (opts: vscode.InputBoxOptions) => {
      if (opts.validateInput) nameValidators.push(opts.validateInput as never);
      return inputs.shift();
    }) as never;
    win.showInformationMessage = (async () => undefined) as never;

    await configureExportTargets(secrets as never, cfg as unknown as UserConfigStore);

    assert.deepEqual(cfg.get().export?.webhookTargets, [
      { name: 'team', url: 'https://mallard.team.example.com' },
    ]);
    // Validators enforce the schema's name charset and the URL scheme.
    const nameValidate = nameValidators[0]!;
    assert.ok(nameValidate('bad name!'), 'rejects invalid characters');
    assert.equal(nameValidate('ok-name_1'), undefined);
    const urlValidate = nameValidators[1]!;
    assert.ok(urlValidate('http://plain.example.com'), 'rejects non-https');
    assert.equal(urlValidate('https://ok.example.com'), undefined);
  });

  it('rejects a duplicate target name', async () => {
    const cfg = makeUserConfig({ webhookTargets: [{ name: 'team', url: 'https://a.example.com' }] });
    const secrets = makeSecrets();
    let nameValidate: ((v: string) => string | undefined) | undefined;
    win.showQuickPick = (async (items: readonly vscode.QuickPickItem[]) =>
      (items as ReadonlyArray<{ action?: string }>).find((i) => i.action === 'add-webhook')) as never;
    win.showInputBox = (async (opts: vscode.InputBoxOptions) => {
      nameValidate = opts.validateInput as never;
      return undefined; // dismiss
    }) as never;

    await configureExportTargets(secrets as never, cfg as unknown as UserConfigStore);
    assert.ok(nameValidate!('team'), 'duplicate name rejected');
    assert.equal(nameValidate!('other'), undefined);
    assert.equal(cfg.patches.length, 0, 'dismissal writes nothing');
  });

  it('removes a target and clears its namespaced secrets', async () => {
    const cfg = makeUserConfig({
      webhookTargets: [{ name: 'team', url: 'https://a.example.com' }],
      mqttTargets: [{ name: 'broker', url: 'wss://b.example.com/mqtt' }],
    });
    const secrets = makeSecrets();
    await secrets.set(`${SECRET_KEYS.webhookApiKey}:team`, 'k');
    await secrets.set(`${SECRET_KEYS.mqttPassword}:broker`, 'p');

    let firstPick = true;
    win.showQuickPick = (async (items: readonly unknown[]) => {
      if (firstPick) {
        firstPick = false;
        return (items as ReadonlyArray<{ target?: { name: string } }>).find(
          (i) => i.target?.name === 'team',
        );
      }
      return 'Remove target';
    }) as never;
    win.showInformationMessage = (async () => undefined) as never;

    await configureExportTargets(secrets as never, cfg as unknown as UserConfigStore);

    assert.deepEqual(cfg.get().export?.webhookTargets, []);
    assert.deepEqual(cfg.get().export?.mqttTargets, [{ name: 'broker', url: 'wss://b.example.com/mqtt' }]);
    assert.equal(secrets.store.has(`${SECRET_KEYS.webhookApiKey}:team`), false, 'team secrets cleared');
    assert.equal(secrets.store.has(`${SECRET_KEYS.mqttPassword}:broker`), true, 'other targets untouched');
  });
});
