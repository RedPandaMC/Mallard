/**
 * Central registry and management UI for every secret Mallard stores.
 *
 * All credentials live in VS Code SecretStorage (OS keychain), never in
 * settings.json. The one-time migration below moves values users had in the
 * old plaintext settings into SecretStorage and blanks the settings.
 */
import * as vscode from 'vscode';

export const SECRET_KEYS = {
  mqttPassword: 'mallard.mqtt.password',
  webhookApiKey: 'mallard.webhook.apiKey.secret',
  webhookBearerToken: 'mallard.webhook.bearerToken.secret',
  webhookSigningSecret: 'mallard.webhook.secret',
  githubPat: 'mallard.github.pat',
} as const;

export type SecretKey = (typeof SECRET_KEYS)[keyof typeof SECRET_KEYS];

export const ALL_SECRET_KEYS: SecretKey[] = Object.values(SECRET_KEYS);

export interface CredentialSlot {
  key: SecretKey;
  /** Short name shown in the QuickPick. */
  label: string;
  /** What the credential is used for. */
  description: string;
}

export const CREDENTIAL_SLOTS: CredentialSlot[] = [
  {
    key: SECRET_KEYS.webhookApiKey,
    label: 'Webhook API key',
    description: 'Sent as X-API-Key to the metric export server',
  },
  {
    key: SECRET_KEYS.webhookBearerToken,
    label: 'Webhook bearer token',
    description: 'Sent as Authorization: Bearer to the metric export server',
  },
  {
    key: SECRET_KEYS.webhookSigningSecret,
    label: 'Webhook signing secret',
    description: 'HMAC-SHA256 request signing (X-Mallard-Signature-256)',
  },
  {
    key: SECRET_KEYS.mqttPassword,
    label: 'MQTT password',
    description: 'CONNECT password for the MQTT export broker',
  },
  {
    key: SECRET_KEYS.githubPat,
    label: 'GitHub personal access token',
    description: 'Used for GitHub billing when not using VS Code sign-in',
  },
];

/** Prompt for a value and store/clear the given secret. Reused by all setter commands. */
export async function promptAndStoreSecret(
  secrets: vscode.SecretStorage,
  slot: CredentialSlot,
): Promise<void> {
  const pwd = await vscode.window.showInputBox({
    prompt: `Enter ${slot.label} (leave blank to clear)`,
    password: true,
  });
  if (pwd === undefined) return; // dismissed
  if (pwd === '') {
    await secrets.delete(slot.key);
    void vscode.window.showInformationMessage(`Mallard: ${slot.label} cleared.`);
  } else {
    await secrets.store(slot.key, pwd);
    void vscode.window.showInformationMessage(`Mallard: ${slot.label} saved securely.`);
  }
}

/**
 * Full CRUD over every credential slot: a QuickPick listing each slot with
 * its configured/not-configured status (never the value), then Set/Update or
 * Clear on the chosen slot.
 */
export async function manageCredentials(secrets: vscode.SecretStorage): Promise<void> {
  const items = await Promise.all(
    CREDENTIAL_SLOTS.map(async (slot) => {
      const configured = (await secrets.get(slot.key)) !== undefined;
      return {
        label: `${configured ? '$(pass-filled)' : '$(circle-large-outline)'} ${slot.label}`,
        description: configured ? 'configured' : 'not set',
        detail: slot.description,
        slot,
        configured,
      };
    }),
  );

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Mallard: Manage Credentials',
    placeHolder: 'All credentials are stored in your OS keychain via VS Code SecretStorage',
  });
  if (!picked) return;

  const actions = picked.configured ? ['Update…', 'Clear'] : ['Set…'];
  const action = await vscode.window.showQuickPick(actions, {
    title: `${picked.slot.label} — ${picked.configured ? 'configured' : 'not set'}`,
  });
  if (!action) return;

  if (action === 'Clear') {
    await secrets.delete(picked.slot.key);
    void vscode.window.showInformationMessage(`Mallard: ${picked.slot.label} cleared.`);
    return;
  }
  await promptAndStoreSecret(secrets, picked.slot);
}

/**
 * One-time migration: move credentials out of the old plaintext settings into
 * SecretStorage and blank the settings. Runs once per install (globalState flag).
 */
export async function migrateSecretsFromSettings(
  context: vscode.ExtensionContext,
): Promise<void> {
  const FLAG = 'mallard.secretsMigrated.v1';
  if (context.globalState.get<boolean>(FLAG)) return;

  const c = vscode.workspace.getConfiguration('mallard');
  const pairs: Array<[settingKey: string, secretKey: SecretKey]> = [
    ['webhook.apiKey', SECRET_KEYS.webhookApiKey],
    ['webhook.bearerToken', SECRET_KEYS.webhookBearerToken],
  ];

  let moved = 0;
  for (const [settingKey, secretKey] of pairs) {
    const value = c.get<string>(settingKey, '');
    if (value && (await context.secrets.get(secretKey)) === undefined) {
      await context.secrets.store(secretKey, value);
      moved++;
    }
    if (value) {
      await c.update(settingKey, undefined, vscode.ConfigurationTarget.Global);
    }
  }

  await context.globalState.update(FLAG, true);
  if (moved > 0) {
    void vscode.window.showInformationMessage(
      'Mallard: webhook credentials were moved from settings.json into secure storage. ' +
        'Use "Mallard: Manage Credentials" to change them.',
    );
  }
}
