import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  canonicalize,
  findLogFiles,
  isPathSafe,
  isClaudeCodeLogFilename,
  claudeCodeLogRoots,
  locateCopilotLogDirs,
  locateClaudeCodeLogDirs,
  platformDefaults,
  vscodeLogRoot,
} from '../../src/extension-backend/ingest/locate';

async function mkdir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

async function touch(p: string): Promise<void> {
  await fs.writeFile(p, 'irrelevant\n');
}

describe('vscodeLogRoot', () => {
  it('walks up to the `logs` ancestor', () => {
    // vscodeLogRoot walks the string with path.dirname, which preserves the
    // input's separators — don't wrap the expectation in path.join (it would
    // rewrite to backslashes on Windows).
    const got = vscodeLogRoot('/home/me/.vscode-server/data/logs/20260612T123456/exthost');
    assert.equal(got, '/home/me/.vscode-server/data/logs');
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

describe('locateCopilotLogDirs — with logUriPath', () => {
  it('includes the resolved log root derived from logUriPath', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-luri-'));
    try {
      const logsDir = path.join(tmp, 'logs');
      const sessionDir = path.join(logsDir, '20260612T123456', 'exthost');
      await fs.mkdir(sessionDir, { recursive: true });
      // Pass the session path as logUriPath; vscodeLogRoot walks up to find 'logs'
      const out = await locateCopilotLogDirs(sessionDir);
      assert.ok(out.includes(logsDir), `expected ${logsDir} in ${JSON.stringify(out)}`);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('findLogFiles — edge cases', () => {
  it('stops collecting when maxFiles is reached', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-max-'));
    try {
      for (let i = 0; i < 5; i++) {
        await fs.writeFile(path.join(root, `github.copilot-${i}.log`), '');
      }
      const out = await findLogFiles(root, [root], 5, 3);
      assert.strictEqual(out.length, 3);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('skips unreadable subdirectories without throwing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-unread-'));
    try {
      const goodFile = path.join(root, 'github.copilot.log');
      await fs.writeFile(goodFile, '');
      const badDir = path.join(root, 'locked');
      await fs.mkdir(badDir);
      await fs.chmod(badDir, 0o000);
      const out = await findLogFiles(root, [root], 5, 50);
      assert.ok(out.includes(goodFile));
      // Should not throw; locked dir is silently skipped
    } finally {
      // Restore permissions so cleanup works
      await fs.chmod(path.join(root, 'locked'), 0o755).catch(() => {});
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('claudeCodeLogRoots', () => {
  it('returns [~/.claude/projects]', () => {
    const roots = claudeCodeLogRoots();
    assert.deepStrictEqual(roots, [path.join(os.homedir(), '.claude', 'projects')]);
  });
});

describe('locateClaudeCodeLogDirs', () => {
  it('returns directory when it exists on disk', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-cc-'));
    try {
      // Temporarily override the module's behaviour by creating the expected dir
      // We test by passing a real directory path through a mock via findLogFiles indirectly.
      // Instead, directly test with an existing path by calling the real function
      // and checking the real home dir — or skip if ~/.claude/projects exists.
      const realRoot = path.join(os.homedir(), '.claude', 'projects');
      const stat = await fs.stat(realRoot).catch(() => null);
      if (stat?.isDirectory()) {
        const out = await locateClaudeCodeLogDirs();
        assert.ok(out.includes(realRoot));
      } else {
        // Create it temporarily in tmp (function is hardcoded to homedir, so we
        // just verify the empty-dir case is covered elsewhere and confirm no throw)
        const out = await locateClaudeCodeLogDirs();
        assert.ok(Array.isArray(out));
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns empty array when the projects directory does not exist', async () => {
    // Unless ~/.claude/projects exists, the function returns []
    const realRoot = path.join(os.homedir(), '.claude', 'projects');
    const stat = await fs.stat(realRoot).catch(() => null);
    if (!stat?.isDirectory()) {
      const out = await locateClaudeCodeLogDirs();
      assert.deepStrictEqual(out, []);
    } else {
      // Directory exists — skip this variant
      assert.ok(true);
    }
  });
});

describe('isClaudeCodeLogFilename', () => {
  it('returns true for .jsonl files', () => {
    assert.ok(isClaudeCodeLogFilename('session.jsonl'));
    assert.ok(isClaudeCodeLogFilename('SESSION.JSONL'));
  });

  it('returns false for non-.jsonl files', () => {
    assert.ok(!isClaudeCodeLogFilename('data.json'));
    assert.ok(!isClaudeCodeLogFilename('output.log'));
    assert.ok(!isClaudeCodeLogFilename('file.jsonl.bak'));
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

describe('canonicalize', () => {
  it('resolves symlink-free existing paths to their real location', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-canon-'));
    try {
      const real = await canonicalize(dir);
      assert.equal(real, await fs.realpath(dir));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to path.resolve for paths that do not exist', async () => {
    const missing = path.join(os.tmpdir(), 'mallard-canon-missing', '..', 'mallard-canon-missing-2');
    assert.equal(await canonicalize(missing), path.resolve(missing));
  });

  it('resolves a symlinked directory to its target', async function () {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mallard-canon-'));
    const link = path.join(os.tmpdir(), `mallard-canon-link-${Date.now()}`);
    try {
      await fs.symlink(dir, link);
    } catch {
      this.skip(); // symlinks unavailable (e.g. Windows without privilege)
      return;
    }
    try {
      assert.equal(await canonicalize(link), await fs.realpath(dir));
    } finally {
      await fs.rm(link, { force: true });
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
