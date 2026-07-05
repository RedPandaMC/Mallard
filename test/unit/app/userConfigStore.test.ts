import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UserConfigStore } from '../../../src/extension-backend/app/UserConfigStore';
import { DEFAULT_USER_CONFIG } from '../../../src/extension-backend/domain/types';
import { UserConfig } from '../../../src/extension-backend/domain/types';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-userconfig-'));
}

async function writeConfig(dir: string, value: unknown): Promise<void> {
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(value), 'utf8');
}

describe('UserConfigStore', () => {
  it('seeds config.json with the opinionated first-install defaults when missing', async () => {
    const dir = await tmpDir();
    const store = new UserConfigStore(dir);
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'config.json'), 'utf8')) as UserConfig;
    assert.equal(onDisk.dailyCreditAlert, store.get().dailyCreditAlert);
    store.dispose();
  });

  it('reads a valid config file, clamping negative numbers to defaults', async () => {
    const dir = await tmpDir();
    await writeConfig(dir, { monthlyBudget: -5, includedCredits: 500 });
    const store = new UserConfigStore(dir);
    assert.equal(store.get().monthlyBudget, 0, 'negative clamped to default');
    assert.equal(store.get().includedCredits, 500);
    store.dispose();
  });

  it('degrades a malformed file to defaults instead of throwing', async () => {
    const dir = await tmpDir();
    await fs.writeFile(path.join(dir, 'config.json'), '{oops', 'utf8');
    const store = new UserConfigStore(dir);
    assert.equal(typeof store.get().monthlyBudget, 'number');
    store.dispose();
  });

  it('preserves githubBilling, dashboard, display, and export blocks (regression)', async () => {
    // These four blocks used to be silently dropped by the zod schema +
    // mergeConfig, killing the documented config.json features.
    const dir = await tmpDir();
    await writeConfig(dir, {
      monthlyBudget: 10,
      githubBilling: { mode: 'pat', org: 'acme' },
      dashboard: { columns: 3, panels: [{ id: 'daily', hidden: true }] },
      display: { topN: 5 },
      export: {
        webhookTargets: [{ name: 'team', url: 'https://team.example.com' }],
        mqttTargets: [{ name: 'b2', url: 'wss://b2.example.com/mqtt' }],
      },
    });
    const store = new UserConfigStore(dir);
    const cfg = store.get();
    assert.deepEqual(cfg.githubBilling, { mode: 'pat', org: 'acme' });
    assert.equal(cfg.dashboard?.columns, 3);
    assert.equal(cfg.display?.topN, 5);
    assert.equal(cfg.export?.webhookTargets?.[0]?.name, 'team');
    assert.equal(cfg.export?.mqttTargets?.[0]?.url, 'wss://b2.example.com/mqtt');
    store.dispose();
  });

  it('set() merges a patch, persists it, and fires onDidChange', async () => {
    const dir = await tmpDir();
    const store = new UserConfigStore(dir);
    const fired: UserConfig[] = [];
    store.onDidChange((c) => fired.push(c));

    await store.set({ monthlyBudget: 42 });

    assert.equal(store.get().monthlyBudget, 42);
    assert.equal(fired.length, 1);
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'config.json'), 'utf8')) as UserConfig;
    assert.equal(onDisk.monthlyBudget, 42);
    store.dispose();
  });

  it('reset() restores plain defaults', async () => {
    const dir = await tmpDir();
    const store = new UserConfigStore(dir);
    await store.set({ monthlyBudget: 42 });
    await store.reset();
    assert.equal(store.get().monthlyBudget, 0);
    store.dispose();
  });

  it('uri points at the on-disk config file', async () => {
    const dir = await tmpDir();
    const store = new UserConfigStore(dir);
    assert.ok(store.uri.fsPath.endsWith('config.json'));
    store.dispose();
  });

  it('detects external file changes and fires onDidChange (fs.watch)', async () => {
    const dir = await tmpDir();
    const store = new UserConfigStore(dir);
    const fired: UserConfig[] = [];
    store.onDidChange((c) => fired.push(c));

    // Wait past the suppress window (500ms after our own write), then write
    // a different config on disk directly — the watcher must pick it up.
    await new Promise((r) => setTimeout(r, 600));
    await fs.writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify({ ...DEFAULT_USER_CONFIG, monthlyBudget: 99 }),
      'utf8',
    );
    // Give the watcher a moment to fire.
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(fired.some((c) => c.monthlyBudget === 99), 'external change detected');
    store.dispose();
  });
});
