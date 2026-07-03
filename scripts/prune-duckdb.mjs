/**
 * Prepare node_modules/@duckdb for a platform-specific VSIX.
 *
 * Why: `.vscodeignore` re-includes @duckdb so the native DuckDB binding ships
 * inside the VSIX. Without pruning, `vsce package` bundles EVERY platform's
 * binding present in node_modules (~35–70 MB each) — and is silently broken
 * on platforms whose binding the packing machine never installed (macOS/ARM).
 * This script installs exactly the binding for the requested vsce target and
 * deletes every other one, so `vsce package --target <t>` produces a small,
 * correct artifact.
 *
 * Usage: node scripts/prune-duckdb.mjs <vsce-target>
 *   e.g. node scripts/prune-duckdb.mjs win32-x64
 *
 * Run `bun install` afterwards to restore a normal dev tree.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';

// vsce --target → @duckdb/node-bindings-* package suffix
const TARGET_TO_BINDING = {
  'win32-x64': 'win32-x64',
  'win32-arm64': 'win32-arm64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'alpine-x64': 'linux-x64-musl',
  'alpine-arm64': 'linux-arm64-musl',
  'darwin-x64': 'darwin-x64',
  'darwin-arm64': 'darwin-arm64',
};

const target = process.argv[2];
const binding = TARGET_TO_BINDING[target];
if (!binding) {
  console.error(
    `usage: node scripts/prune-duckdb.mjs <target>\n` +
      `  targets: ${Object.keys(TARGET_TO_BINDING).join(', ')}`,
  );
  process.exit(1);
}

const duckdbDir = path.resolve('node_modules', '@duckdb');
const keep = `node-bindings-${binding}`;

// Pin the binding to the exact version @duckdb/node-bindings resolves, so a
// cross-target install can't drift from what the resolver shim expects.
const resolverPkg = JSON.parse(
  readFileSync(path.join(duckdbDir, 'node-bindings', 'package.json'), 'utf8'),
);
const version = resolverPkg.optionalDependencies[`@duckdb/${keep}`] ?? resolverPkg.version;

if (!existsSync(path.join(duckdbDir, keep))) {
  console.log(`installing @duckdb/${keep}@${version} …`);
  // npm with --force: unlike bun, npm will install a package whose os/cpu
  // fields don't match the host, which is exactly what packing another
  // platform's VSIX needs. --no-save keeps the lockfile untouched.
  execSync(
    `npm install --no-save --force --ignore-scripts --no-audit --no-fund @duckdb/${keep}@${version}`,
    { stdio: 'inherit' },
  );
}

let removed = 0;
for (const entry of readdirSync(duckdbDir)) {
  if (entry.startsWith('node-bindings-') && entry !== keep) {
    rmSync(path.join(duckdbDir, entry), { recursive: true, force: true });
    removed++;
  }
}

if (!existsSync(path.join(duckdbDir, keep))) {
  console.error(`@duckdb/${keep} is missing after install — aborting`);
  process.exit(1);
}

console.log(`kept @duckdb/${keep}@${version}; removed ${removed} other binding(s)`);
