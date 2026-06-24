/**
 * Mallard Plugin Optimization Benchmarks — DuckDB Edition
 *
 * Covers the actual hot paths after the star-schema rework:
 *   1. Write pipeline: batch insert (includes refreshFacts), standalone refreshFacts, compact
 *   2. Read queries: find, count, bucket, queryFacts, rank, pivot, aggregate
 *   3. End-to-end: find → buildSnapshot (JS aggregation layer on top of DuckDB results)
 *
 * Uses a SINGLE DuckDB instance throughout (store.writer.clear() between suites) to
 * avoid the process-level buffer-pool leak that occurs when opening many instances.
 *
 * Run with:  npx tsx test/bench/benchmark.ts
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { performance } from 'perf_hooks';

import { EventStore } from '../../src/store/EventStore';
import { buildSnapshot } from '../../src/domain/snapshot';
import type { UsageEvent } from '../../src/domain/types';
import type { RecordFilter } from '../../src/store/EventRepository';
import { DAY_MS } from '../../src/util/time';

// ─── Data generators ────────────────────────────────────────────────────────

const MODELS:   string[]                = ['gpt-4o', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'o3', 'gemini-2-flash'];
const SURFACES: UsageEvent['surface'][] = ['chat', 'inline', 'agent', 'edit', 'unknown'];
const REPOS:    (string | undefined)[]  = ['acme/frontend', 'acme/backend', 'acme/infra', 'acme/shared', undefined];
const SOURCES:  UsageEvent['source'][]  = ['local', 'local', 'local', 'github', 'claude-code'];

let eventUid = 0;

function makeEvent(ts: number, prefix: string): UsageEvent {
  const i = eventUid++;
  const credits = 1 + (i % 10);
  const cost    = credits * 0.04;
  const repo    = REPOS[i % REPOS.length];
  return {
    id:               `${prefix}-${i}`,
    ts,
    modelId:          MODELS[i % MODELS.length]!,
    surface:          SURFACES[i % SURFACES.length]!,
    source:           SOURCES[i % SOURCES.length]!,
    credits,
    cost,
    promptTokens:     100 + (i % 2000),
    completionTokens: 20  + (i % 500),
    estimated:        false,
    ...(repo !== undefined ? { repo } : {}),
    costByCategory:   { input: cost * 0.7, output: cost * 0.3 },
  };
}

function generateEvents(count: number, windowDays = 90, prefix = 'e'): UsageEvent[] {
  const now = Date.now();
  return Array.from({ length: count }, () =>
    makeEvent(now - Math.floor(Math.random() * windowDays) * DAY_MS, prefix),
  );
}

function generateOldEvents(count: number, prefix = 'old'): UsageEvent[] {
  const now = Date.now();
  return Array.from({ length: count }, () =>
    makeEvent(now - (100 + Math.floor(Math.random() * 80)) * DAY_MS, prefix),
  );
}

// ─── Harness ────────────────────────────────────────────────────────────────

interface Result {
  name: string;
  iterations: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  opsPerSec: number;
}

const results: Result[] = [];

async function bench(
  name: string,
  fn: () => Promise<void>,
  opts: { warmup?: number; iters?: number } = {},
): Promise<void> {
  const warmup = opts.warmup ?? 2;
  const iters  = opts.iters  ?? 20;

  for (let i = 0; i < warmup; i++) await fn();

  const times: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }

  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  results.push({
    name,
    iterations: iters,
    meanMs:    mean,
    minMs:     Math.min(...times),
    maxMs:     Math.max(...times),
    opsPerSec: 1000 / mean,
  });
}

// ─── Suite helpers ───────────────────────────────────────────────────────────

/** Reset the store and seed it with fresh events (not timed). */
async function seed(store: EventStore, count: number, windowDays = 90, prefix = 'e'): Promise<void> {
  await store.writer.clear();
  if (count > 0) await store.writer.insert(generateEvents(count, windowDays, prefix));
  // insert() only refreshes today's fact window; rebuild the full window so
  // queryFacts benchmarks reflect the actual seeded event count, not just today's slice.
  if (count > 0) await (store.writer as any).refreshFacts(0, Date.now() + DAY_MS);
  // Flush WAL + encourage buffer pool eviction between suites.
  await (store as any).conn.run('CHECKPOINT');
}

// ─── Suite 1: Write Pipeline ─────────────────────────────────────────────────

async function benchmarkWrites(store: EventStore): Promise<void> {
  console.log('\n── Write Pipeline ──────────────────────────────────────────');

  // insert(): pre-seed with 2k background events so refreshFacts has realistic
  // existing data to merge with.  Each iteration appends a fresh batch of unique events.
  for (const [batchSize, iters] of [[100, 8], [1_000, 5], [10_000, 3]] as const) {
    await seed(store, 2_000, 90, `bg${batchSize}`);
    await bench(`insert ${batchSize.toString().padStart(6)} events  (+ refreshFacts today)`, async () => {
      await store.writer.insert(generateEvents(batchSize, 30, `w${batchSize}`));
    }, { warmup: 0, iters });
  }

  // refreshFacts standalone: the full star-schema rebuild over the entire window.
  await seed(store, 10_000, 90, 'rfbg');
  await bench('refreshFacts — full window rebuild  (10k events)', async () => {
    await (store.writer as any).refreshFacts(0, Date.now() + DAY_MS);
  }, { warmup: 1, iters: 8 });

  // compact(): rolls up events older than 90 d into daily summaries + deletes raw.
  // Re-inserts old events before each iteration so compact() always has work.
  let compactPass = 0;
  await seed(store, 0);
  await bench('compact()  — 10k old events  (rollup + DELETE)', async () => {
    await store.writer.insert(generateOldEvents(10_000, `cp${compactPass++}`));
    await store.writer.compact();
  }, { warmup: 0, iters: 3 });
}

// ─── Suite 2: Read Queries ───────────────────────────────────────────────────

async function benchmarkReads(store: EventStore, count: number): Promise<void> {
  const now   = Date.now();
  const noFilter: RecordFilter = {};
  const narrow: RecordFilter   = { range: { start: now - 30 * DAY_MS, end: now }, models: ['gpt-4o'] };

  // find() caps at 5k rows for large stores to bound per-iteration JS allocation.
  const findFilter = count > 2_000 ? { ...noFilter, limit: 2_000 } : noFilter;
  const findLabel  = count > 2_000 ? 'find (limit 2k)          ' : 'find (no filter)         ';
  await bench(`${findLabel} (${count})`, async () => { await store.reader.find(findFilter); });
  await bench(`find (model + 30d filter)  (${count})`, async () => { await store.reader.find(narrow); });
  await bench(`count                      (${count})`, async () => { await store.reader.count(noFilter); });

  for (const by of ['day', 'week', 'month', 'hour', 'weekday'] as const) {
    await bench(`bucket(${by.padEnd(7)})            (${count})`, async () => {
      await store.reader.bucket(noFilter, by);
    });
  }

  await bench(`queryFacts (no filter)     (${count})`, async () => { await store.reader.queryFacts(); });
  await bench(`queryFacts (model filter)  (${count})`, async () => {
    await store.reader.queryFacts({ models: ['gpt-4o'] });
  });
  await bench(`rank credits top-10        (${count})`, async () => {
    await store.reader.rank(noFilter, 'credits', 10);
  });
  await bench(`pivot surface × credits    (${count})`, async () => {
    await store.reader.pivot(noFilter, 'surface', 'credits');
  });
  await bench(`aggregate credits+cost     (${count})`, async () => {
    await store.reader.aggregate(noFilter, ['credits', 'cost']);
  });
}

// ─── Suite 3: Full Snapshot Pipeline ─────────────────────────────────────────

async function benchmarkSnapshot(store: EventStore, count: number): Promise<void> {
  const now  = Date.now();
  const opts = {
    now,
    currency:        'USD',
    pricePerCredit:  0.04,
    monthlyBudget:   50,
    includedCredits: 300,
    filter:          {},
    source:          'local'       as const,
    status:          { kind: 'ok' as const },
    authStatus:      'signed-out'  as const,
  };

  // Cap find() at 10k rows for the JS snapshot path so memory doesn't blow up at 100k.
  const snapFilter = count > 10_000 ? { limit: 10_000 } : {};
  const snapLabel  = count > 10_000 ? `find (limit 10k) + buildSnapshot` : `find + buildSnapshot      `;
  await bench(`${snapLabel} (${count})`, async () => {
    const events = await store.reader.find(snapFilter);
    buildSnapshot(events, opts);
  }, { warmup: 1, iters: 10 });

  await bench(`readSnapshotCache          (${count})`, async () => {
    await store.reader.readSnapshotCache();
  }, { warmup: 1, iters: 10 });
}

// ─── Runner ─────────────────────────────────────────────────────────────────

function printTable(): void {
  const W = { name: 54, iters: 7, ms: 10, ops: 12 };
  const pad  = (s: string, n: number) => s.padEnd(n);
  const rpad = (s: string, n: number) => s.padStart(n);

  const header =
    pad('Benchmark', W.name) +
    rpad('Iters', W.iters) +
    rpad('Mean (ms)', W.ms) +
    rpad('Min (ms)', W.ms) +
    rpad('Max (ms)', W.ms) +
    rpad('ops/sec', W.ops);

  const sep = '─'.repeat(header.length);
  console.log('\n' + sep);
  console.log(header);
  console.log(sep);

  for (const r of results) {
    const ops = r.opsPerSec < 10 ? r.opsPerSec.toFixed(2) : Math.round(r.opsPerSec).toString();
    console.log(
      pad(r.name, W.name) +
      rpad(String(r.iterations), W.iters) +
      rpad(r.meanMs.toFixed(3), W.ms) +
      rpad(r.minMs.toFixed(3), W.ms) +
      rpad(r.maxMs.toFixed(3), W.ms) +
      rpad(ops, W.ops),
    );
  }

  console.log(sep);
  console.log(`\nTotal benchmarks: ${results.length}`);
}

async function main(): Promise<void> {
  console.log('Mallard DuckDB Benchmarks');
  console.log(`Node.js ${process.version}  |  ${new Date().toISOString()}`);

  // Single shared instance — DuckDB leaks process-level buffer pool pages when
  // multiple instances are opened sequentially, exhausting available memory.
  const tmp   = mkdtempSync(join(tmpdir(), 'mallard-bench-'));
  const store = await EventStore.open(tmp);
  // Don't cap memory: DuckDB's refreshFacts 5-way JOIN needs its full buffer pool.
  // A single shared instance avoids the multi-instance accumulation problem, so
  // DuckDB's native LRU (default 80% of RAM) manages eviction correctly.
  await (store as any).conn.run("SET threads=2");

  await benchmarkWrites(store);

  for (const count of [1_000, 5_000, 10_000, 100_000]) {
    console.log(`\n── Read Queries (${count} events) ${'─'.repeat(35)}`);
    await seed(store, count, 90, `r${count}`);
    await benchmarkReads(store, count);
  }

  console.log('\n── Full Snapshot Pipeline ──────────────────────────────────');
  for (const count of [1_000, 10_000, 100_000]) {
    await seed(store, count, 90, `s${count}`);
    await benchmarkSnapshot(store, count);
  }

  store.dispose();
  rmSync(tmp, { recursive: true, force: true });

  printTable();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
