/**
 * Command Palette management for the export fanout targets declared in
 * config.json (`export.webhookTargets` / `export.mqttTargets`). These worked
 * before but were configurable only by hand-editing config.json; this flow
 * lists/adds/removes targets and jumps straight into their credential slots.
 * Target changes rebuild the exporter in place (container.ts watches the
 * export block), so no window reload is needed.
 */
import * as vscode from 'vscode';
import type { ExportConfig, ExportTarget } from '../domain/types';
import type { UserConfigStore } from './UserConfigStore';
import {
  CredentialSlot,
  mqttTargetSlots,
  promptAndStoreSecret,
  webhookTargetSlots,
} from './credentials';

/** Mirrors the pattern in schemas/mallard-config.schema.json (exportTarget.name). */
const NAME_RE = /^[A-Za-z0-9._-]{1,32}$/;

type TargetKind = 'webhook' | 'mqtt';

interface TargetPickItem extends vscode.QuickPickItem {
  action: 'manage' | 'add-webhook' | 'add-mqtt';
  targetKind?: TargetKind;
  target?: ExportTarget;
}

function slotsFor(kind: TargetKind, name: string): CredentialSlot[] {
  return kind === 'webhook' ? webhookTargetSlots([{ name }]) : mqttTargetSlots([{ name }]);
}

function listKey(kind: TargetKind): 'webhookTargets' | 'mqttTargets' {
  return kind === 'webhook' ? 'webhookTargets' : 'mqttTargets';
}

export async function configureExportTargets(
  secrets: vscode.SecretStorage,
  userConfig: UserConfigStore,
): Promise<void> {
  const exportCfg: ExportConfig = userConfig.get().export ?? {};
  const items: TargetPickItem[] = [
    ...(exportCfg.webhookTargets ?? []).map((t) => ({
      label: `$(cloud-upload) ${t.name}`,
      description: t.url,
      detail: 'Webhook target — mirrors every payload when the transport is "webhook"',
      action: 'manage' as const,
      targetKind: 'webhook' as const,
      target: t,
    })),
    ...(exportCfg.mqttTargets ?? []).map((t) => ({
      label: `$(radio-tower) ${t.name}`,
      description: t.url,
      detail: 'MQTT broker target — mirrors every payload when the transport is "mqtt"',
      action: 'manage' as const,
      targetKind: 'mqtt' as const,
      target: t,
    })),
    { label: '$(add) Add webhook target…', action: 'add-webhook' as const },
    { label: '$(add) Add MQTT broker target…', action: 'add-mqtt' as const },
  ];

  const picked = await vscode.window.showQuickPick<TargetPickItem>(items, {
    title: 'Mallard: Export Fanout Targets',
    placeHolder:
      'Extra servers that mirror every metric payload (the primary server is mallard.server.url)',
  });
  if (!picked) return;

  if (picked.action === 'add-webhook') return addTarget('webhook', secrets, userConfig);
  if (picked.action === 'add-mqtt') return addTarget('mqtt', secrets, userConfig);
  return manageTarget(picked.targetKind!, picked.target!, secrets, userConfig);
}

async function addTarget(
  kind: TargetKind,
  secrets: vscode.SecretStorage,
  userConfig: UserConfigStore,
): Promise<void> {
  const exportCfg: ExportConfig = userConfig.get().export ?? {};
  const taken = new Set(
    [...(exportCfg.webhookTargets ?? []), ...(exportCfg.mqttTargets ?? [])].map((t) => t.name),
  );

  const name = await vscode.window.showInputBox({
    title: `Add ${kind} target — name`,
    prompt: 'Unique name; namespaces this target\'s SecretStorage credentials',
    validateInput: (v) =>
      !NAME_RE.test(v)
        ? 'Use 1–32 characters: letters, digits, dot, underscore, dash'
        : taken.has(v)
          ? `A target named "${v}" already exists`
          : undefined,
  });
  if (!name) return;

  const scheme = kind === 'webhook' ? 'https://' : 'wss://';
  const url = await vscode.window.showInputBox({
    title: `Add ${kind} target — URL`,
    prompt: kind === 'webhook' ? 'Webhook base URL (https://…)' : 'MQTT WebSocket URL (wss://…)',
    validateInput: (v) => (v.startsWith(scheme) ? undefined : `URL must start with ${scheme}`),
  });
  if (!url) return;

  const key = listKey(kind);
  await userConfig.set({
    export: { ...exportCfg, [key]: [...(exportCfg[key] ?? []), { name, url }] },
  });

  const setNow = await vscode.window.showInformationMessage(
    `Mallard: ${kind} target "${name}" added — it takes effect immediately, no reload needed. ` +
      'Set its credentials so exports can authenticate.',
    'Set Credentials…',
  );
  if (setNow) await pickAndSetSlot(secrets, slotsFor(kind, name));
}

async function manageTarget(
  kind: TargetKind,
  target: ExportTarget,
  secrets: vscode.SecretStorage,
  userConfig: UserConfigStore,
): Promise<void> {
  const action = await vscode.window.showQuickPick(['Set credentials…', 'Remove target'], {
    title: `${target.name} (${target.url})`,
  });
  if (!action) return;

  if (action === 'Set credentials…') {
    await pickAndSetSlot(secrets, slotsFor(kind, target.name));
    return;
  }

  const exportCfg: ExportConfig = userConfig.get().export ?? {};
  const key = listKey(kind);
  await userConfig.set({
    export: {
      ...exportCfg,
      [key]: (exportCfg[key] ?? []).filter((t) => t.name !== target.name),
    },
  });
  // Best-effort cleanup so removed targets leave no orphaned secrets behind.
  for (const slot of slotsFor(kind, target.name)) {
    await secrets.delete(slot.key);
  }
  void vscode.window.showInformationMessage(
    `Mallard: ${kind} target "${target.name}" removed (its stored credentials were cleared).`,
  );
}

/** Focused credential picker for one target's slots (never shows values). */
async function pickAndSetSlot(
  secrets: vscode.SecretStorage,
  slots: CredentialSlot[],
): Promise<void> {
  if (slots.length === 1) return promptAndStoreSecret(secrets, slots[0]!);
  const items = await Promise.all(
    slots.map(async (slot) => ({
      label: `${(await secrets.get(slot.key)) !== undefined ? '$(pass-filled)' : '$(circle-large-outline)'} ${slot.label}`,
      detail: slot.description,
      slot,
    })),
  );
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Set target credentials',
    placeHolder: 'Stored in your OS keychain via VS Code SecretStorage',
  });
  if (picked) await promptAndStoreSecret(secrets, picked.slot);
}
