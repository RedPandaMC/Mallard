import { strict as assert } from 'assert';
import * as vscode from 'vscode';
import {
  ALL_SECRET_KEYS,
  CREDENTIAL_SLOTS,
  SECRET_KEYS,
  manageCredentials,
  migrateSecretsFromSettings,
  promptAndStoreSecret,
} from '../../../src/extension-backend/app/credentials';

/** In-memory SecretStorage double. */
function makeSecrets(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store: async (k: string, v: string) => void store.set(k, v),
    get: async (k: string) => store.get(k),
    delete: async (k: string) => void store.delete(k),
    onDidChange: () => ({ dispose() {} }),
    _map: store,
  } as unknown as vscode.SecretStorage & { _map: Map<string, string> };
}

function makeContext(secrets: vscode.SecretStorage, state: Record<string, unknown> = {}) {
  return {
    secrets,
    globalState: {
      get: (k: string) => state[k],
      update: async (k: string, v: unknown) => void (state[k] = v),
      keys: () => Object.keys(state),
    },
  } as unknown as vscode.ExtensionContext;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const win = vscode.window as Mutable<typeof vscode.window>;
const ws = vscode.workspace as Mutable<typeof vscode.workspace>;

describe('credentials — registry', () => {
  it('every slot key is covered by ALL_SECRET_KEYS (prepareUninstall deletes them all)', () => {
    for (const slot of CREDENTIAL_SLOTS) {
      assert.ok(ALL_SECRET_KEYS.includes(slot.key), `${slot.key} missing from ALL_SECRET_KEYS`);
    }
  });
});

describe('credentials — promptAndStoreSecret', () => {
  const slot = CREDENTIAL_SLOTS.find((s) => s.key === SECRET_KEYS.webhookApiKey)!;
  const originalInputBox = win.showInputBox;
  afterEach(() => { win.showInputBox = originalInputBox; });

  it('stores the entered value', async () => {
    const secrets = makeSecrets();
    win.showInputBox = () => Promise.resolve('s3cret');
    await promptAndStoreSecret(secrets, slot);
    assert.equal(await secrets.get(slot.key), 's3cret');
  });

  it('clears the secret on blank input', async () => {
    const secrets = makeSecrets({ [slot.key]: 'old' });
    win.showInputBox = () => Promise.resolve('');
    await promptAndStoreSecret(secrets, slot);
    assert.equal(await secrets.get(slot.key), undefined);
  });

  it('leaves the secret untouched when the prompt is dismissed', async () => {
    const secrets = makeSecrets({ [slot.key]: 'keep-me' });
    win.showInputBox = () => Promise.resolve(undefined);
    await promptAndStoreSecret(secrets, slot);
    assert.equal(await secrets.get(slot.key), 'keep-me');
  });
});

describe('credentials — manageCredentials', () => {
  const originalQuickPick = win.showQuickPick;
  const originalInputBox = win.showInputBox;
  afterEach(() => {
    win.showQuickPick = originalQuickPick;
    win.showInputBox = originalInputBox;
  });

  it('lists every slot with its configured status, never the value', async () => {
    const secrets = makeSecrets({ [SECRET_KEYS.mqttPassword]: 'hunter2' });
    let seenItems: Array<{ label: string; description?: string; detail?: string }> = [];
    win.showQuickPick = ((items: unknown) => {
      seenItems = items as typeof seenItems;
      return Promise.resolve(undefined);
    }) as unknown as typeof win.showQuickPick;

    await manageCredentials(secrets);

    assert.equal(seenItems.length, CREDENTIAL_SLOTS.length);
    const mqtt = seenItems.find((i) => i.label.includes('MQTT password'))!;
    assert.equal(mqtt.description, 'configured');
    const pat = seenItems.find((i) => i.label.includes('GitHub'))!;
    assert.equal(pat.description, 'not set');
    for (const item of seenItems) {
      assert.ok(!JSON.stringify(item).includes('hunter2'), 'secret value must never appear');
    }
  });

  it('clears a configured slot via the Clear action', async () => {
    const secrets = makeSecrets({ [SECRET_KEYS.mqttPassword]: 'hunter2' });
    let call = 0;
    win.showQuickPick = ((items: unknown) => {
      call++;
      if (call === 1) {
        const arr = items as Array<{ label: string }>;
        return Promise.resolve(arr.find((i) => i.label.includes('MQTT password')));
      }
      return Promise.resolve('Clear');
    }) as unknown as typeof win.showQuickPick;

    await manageCredentials(secrets);
    assert.equal(await secrets.get(SECRET_KEYS.mqttPassword), undefined);
  });

  it('sets an unconfigured slot via the Set action', async () => {
    const secrets = makeSecrets();
    let call = 0;
    win.showQuickPick = ((items: unknown) => {
      call++;
      if (call === 1) {
        const arr = items as Array<{ label: string }>;
        return Promise.resolve(arr.find((i) => i.label.includes('Webhook API key')));
      }
      return Promise.resolve('Set…');
    }) as unknown as typeof win.showQuickPick;
    win.showInputBox = () => Promise.resolve('new-key');

    await manageCredentials(secrets);
    assert.equal(await secrets.get(SECRET_KEYS.webhookApiKey), 'new-key');
  });
});

describe('credentials — migrateSecretsFromSettings', () => {
  const originalGetConfiguration = ws.getConfiguration;
  afterEach(() => { ws.getConfiguration = originalGetConfiguration; });

  function fakeConfig(values: Record<string, string>) {
    const updates: Array<[string, unknown]> = [];
    ws.getConfiguration = (() => ({
      get: (key: string, fallback = '') => values[key] ?? fallback,
      update: async (key: string, value: unknown) => void updates.push([key, value]),
    })) as unknown as typeof ws.getConfiguration;
    return updates;
  }

  it('moves plaintext settings into SecretStorage and blanks them', async () => {
    const secrets = makeSecrets();
    const ctx = makeContext(secrets);
    const updates = fakeConfig({ 'webhook.apiKey': 'plain-key', 'webhook.bearerToken': 'plain-tok' });

    await migrateSecretsFromSettings(ctx);

    assert.equal(await secrets.get(SECRET_KEYS.webhookApiKey), 'plain-key');
    assert.equal(await secrets.get(SECRET_KEYS.webhookBearerToken), 'plain-tok');
    assert.deepEqual(
      updates.map(([k, v]) => [k, v]),
      [['webhook.apiKey', undefined], ['webhook.bearerToken', undefined]],
    );
  });

  it('does not overwrite an already-stored secret', async () => {
    const secrets = makeSecrets({ [SECRET_KEYS.webhookApiKey]: 'from-command' });
    const ctx = makeContext(secrets);
    fakeConfig({ 'webhook.apiKey': 'stale-setting' });

    await migrateSecretsFromSettings(ctx);
    assert.equal(await secrets.get(SECRET_KEYS.webhookApiKey), 'from-command');
  });

  it('runs only once per install (globalState flag)', async () => {
    const secrets = makeSecrets();
    const state: Record<string, unknown> = {};
    const ctx = makeContext(secrets, state);
    fakeConfig({ 'webhook.apiKey': 'first' });

    await migrateSecretsFromSettings(ctx);
    assert.equal(await secrets.get(SECRET_KEYS.webhookApiKey), 'first');

    await secrets.delete(SECRET_KEYS.webhookApiKey);
    fakeConfig({ 'webhook.apiKey': 'second' });
    await migrateSecretsFromSettings(ctx);
    assert.equal(await secrets.get(SECRET_KEYS.webhookApiKey), undefined, 'second run must be a no-op');
  });
});
