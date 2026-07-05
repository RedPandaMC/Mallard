import { strict as assert } from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CopilotOtelRequirement } from '../../../src/extension-backend/ingest/CopilotOtelRequirement';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const ws = vscode.workspace as Mutable<typeof vscode.workspace>;

const ctxWith = (dir: string): vscode.ExtensionContext =>
  ({ globalStorageUri: { fsPath: dir } }) as unknown as vscode.ExtensionContext;

describe('CopilotOtelRequirement', () => {
  const origGet = ws.getConfiguration;
  afterEach(() => { ws.getConfiguration = origGet; });

  function withOtel(copilot: Record<string, unknown>, mallard: Record<string, unknown> = {}) {
    ws.getConfiguration = ((section: string) => ({
      get: (key: string, fallback?: unknown) => {
        const src = section === 'mallard' ? mallard : copilot;
        return key in src ? src[key] : fallback;
      },
      update: () => Promise.resolve(),
    })) as never;
  }

  it('declares a stable id and watch keys', () => {
    const req = new CopilotOtelRequirement();
    assert.equal(req.id, 'copilot-otel');
    assert.ok(req.watchKeys.includes('github.copilot.chat.otel.exporterType'));
  });

  it('isSatisfied reflects the resolved OTel source', () => {
    const req = new CopilotOtelRequirement();
    withOtel({});
    assert.equal(req.isSatisfied(), false);
    withOtel({ 'otel.exporterType': 'file', 'otel.outfile': '/x/a.jsonl' });
    assert.equal(req.isSatisfied(), true);
  });

  it('apply writes the file exporter settings and asks for a reload', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-otelreq-'));
    const writes: unknown[][] = [];
    ws.getConfiguration = (() => ({
      get: () => undefined,
      update: (...a: unknown[]) => { writes.push(a); return Promise.resolve(); },
    })) as never;
    try {
      const result = await new CopilotOtelRequirement().apply(ctxWith(dir));
      assert.equal(result.ok, true);
      assert.equal(result.reloadHint, true);
      assert.ok(writes.some((w) => w[0] === 'otel.exporterType' && w[1] === 'file'));
      assert.ok(writes.some((w) => w[0] === 'otel.outfile' && String(w[1]).endsWith('copilot-otel.jsonl')));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('apply returns ok:false when the storage dir cannot be created', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-otelreq-'));
    const asFile = path.join(base, 'not-a-dir');
    await fs.writeFile(asFile, 'x'); // globalStorage points at a file → mkdir fails
    ws.getConfiguration = (() => ({ get: () => undefined, update: () => Promise.resolve() })) as never;
    try {
      const result = await new CopilotOtelRequirement().apply(ctxWith(asFile));
      assert.equal(result.ok, false);
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});
