/**
 * Central registry and management UI for every secret Mallard stores.
 *
 * All credentials live in VS Code SecretStorage (OS keychain), never in
 * settings.json.
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

export const ALL_SECRET_KEYS: string[] = Object.values(SECRET_KEYS);

export interface CredentialSlot {
  /** SecretStorage key. Base slots use a SECRET_KEYS value; per-target slots
   * append `:<targetName>` (see webhookTargetSlots). */
  key: string;
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

/** SecretStorage key for a per-target credential (multi-server webhook export). */
export function targetSecretKey(base: SecretKey, targetName: string): string {
  return `${base}:${targetName}`;
}

/**
 * Credential slots for the extra webhook targets declared in config.json
 * (`export.webhookTargets`). Each target gets its own API key / bearer token /
 * signing secret, namespaced by the target name.
 */
export function webhookTargetSlots(
  targets: ReadonlyArray<{ name: string }>,
): CredentialSlot[] {
  return targets.flatMap((t) => [
    {
      key: targetSecretKey(SECRET_KEYS.webhookApiKey, t.name),
      label: `Webhook API key — target "${t.name}"`,
      description: `X-API-Key for the "${t.name}" webhook target`,
    },
    {
      key: targetSecretKey(SECRET_KEYS.webhookBearerToken, t.name),
      label: `Webhook bearer token — target "${t.name}"`,
      description: `Authorization: Bearer for the "${t.name}" webhook target`,
    },
    {
      key: targetSecretKey(SECRET_KEYS.webhookSigningSecret, t.name),
      label: `Webhook signing secret — target "${t.name}"`,
      description: `HMAC-SHA256 signing for the "${t.name}" webhook target`,
    },
  ]);
}

/**
 * Credential slots for the extra MQTT brokers declared in config.json
 * (`export.mqttTargets`). Each broker gets its own CONNECT password.
 */
export function mqttTargetSlots(
  targets: ReadonlyArray<{ name: string }>,
): CredentialSlot[] {
  return targets.map((t) => ({
    key: targetSecretKey(SECRET_KEYS.mqttPassword, t.name),
    label: `MQTT password — broker "${t.name}"`,
    description: `CONNECT password for the "${t.name}" MQTT broker`,
  }));
}

/** All dynamic per-target slots for an export config block. */
export function exportTargetSlots(exportCfg: {
  webhookTargets?: ReadonlyArray<{ name: string }>;
  mqttTargets?: ReadonlyArray<{ name: string }>;
} | undefined): CredentialSlot[] {
  return [
    ...webhookTargetSlots(exportCfg?.webhookTargets ?? []),
    ...mqttTargetSlots(exportCfg?.mqttTargets ?? []),
  ];
}

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
 * Clear on the chosen slot. `extraSlots` adds dynamic entries (per-target
 * webhook credentials).
 */
export async function manageCredentials(
  secrets: vscode.SecretStorage,
  extraSlots: CredentialSlot[] = [],
): Promise<void> {
  const items = await Promise.all(
    [...CREDENTIAL_SLOTS, ...extraSlots].map(async (slot) => {
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

