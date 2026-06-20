import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findLogFiles,
  isPathSafe,
  locateCopilotLogDirs,
  platformDefaults,
  vscodeLogRoot,
} from '../../src/ingest/locate';

async function mkdir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

async function touch(p: string): Promise<void> {
  await fs.writeFile(p, 'irrelevant\n');
}

describe('vscodeLogRoot', () => {
  it('walks up to the `logs` ancestor', () => {
    const got = vscodeLogRoot('/home/me/.vscode-server/data/logs/20260612T123456/exthost');
    assert.equal(got, path.join('/home/me/.vscode-server/data/logs'));
  });

  it('falls back to the direct parent when no `logs` ancestor exists', () => {
    const got = vscodeLogRoot('/some/random/path');
    assert.equal(got, '/some/random');
  });
});

describe('platformDefaults', () => {
  it('returns a non-empty list of paths on Linux', () => {
    const defaults = platformDefaults();
    assert.ok(defaults.length > 0);
    assert.ok(
      defaults.some((p) => p.includes('.config/Code/logs') || p.includes('.vscode-server')),
    );
  });
});

describe('locateCopilotLogDirs', () => {
  it('skips candidates that do not exist on disk', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-locate-'));
    try {
      // An override that exists → returned
      const okDir = path.join(tmp, 'logs');
      await mkdir(okDir);
      const out = await locateCopilotLogDirs(undefined, okDir);
      assert.ok(out.includes(okDir));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('findLogFiles', () => {
  it('finds copilot log files at depth 3', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-find-'));
    try {
      const file = path.join(root, 'exthost1', 'GitHub.copilot-chat', 'GitHub Copilot Chat.log');
      await mkdir(path.dirname(file));
      await touch(file);
      const out = await findLogFiles(root, [root], 5, 50);
      assert.ok(out.includes(file));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('matches .ndjson and .otel.json filenames', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-ndjson-'));
    try {
      const a = path.join(root, 'copilot.ndjson');
      const b = path.join(root, 'copilot.otel.json');
      await touch(a);
      await touch(b);
      const out = await findLogFiles(root, [root], 5, 50);
      assert.ok(out.includes(a));
      assert.ok(out.includes(b));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('ignores files that do not mention copilot', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-ignore-'));
    try {
      await touch(path.join(root, 'unrelated.log'));
      const out = await findLogFiles(root, [root], 5, 50);
      assert.equal(out.length, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('isPathSafe', () => {
  it('accepts paths under an allowed root', () => {
    assert.ok(isPathSafe('/x/y/z.log', ['/x']));
  });
  it('rejects paths containing ..', () => {
    assert.equal(isPathSafe('/x/../etc/passwd', ['/x']), false);
  });
  it('accepts the exact root path', () => {
    assert.ok(isPathSafe('/allowed', ['/allowed']));
  });
  it('rejects a path on a completely different root', () => {
    assert.equal(isPathSafe('/other/file.log', ['/allowed']), false);
  });
  it('rejects any path when allowedRoots is empty', () => {
    assert.equal(isPathSafe('/x/y.log', []), false);
  });
  it('accepts when one of multiple roots matches', () => {
    assert.ok(isPathSafe('/b/file.log', ['/a', '/b']));
  });
});
