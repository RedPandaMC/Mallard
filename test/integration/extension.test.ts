import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'jurreandenys.weevil';

const EXPECTED_COMMANDS = [
  'weevil.openDashboard',
  'weevil.refresh',
  'weevil.showBreakdown',
  'weevil.setScope',
  'weevil.setBudget',
  'weevil.configureNotifications',
  'weevil.signIn',
  'weevil.signOut',
  'weevil.exportData',
  'weevil.clearData',
  'weevil.showTips',
];

describe('Weevil extension (integration)', () => {
  it('is present and activates without throwing', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} should be installed`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  it('registers all weevil.* commands', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    await ext!.activate();
    const all = await vscode.commands.getCommands(true);
    for (const cmd of EXPECTED_COMMANDS) {
      assert.ok(all.includes(cmd), `command ${cmd} should be registered`);
    }
  });

  it('opens the dashboard without throwing', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    await ext!.activate();
    await vscode.commands.executeCommand('weevil.openDashboard');
    // The command resolves once the panel is created; a throw would fail the test.
    assert.ok(true);
  });

  it('runs refresh without throwing', async () => {
    await vscode.commands.executeCommand('weevil.refresh');
    assert.ok(true);
  });

  it('exports data to a JSON document', async () => {
    await vscode.commands.executeCommand('weevil.exportData');
    const doc = vscode.window.activeTextEditor?.document;
    assert.ok(doc, 'an editor should be active after export');
    assert.strictEqual(doc!.languageId, 'json');
    // Body should be valid JSON (an array of events, possibly empty).
    const parsed = JSON.parse(doc!.getText());
    assert.ok(Array.isArray(parsed));
  });
});
