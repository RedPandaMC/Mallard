import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'jurreandenys.weevil';

const EXPECTED_COMMANDS = [
  'weevil.openDashboard',
  'weevil.refresh',
  'weevil.clearData',
  'weevil.showLogPath',
  'weevil.signIn',
  'weevil.exportReport',
  'weevil.simulateRestriction',
];

describe('Weevil extension (integration)', () => {
  it('is present and activates without throwing', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} should be installed`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  it('registers exactly the seven contributed weevil.* commands', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    await ext!.activate();
    const all = await vscode.commands.getCommands(true);
    for (const cmd of EXPECTED_COMMANDS) {
      assert.ok(all.includes(cmd), `command ${cmd} should be registered`);
    }
    // VS Code auto-registers per-view commands for the contributed `weevil.trigger`
    // tree view (focus/open/removeView/resetViewLocation/toggleVisibility); those
    // are framework-generated, not part of the extension's command contract.
    const contributed = all
      .filter((c) => c.startsWith('weevil.') && !c.startsWith('weevil.trigger.'))
      .sort();
    assert.deepStrictEqual(
      contributed,
      [...EXPECTED_COMMANDS].sort(),
      `unexpected weevil commands: ${contributed.join(', ')}`,
    );
  });

  it('opens the dashboard without throwing', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    await ext!.activate();
    await vscode.commands.executeCommand('weevil.openDashboard');
    assert.ok(true);
  });

  it('runs refresh without throwing', async () => {
    await vscode.commands.executeCommand('weevil.refresh');
    assert.ok(true);
  });

  it('exposes only the two documented settings', () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    const props = ext.packageJSON.contributes.configuration.properties as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(props).sort(), [
      'weevil.copilotLogPath',
      'weevil.pricingManifestUrl',
    ]);
  });
});
