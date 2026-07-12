import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildContainer } from '../../../src/extension-backend/container';
import { AuthProvider } from '../../../src/extension-backend/export/AuthProvider';

type ConfigChangeCb = (e: { affectsConfiguration(key: string): boolean }) => void;

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mallard-container-'));
}

function makeContext(dir: string): vscode.ExtensionContext {
  return {
    subscriptions: [] as { dispose(): void }[],
    globalStorageUri: { fsPath: dir },
    extensionUri: { fsPath: dir, toString: () => `file://${dir}` },
    secrets: {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {},
      onDidChange: () => ({ dispose() {} }),
    },
    globalState: { get: () => undefined, update: async () => {} },
  } as unknown as vscode.ExtensionContext;
}

function disposeAll(context: vscode.ExtensionContext): void {
  for (const d of [...context.subscriptions].reverse()) {
    try {
      d.dispose();
    } catch {
      // dispose-order best effort in tests
    }
  }
}

describe('buildContainer', () => {
  const ws = vscode.workspace as unknown as {
    getConfiguration: unknown;
    onDidChangeConfiguration: unknown;
  };
  const orig = {
    getConfiguration: ws.getConfiguration,
    onDidChangeConfiguration: ws.onDidChangeConfiguration,
    createExporter: AuthProvider.prototype.createExporter,
  };
  afterEach(() => {
    ws.getConfiguration = orig.getConfiguration;
    ws.onDidChangeConfiguration = orig.onDidChangeConfiguration;
    AuthProvider.prototype.createExporter = orig.createExporter;
  });

  function stubSettings(values: Record<string, unknown>): void {
    ws.getConfiguration = () => ({
      get: (key: string, fallback?: unknown) => values[key] ?? fallback,
      update: () => Promise.resolve(),
    });
  }

  it('registers only the connectors listed in mallard.enabledConnectors', async () => {
    const dir = await tmpDir();
    stubSettings({ enabledConnectors: ['claude-code'] });
    const context = makeContext(dir);
    try {
      const container = await buildContainer(context);
      const ids = (container.ingest as unknown as { connectors: { id: string }[] }).connectors.map(
        (c) => c.id,
      );
      assert.deepEqual(ids, ['claude-code']);
    } finally {
      disposeAll(context);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rebuilds the exporter when an export setting changes, disposing the old one', async () => {
    const dir = await tmpDir();
    stubSettings({});
    const changeCbs: ConfigChangeCb[] = [];
    ws.onDidChangeConfiguration = (fn: ConfigChangeCb) => {
      changeCbs.push(fn);
      return { dispose() {} };
    };

    let built = 0;
    const disposed: number[] = [];
    AuthProvider.prototype.createExporter = async function () {
      const id = ++built;
      return {
        export: async () => {},
        dispose: () => disposed.push(id),
      } as never;
    };

    const context = makeContext(dir);
    try {
      const container = await buildContainer(context);
      assert.equal(built, 1, 'activation builds the exporter once');

      for (const cb of changeCbs) cb({ affectsConfiguration: (k) => k === 'mallard.export.transport' });
      await new Promise((r) => setImmediate(r));
      assert.equal(built, 2, 'export config change rebuilds the exporter');
      assert.deepEqual(disposed, [1], 'the replaced exporter is disposed');

      // Unrelated settings leave the exporter alone.
      for (const cb of changeCbs) cb({ affectsConfiguration: (k) => k === 'mallard.palette' });
      await new Promise((r) => setImmediate(r));
      assert.equal(built, 2);
      void container;
    } finally {
      disposeAll(context);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
