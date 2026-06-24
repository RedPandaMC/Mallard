import { watch as fsWatch } from 'fs';

export interface IFsWatcher {
  watch(dir: string, callback: () => void): { close(): void };
}

export class NodeFsWatcher implements IFsWatcher {
  watch(dir: string, callback: () => void): { close(): void } {
    return fsWatch(dir, { recursive: false }, callback);
  }
}

export class NoopFsWatcher implements IFsWatcher {
  watch(_dir: string, _callback: () => void): { close(): void } {
    return { close() {} };
  }
}
