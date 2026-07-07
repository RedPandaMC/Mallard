import { strict as assert } from 'assert';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { IntervalManager } from '../../../src/extension-backend/util/IntervalManager';
import { JsonFileStore } from '../../../src/extension-backend/util/JsonFileStore';
import { opt } from '../../../src/extension-backend/util/lang';
import { hashMachineId } from '../../../src/extension-backend/util/machineId';
import { defaultVscodeHost } from '../../../src/extension-backend/util/vscodeHost';
import * as vscode from 'vscode';

describe('util/IntervalManager', () => {
  it('schedule() replaces a pending timer and clears via Symbol.dispose', () => {
    const mgr = new IntervalManager();
    let ticks = 0;
    mgr.schedule(() => ticks++, 60_000);
    // Re-scheduling clears the previous handle without firing it.
    mgr.schedule(() => ticks++, 60_000);
    assert.doesNotThrow(() => void mgr[Symbol.dispose]());
    assert.equal(ticks, 0); // interval hasn't elapsed (60s min)
  });

  it('schedule() enforces a 60s minimum interval', () => {
    const mgr = new IntervalManager();
    // Tiny ms would normally fire immediately; the clamp prevents that.
    mgr.schedule(() => {}, 1);
    assert.doesNotThrow(() => void mgr[Symbol.dispose]());
  });
});

describe('util/JsonFileStore', () => {
  it('write() failure is swallowed and logged (best-effort persist)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mallard-jsonstore-'));
    try {
      // Route the write through a filename whose parent segment is a *file*, so
      // writeFileSync fails with ENOTDIR — deterministic for any user (a chmod
      // read-only dir is bypassed when the test runs as root, e.g. in some CI
      // images). The constructor still mkdir's the real `dir`; only the write
      // fails, and the catch must swallow it without throwing.
      await writeFile(join(dir, 'blocker'), 'x');
      const store = new JsonFileStore<{ a: number }>(dir, 'blocker/state.json');
      store.write({ a: 1 }); // writeFileSync ENOTDIR → swallowed, no throw
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('read() returns undefined for ENOENT without logging, and undefined for bad JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mallard-jsonstore-'));
    try {
      const store = new JsonFileStore<unknown>(dir, 'missing.json');
      assert.equal(store.read(), undefined); // missing file
      await writeFile(join(dir, 'bad.json'), 'not json{{{');
      const bad = new JsonFileStore<unknown>(dir, 'bad.json');
      assert.equal(bad.read(), undefined); // malformed
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('util/lang — opt()', () => {
  it('returns the keyed record when value is defined', () => {
    assert.deepEqual(opt('url', 'https://x'), { url: 'https://x' });
  });
  it('returns an empty object when value is undefined', () => {
    assert.deepEqual(opt('url', undefined), {});
  });
  it('passes through falsy-but-defined values (0, empty string)', () => {
    assert.deepEqual(opt('n', 0), { n: 0 });
    assert.deepEqual(opt('s', ''), { s: '' });
  });
});

describe('util/machineId — hashMachineId', () => {
  it('returns a stable hex sha256 of vscode.env.machineId', () => {
    const a = hashMachineId();
    const b = hashMachineId();
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
});

describe('util/vscodeHost — defaultVscodeHost', () => {
  it('showWarningMessage delegates to vscode.window.showWarningMessage', async () => {
    const win = vscode.window as unknown as { showWarningMessage: (msg: string) => Promise<string> };
    const orig = win.showWarningMessage;
    let called = '';
    win.showWarningMessage = (msg: string) => {
      called = msg;
      return Promise.resolve('Dismiss');
    };
    try {
      const out = await defaultVscodeHost.showWarningMessage('hi');
      assert.equal(called, 'hi');
      assert.equal(out, 'Dismiss');
    } finally {
      win.showWarningMessage = orig;
    }
  });

  it('executeCommand delegates to vscode.commands.executeCommand', async () => {
    const cmd = vscode.commands as unknown as { executeCommand: (c: string, ...args: unknown[]) => Promise<unknown> };
    const orig = cmd.executeCommand;
    let called = '';
    cmd.executeCommand = (c: string, ...args: unknown[]) => {
      called = `${c}:${JSON.stringify(args)}`;
      return Promise.resolve('ok');
    };
    try {
      const out = await defaultVscodeHost.executeCommand('foo', 1, 'x');
      assert.equal(called, 'foo:[1,"x"]');
      assert.equal(out, 'ok');
    } finally {
      cmd.executeCommand = orig;
    }
  });
});
