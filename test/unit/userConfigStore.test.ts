import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UserConfigStore } from '../../src/extension-backend/app/UserConfigStore';

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-ucs-test-'));
}

describe('UserConfigStore — first-install seed', () => {
  it('seeds dailyCreditAlert and velocityEnabled when config.json does not exist', async () => {
    const dir = await makeTmpDir();
    const store = new UserConfigStore(dir);
    const cfg = store.get();
    assert.equal(cfg.dailyCreditAlert, 50);
    assert.equal(cfg.alerts.velocityEnabled, true);
    assert.equal(cfg.alerts.velocityCreditsPerHour, 100);
    store.dispose();
    await fs.rm(dir, { recursive: true });
  });

  it('writes the seed values to disk on first install', async () => {
    const dir = await makeTmpDir();
    const store = new UserConfigStore(dir);
    store.dispose();
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'config.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(raw['dailyCreditAlert'], 50);
    assert.equal((raw['alerts'] as Record<string, unknown>)['velocityEnabled'], true);
    await fs.rm(dir, { recursive: true });
  });

  it('reset() returns alerts to disabled defaults', async () => {
    const dir = await makeTmpDir();
    const store = new UserConfigStore(dir);
    await store.reset();
    const cfg = store.get();
    assert.equal(cfg.dailyCreditAlert, 0);
    assert.equal(cfg.alerts.velocityEnabled, false);
    assert.equal(cfg.alerts.velocityCreditsPerHour, 0);
    store.dispose();
    await fs.rm(dir, { recursive: true });
  });

  it('does not re-seed when config.json already exists', async () => {
    const dir = await makeTmpDir();
    // Create a config with custom values
    await fs.writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify({ dailyCreditAlert: 999, alerts: { velocityEnabled: false, velocityCreditsPerHour: 0 } }),
      'utf8',
    );
    const store = new UserConfigStore(dir);
    assert.equal(store.get().dailyCreditAlert, 999);
    assert.equal(store.get().alerts.velocityEnabled, false);
    store.dispose();
    await fs.rm(dir, { recursive: true });
  });
});
