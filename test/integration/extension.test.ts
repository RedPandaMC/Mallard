import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'RedPandaMC.mallard';

const EXPECTED_COMMANDS = [
  'mallard.openDashboard',
  'mallard.refresh',
  'mallard.clearData',
  'mallard.showLogPath',
  'mallard.signIn',
  'mallard.exportReport',
  'mallard.exportData',
  'mallard.prepareUninstall',
  'mallard.manageCredentials',
  'mallard.configureExportTargets',
  'mallard.setMqttPassword',
  'mallard.setWebhookApiKey',
  'mallard.setWebhookBearerToken',
  'mallard.setWebhookSigningSecret',
  'mallard.setGitHubPat',
  'mallard.simulateRestriction',
  'mallard.disableExtension',
  'mallard.enableCopilotTelemetry',
  'mallard.showOnboarding',
];

describe('Mallard extension (integration)', () => {
  it('is present and activates without throwing', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} should be installed`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  it('registers exactly the contributed mallard.* commands', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    await ext!.activate();
    const all = await vscode.commands.getCommands(true);
    for (const cmd of EXPECTED_COMMANDS) {
      assert.ok(all.includes(cmd), `command ${cmd} should be registered`);
    }
    // VS Code auto-registers per-view commands for the contributed `mallard.sidebar`
    // tree view (focus/open/removeView/resetViewLocation/toggleVisibility); those
    // are framework-generated, not part of the extension's command contract.
    const contributed = all
      .filter((c) => c.startsWith('mallard.') && !c.startsWith('mallard.sidebar.'))
      .sort();
    assert.deepStrictEqual(
      contributed,
      [...EXPECTED_COMMANDS].sort(),
      `unexpected mallard commands: ${contributed.join(', ')}`,
    );
  });

  it('opens the dashboard without throwing', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    await ext!.activate();
    await vscode.commands.executeCommand('mallard.openDashboard');
    assert.ok(true);
  });

  it('runs refresh without throwing', async () => {
    await vscode.commands.executeCommand('mallard.refresh');
    assert.ok(true);
  });

  it('exposes only the documented settings', () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    const props = ext.packageJSON.contributes.configuration.properties as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(props).sort(), [
      'mallard.copilotLogPath',
      'mallard.copilotOtelPath',
      'mallard.dataRetentionDays',
      'mallard.enabledConnectors',
      'mallard.export.transport',
      'mallard.githubBilling.org',
      'mallard.mqtt.auth',
      'mallard.mqtt.url',
      'mallard.mqtt.username',
      'mallard.palette',
      'mallard.pricingManifestUrl',
      'mallard.refreshIntervalMinutes',
      'mallard.server.url',
      'mallard.shared.certificate.caFile',
      'mallard.shared.certificate.file',
      'mallard.shared.certificate.keyFile',
      'mallard.webhook.auth',
    ]);
  });
});
