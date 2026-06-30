import { strict as assert } from 'assert';
import { NoopFsWatcher } from '../../../src/extension-backend/ingest/IFsWatcher';

describe('NoopFsWatcher', () => {
  it('watch() returns a handle whose close() does not throw', () => {
    const watcher = new NoopFsWatcher();
    const handle = watcher.watch('/some/dir', () => {});
    assert.doesNotThrow(() => handle.close());
  });

  it('watch() ignores the callback — invoking it has no side effects', () => {
    const watcher = new NoopFsWatcher();
    let called = false;
    const handle = watcher.watch('/tmp', () => { called = true; });
    assert.equal(called, false);
    handle.close();
  });
});
