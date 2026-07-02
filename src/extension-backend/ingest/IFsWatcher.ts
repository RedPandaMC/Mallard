/* c8 ignore next */
import { watch as fsWatch } from 'fs';

export interface IFsWatcher {
  watch(dir: string, callback: () => void, recursive?: boolean): { close(): void };
}

export class NodeFsWatcher implements IFsWatcher {
  watch(dir: string, callback: () => void, recursive = false): { close(): void } {
    // recursive fs.watch is native on Windows/macOS and supported on Linux
    // since Node 20. Callers catch and retry non-recursively if it throws.
    return fsWatch(dir, { recursive }, callback);
  }
}

export class NoopFsWatcher implements IFsWatcher {
  watch(_dir: string, _callback: () => void, _recursive?: boolean): { close(): void } {
    return { close() {} };
  }
  /* c8 ignore next */
}
