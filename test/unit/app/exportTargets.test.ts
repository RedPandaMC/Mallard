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
  const values = new Map<string, string>();
  return {
    values,
    get: async (k: string) => values.get(k),
    store: async (k: string, v: string) => void values.set(k, v),
    set: async (k: string, v: string) => void values.set(k, v),
    delete: async (k: string) => void values.delete(k),
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
    assert.equal(secrets.values.has(`${SECRET_KEYS.webhookApiKey}:team`), false, 'team secrets cleared');
    assert.equal(secrets.values.has(`${SECRET_KEYS.mqttPassword}:broker`), true, 'other targets untouched');
  });

  it('sets a credential for a webhook target via the slot picker', async () => {
    const cfg = makeUserConfig({ webhookTargets: [{ name: 'team', url: 'https://a.example.com' }] });
    const secrets = makeSecrets();
    // One slot pre-configured so the picker renders both status icons.
    await secrets.set(`${SECRET_KEYS.webhookBearerToken}:team`, 'existing');
    let pick = 0;
    win.showQuickPick = (async (items: readonly unknown[]) => {
      pick++;
      if (pick === 1) {
        return (items as ReadonlyArray<{ target?: { name: string } }>).find(
          (i) => i.target?.name === 'team',
        );
      }
      if (pick === 2) return 'Set credentials…';
      // Slot picker: webhook targets expose api-key/bearer/signing slots.
      const slots = items as ReadonlyArray<{ slot: { key: string } }>;
      assert.equal(slots.length, 3, 'webhook target offers three credential slots');
      return slots.find((i) => i.slot.key === `${SECRET_KEYS.webhookApiKey}:team`);
    }) as never;
    win.showInputBox = (async () => 'super-secret') as never;
    win.showInformationMessage = (async () => undefined) as never;

    await configureExportTargets(secrets as never, cfg as unknown as UserConfigStore);
    assert.equal(secrets.values.get(`${SECRET_KEYS.webhookApiKey}:team`), 'super-secret');
    assert.equal(cfg.patches.length, 0, 'credential flows never rewrite config.json');
  });

  it('prompts the single MQTT password slot directly and clears it on blank input', async () => {
    const cfg = makeUserConfig({ mqttTargets: [{ name: 'broker', url: 'wss://b.example.com/mqtt' }] });
    const secrets = makeSecrets();
    await secrets.set(`${SECRET_KEYS.mqttPassword}:broker`, 'old');
    let pick = 0;
    win.showQuickPick = (async (items: readonly unknown[]) => {
      pick++;
      if (pick === 1) {
        return (items as ReadonlyArray<{ target?: { name: string } }>).find(
          (i) => i.target?.name === 'broker',
        );
      }
      return 'Set credentials…';
    }) as never;
    win.showInputBox = (async () => '') as never; // blank clears
    win.showInformationMessage = (async () => undefined) as never;

    await configureExportTargets(secrets as never, cfg as unknown as UserConfigStore);
    assert.equal(pick, 2, 'a single slot skips the slot picker');
    assert.equal(secrets.values.has(`${SECRET_KEYS.mqttPassword}:broker`), false, 'blank input clears');
  });

  it('adds an MQTT target and jumps into its password prompt when accepted', async () => {
    const cfg = makeUserConfig();
    const secrets = makeSecrets();
    const inputs = ['broker', 'wss://b.example.com/mqtt', 'connect-pw'];
    win.showQuickPick = (async (items: readonly vscode.QuickPickItem[]) =>
      (items as ReadonlyArray<{ action?: string }>).find((i) => i.action === 'add-mqtt')) as never;
    win.showInputBox = (async () => inputs.shift()) as never;
    win.showInformationMessage = (async (_msg: string, ...actions: string[]) =>
      actions[0]) as never; // accept "Set Credentials…" (and the save toast)

    await configureExportTargets(secrets as never, cfg as unknown as UserConfigStore);
    assert.deepEqual(cfg.get().export?.mqttTargets, [{ name: 'broker', url: 'wss://b.example.com/mqtt' }]);
    assert.equal(secrets.values.get(`${SECRET_KEYS.mqttPassword}:broker`), 'connect-pw');
  });

  it('handles a config.json without an export block (dismissed picker)', async () => {
    const cfg = makeUserConfig();
    delete (cfg.get() as { export?: ExportConfig }).export;
    const secrets = makeSecrets();
    win.showQuickPick = (async () => undefined) as never; // dismiss
    await configureExportTargets(secrets as never, cfg as unknown as UserConfigStore);
    assert.equal(cfg.patches.length, 0);
  });

  it('writes nothing when the URL prompt is dismissed mid-add', async () => {
    const cfg = makeUserConfig();
    delete (cfg.get() as { export?: ExportConfig }).export;
    const secrets = makeSecrets();
    const inputs: (string | undefined)[] = ['team', undefined]; // name ok, URL dismissed
    win.showQuickPick = (async (items: readonly vscode.QuickPickItem[]) =>
      (items as ReadonlyArray<{ action?: string }>).find((i) => i.action === 'add-webhook')) as never;
    win.showInputBox = (async () => inputs.shift()) as never;
    await configureExportTargets(secrets as never, cfg as unknown as UserConfigStore);
    assert.equal(cfg.patches.length, 0);
  });

  it('dismissing the manage menu changes nothing', async () => {
    const cfg = makeUserConfig({ webhookTargets: [{ name: 'team', url: 'https://a.example.com' }] });
    const secrets = makeSecrets();
    let pick = 0;
    win.showQuickPick = (async (items: readonly unknown[]) => {
      pick++;
      if (pick === 1) {
        return (items as ReadonlyArray<{ target?: { name: string } }>).find(
          (i) => i.target?.name === 'team',
        );
      }
      return undefined; // dismiss the action menu
    }) as never;

    await configureExportTargets(secrets as never, cfg as unknown as UserConfigStore);
    assert.equal(cfg.patches.length, 0);
  });
});
