/**
 * Mallard Plugin Optimization Benchmarks — DuckDB Edition
 *
 * Covers the actual hot paths after the star-schema rework:
 *   1. Write pipeline: batch insert (includes refreshFacts), standalone refreshFacts, compact
 *   2. Read queries: find, count, bucket, queryFacts, rank, pivot, aggregate
 *   3. End-to-end: find → buildSnapshot (JS aggregation layer on top of DuckDB results)
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

function makeEvent(ts: number, idPrefix = 'e'): UsageEvent {
  const i = eventUid++;
  const credits = 1 + (i % 10);
  const cost = credits * 0.04;
  return {
    id: `${idPrefix}-${i}`,
    ts,
    modelId:          MODELS[i % MODELS.length]!,
    surface:          SURFACES[i % SURFACES.length]!,
    source:           SOURCES[i % SOURCES.length]!,
    credits,
    cost,
    promptTokens:     100 + (i % 2000),
    completionTokens: 20  + (i % 500),
    estimated:        false,
    repo:             REPOS[i % REPOS.length],
    costByCategory:   { input: cost * 0.7, output: cost * 0.3 },
  };
}

function generateEvents(count: number, windowDays = 90, idPrefix = 'e'): UsageEvent[] {
  const now = Date.now();
  return Array.from({ length: count }, () =>
    makeEvent(now - Math.floor(Math.random() * windowDays) * DAY_MS, idPrefix),
  );
}

/** Events dated 100–180 days ago so compact() picks them up immediately. */
function generateOldEvents(count: number, idPrefix = 'old'): UsageEvent[] {
  const now = Date.now();
  return Array.from({ length: count }, () =>
    makeEvent(now - (100 + Math.floor(Math.random() * 80)) * DAY_MS, idPrefix),
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

async function benchAsync(
  name: string,
  fn: () => Promise<void>,
  opts: { warmup?: number; iters?: number } = {},
): Promise<void> {
  const warmup = opts.warmup ?? 3;
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
    meanMs:   mean,
    minMs:    Math.min(...times),
    maxMs:    Math.max(...times),
    opsPerSec: 1000 / mean,
  });
}

// ─── Suite 1: Write Pipeline ─────────────────────────────────────────────────

async function benchmarkWrites(): Promise<void> {
  console.log('\n── Write Pipeline ──────────────────────────────────────────');

  // insert() benchmark: each iteration inserts a fresh batch of unique events.
  // Measures: batch INSERT + count check + refreshFacts(today window).
  for (const [batchSize, warmup, iters] of [[100, 2, 10], [1_000, 1, 5], [10_000, 0, 3]] as const) {
    const tmp = mkdtempSync(join(tmpdir(), 'mallard-write-'));
    const store = await EventStore.open(tmp);

    await benchAsync(`insert ${batchSize} events (+ refreshFacts today)`, async () => {
      const events = generateEvents(batchSize, 30, `ins${batchSize}`);
      await store.writer.insert(events);
    }, { warmup, iters });

    store.dispose();
    rmSync(tmp, { recursive: true, force: true });
  }

  // refreshFacts standalone: measures the full fact-table rebuild for a given window.
  // This is called once per insert() and once during compact().
  {
    const tmp = mkdtempSync(join(tmpdir(), 'mallard-facts-'));
    const store = await EventStore.open(tmp);
    await store.writer.insert(generateEvents(10_000, 90, 'rf'));

    await benchAsync('refreshFacts full-window (10k events)', async () => {
      await (store.writer as any).refreshFacts(0, Date.now() + DAY_MS);
    }, { warmup: 2, iters: 10 });

    store.dispose();
    rmSync(tmp, { recursive: true, force: true });
  }

  // compact(): rolls up events older than RAW_WINDOW_DAYS (90 d) into daily summaries.
  // Re-seeds between iterations so each compact() has real work to do.
  {
    const tmp = mkdtempSync(join(tmpdir(), 'mallard-compact-'));
    const store = await EventStore.open(tmp);
    let compactIter = 0;

    await benchAsync('compact() — 10k old events → daily rollup + DELETE', async () => {
      // Re-seed before each compact so there is always raw material.
      await store.writer.insert(generateOldEvents(10_000, `cp${compactIter++}`));
      await store.writer.compact();
    }, { warmup: 0, iters: 3 });

    store.dispose();
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ─── Suite 2: Read Queries ───────────────────────────────────────────────────

async function benchmarkReads(store: EventStore, count: number): Promise<void> {
  const now      = Date.now();
  const noFilter: RecordFilter = {};
  const modelRangeFilter: RecordFilter = {
    range:  { start: now - 30 * DAY_MS, end: now },
    models: ['gpt-4o'],
  };

  await benchAsync(`find — no filter          (${count})`, async () => {
    await store.reader.find(noFilter);
  });

  await benchAsync(`find — model+30d filter   (${count})`, async () => {
    await store.reader.find(modelRangeFilter);
  });

  await benchAsync(`count                     (${count})`, async () => {
    await store.reader.count(noFilter);
  });

  for (const by of ['day', 'week', 'month', 'hour', 'weekday'] as const) {
    await benchAsync(`bucket(${by.padEnd(7)})             (${count})`, async () => {
      await store.reader.bucket(noFilter, by);
    });
  }

  await benchAsync(`queryFacts — no filter    (${count})`, async () => {
    await store.reader.queryFacts();
  });

  await benchAsync(`queryFacts — model filter (${count})`, async () => {
    await store.reader.queryFacts({ models: ['gpt-4o'] });
  });

  await benchAsync(`rank credits top-10       (${count})`, async () => {
    await store.reader.rank(noFilter, 'credits', 10);
  });

  await benchAsync(`pivot surface × credits   (${count})`, async () => {
    await store.reader.pivot(noFilter, 'surface', 'credits');
  });

  await benchAsync(`aggregate credits+cost    (${count})`, async () => {
    await store.reader.aggregate(noFilter, ['credits', 'cost']);
  });
}

// ─── Suite 3: Full Snapshot Pipeline ─────────────────────────────────────────

async function benchmarkSnapshot(store: EventStore, count: number): Promise<void> {
  const now = Date.now();
  const opts = {
    now,
    currency:        'USD',
    pricePerCredit:  0.04,
    monthlyBudget:   50,
    includedCredits: 300,
    filter:          {},
    source:          'local' as const,
    status:          { kind: 'ok' as const },
    authStatus:      'signed-out' as const,
  };

  await benchAsync(`find + buildSnapshot      (${count})`, async () => {
    const events = await store.reader.find({});
    buildSnapshot(events, opts);
  }, { warmup: 2, iters: 10 });
}

// ─── Runner ─────────────────────────────────────────────────────────────────

function printTable(): void {
  const W = { name: 52, iters: 7, ms: 10, ops: 12 };
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
    const row =
      pad(r.name, W.name) +
      rpad(String(r.iterations), W.iters) +
      rpad(r.meanMs.toFixed(3), W.ms) +
      rpad(r.minMs.toFixed(3), W.ms) +
      rpad(r.maxMs.toFixed(3), W.ms) +
      rpad(r.opsPerSec < 10 ? r.opsPerSec.toFixed(2) : Math.round(r.opsPerSec).toString(), W.ops);
    console.log(row);
  }

  console.log(sep);
  console.log(`\nTotal benchmarks: ${results.length}`);
}

async function main(): Promise<void> {
  console.log('Mallard DuckDB Benchmarks');
  console.log(`Node.js ${process.version}  |  ${new Date().toISOString()}`);

  await benchmarkWrites();

  for (const count of [1_000, 10_000, 50_000]) {
    console.log(`\n── Read Queries (${count} events) ${'─'.repeat(35)}`);
    const tmp   = mkdtempSync(join(tmpdir(), `mallard-read${count}-`));
    const store = await EventStore.open(tmp);
    await store.writer.insert(generateEvents(count, 90, `r${count}`));

    await benchmarkReads(store, count);

    store.dispose();
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log('\n── Full Snapshot Pipeline ──────────────────────────────────');
  for (const count of [1_000, 10_000]) {
    const tmp   = mkdtempSync(join(tmpdir(), `mallard-snap${count}-`));
    const store = await EventStore.open(tmp);
    await store.writer.insert(generateEvents(count, 90, `s${count}`));

    await benchmarkSnapshot(store, count);

    store.dispose();
    rmSync(tmp, { recursive: true, force: true });
  }

  printTable();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
