/**
 * Mallard Plugin Optimization Benchmarks
 *
 * Run with:  npx tsx test/bench/benchmark.ts
 *            bun test/bench/benchmark.ts
 *
 * Benchmarks cover the four performance-critical paths:
 *   1. Event aggregation (aggregateBy / aggregateAll / topBy / sumEvents / sankey)
 *   2. Forecasting (linear and Holt-Winters seasonal)
 *   3. Chart-data assembly (dailyBars, heatmap, hourly, category, full buildChartData)
 *   4. Full snapshot pipeline (buildSnapshot)
 */

import { performance } from 'perf_hooks';

import {
  aggregateAll,
  aggregateBy,
  distinctModels,
  distinctRepos,
  distinctSurfaces,
  sankeyLinksFor,
  sumEvents,
  topBy,
} from '../../src/domain/aggregate';
import {
  buildCategoryBreakdownData,
  buildDailyBarsData,
  buildHeatmapData,
  buildHourlyTimelineData,
  buildChartData,
  buildModelBreakdownData,
} from '../../src/domain/chartData';
import { forecastMonth, fitHoltWinters } from '../../src/domain/forecast';
import { linearForecaster } from '../../src/domain/forecasters/linear';
import { seasonalForecaster } from '../../src/domain/forecasters/seasonal';
import { buildSnapshot } from '../../src/domain/snapshot';
import {
  BudgetState,
  Filter,
  UsageAggregate,
  UsageEvent,
} from '../../src/domain/types';
import { DAY_MS, startOf } from '../../src/util/time';

// ─── Data generators ────────────────────────────────────────────────────────

const MODELS = [
  'gpt-4o',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'o3',
  'gemini-2-flash',
];
const SURFACES: UsageEvent['surface'][] = ['chat', 'inline', 'agent', 'edit', 'unknown'];
const REPOS = ['acme/frontend', 'acme/backend', 'acme/infra', 'acme/shared', 'unattributed'];

let uid = 0;

function makeEvent(ts: number): UsageEvent {
  uid++;
  const credits = Math.random() * 10;
  const cost = credits * 0.04;
  const promptTokens = Math.floor(Math.random() * 2000);
  const completionTokens = Math.floor(Math.random() * 500);
  return {
    id: `e${uid}`,
    ts,
    modelId: MODELS[uid % MODELS.length]!,
    surface: SURFACES[uid % SURFACES.length]!,
    source: 'local',
    credits,
    cost,
    promptTokens,
    completionTokens,
    estimated: false,
    repo: REPOS[uid % REPOS.length]!,
    costByCategory: {
      input: cost * 0.7,
      output: cost * 0.3,
    },
  };
}

/**
 * Generate `count` synthetic events spread over the past `windowDays` days,
 * a few events per day, with some days having more activity.
 */
function generateEvents(count: number, windowDays = 90): UsageEvent[] {
  const now = Date.now();
  const events: UsageEvent[] = [];
  for (let i = 0; i < count; i++) {
    const daysBack = Math.floor(Math.random() * windowDays);
    const hoursOffset = Math.floor(Math.random() * 24) * 3_600_000;
    const ts = now - daysBack * DAY_MS - hoursOffset;
    events.push(makeEvent(ts));
  }
  return events;
}

/** Build a daily credit series for forecasting (one value per day). */
function dailySeries(days: number): number[] {
  const series: number[] = [];
  for (let i = 0; i < days; i++) {
    // Simulate weekday/weekend pattern + noise
    const weekday = i % 7;
    const base = weekday < 5 ? 15 : 5;
    series.push(Math.max(0, base + (Math.random() - 0.5) * 8));
  }
  return series;
}

/** Build day-granularity aggregates from a credit series. */
function makeAggregates(series: number[]): UsageAggregate[] {
  const now = startOf(Date.now(), 'month');
  return series.map((credits, i) => {
    const start = now - (series.length - i) * DAY_MS;
    return {
      granularity: 'day',
      bucketKey: `bucket-${i}`,
      start,
      end: start + DAY_MS,
      credits,
      cost: credits * 0.04,
      tokens: credits * 1000,
      byModel: {},
      eventCount: Math.ceil(credits),
      estimated: false,
    };
  });
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

function bench(name: string, fn: () => void, opts: { warmup?: number; iters?: number } = {}): void {
  const warmup = opts.warmup ?? 5;
  const iters = opts.iters ?? 50;

  for (let i = 0; i < warmup; i++) fn();

  const times: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }

  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  results.push({
    name,
    iterations: iters,
    meanMs: mean,
    minMs: min,
    maxMs: max,
    opsPerSec: 1000 / mean,
  });
}

// ─── Benchmark suites ────────────────────────────────────────────────────────

function benchmarkAggregation(): void {
  console.log('\n── Aggregation ─────────────────────────────────────────────');

  for (const count of [1_000, 10_000, 50_000]) {
    const events = generateEvents(count);

    bench(`aggregateBy(${count} events, 'day')`,    () => aggregateBy(events, 'day'));
    bench(`aggregateBy(${count} events, 'week')`,   () => aggregateBy(events, 'week'));
    bench(`aggregateBy(${count} events, 'month')`,  () => aggregateBy(events, 'month'));
    bench(`aggregateAll(${count} events)`,          () => aggregateAll(events));
    bench(`topBy model   (${count} events)`,        () => topBy(events, 'model'));
    bench(`topBy repo    (${count} events)`,        () => topBy(events, 'repo'));
    bench(`sumEvents     (${count} events)`,        () => sumEvents(events));
    bench(`sankeyLinksFor(${count} events)`,        () => sankeyLinksFor(events));
    bench(`distinctModels(${count} events)`,        () => distinctModels(events));
    bench(`distinctRepos (${count} events)`,        () => distinctRepos(events));
    bench(`distinctSurf  (${count} events)`,        () => distinctSurfaces(events));
  }
}

function benchmarkForecasting(): void {
  console.log('\n── Forecasting ─────────────────────────────────────────────');
  const now = Date.now();

  for (const days of [7, 14, 30, 90]) {
    const series = dailySeries(days);
    const aggregates = makeAggregates(series);

    bench(`fitHoltWinters(${days} day series)`, () => fitHoltWinters(series), { iters: 20 });

    bench(`linearForecaster   (${days} days)`, () =>
      linearForecaster.forecast({ dayAggregates: aggregates, now, pricePerCredit: 0.04 }));

    if (days >= 14) {
      bench(`seasonalForecaster (${days} days, includes fit)`, () =>
        seasonalForecaster.forecast({ dayAggregates: aggregates, now, pricePerCredit: 0.04 }), {
          warmup: 2,
          iters: 10,
        });
    }

    bench(`forecastMonth (${days} days, auto-select)`, () =>
      forecastMonth(aggregates, now, 0.04));
  }
}

function benchmarkChartData(): void {
  console.log('\n── Chart Data Assembly ─────────────────────────────────────');
  const now = Date.now();
  const series30 = dailySeries(30);
  const aggregates30 = makeAggregates(series30);
  const forecast = forecastMonth(aggregates30, now, 0.04);
  const budget: BudgetState = {
    monthly: 50,
    includedCredits: 300,
    usedCredits: 100,
    usedCost: 4,
    percentOfBudget: 8,
    percentOfIncluded: 33,
    projectedOverage: null,
    pace: 'under',
  };

  bench('buildDailyBarsData (30 day aggregates)', () =>
    buildDailyBarsData(aggregates30, budget, forecast, now));

  bench('buildHeatmapData (30 day aggregates)', () =>
    buildHeatmapData(aggregates30, now));

  for (const count of [1_000, 10_000]) {
    const events = generateEvents(count);
    bench(`buildHourlyTimelineData (${count} events)`, () =>
      buildHourlyTimelineData(events));
    bench(`buildCategoryBreakdownData (${count} events)`, () =>
      buildCategoryBreakdownData(events));
  }

  const topModels = topBy(generateEvents(5_000), 'model');
  bench('buildModelBreakdownData', () =>
    buildModelBreakdownData(topModels, 0.04));

  bench('buildChartData — full (30 day aggregates, 5k events)', () => {
    const events = generateEvents(5_000);
    buildChartData(
      aggregates30,
      topModels,
      budget,
      forecast,
      now,
      buildCategoryBreakdownData(events),
      buildHourlyTimelineData(events),
      0.04,
    );
  }, { warmup: 3, iters: 20 });
}

function benchmarkFullSnapshot(): void {
  console.log('\n── Full Snapshot Pipeline ──────────────────────────────────');
  const now = Date.now();
  const filter: Filter = {};
  const opts = {
    now,
    currency: 'USD',
    pricePerCredit: 0.04,
    monthlyBudget: 50,
    includedCredits: 300,
    filter,
    source: 'local' as const,
    status: { kind: 'ok' as const },
    authStatus: 'signed-out' as const,
  };

  for (const count of [1_000, 5_000, 10_000]) {
    const events = generateEvents(count);
    bench(`buildSnapshot (${count} events, no filter)`, () =>
      buildSnapshot(events, opts), { warmup: 3, iters: 20 });
  }

  // With a model + date range filter applied
  const events10k = generateEvents(10_000);
  const rangeStart = Date.now() - 7 * DAY_MS;
  const filteredOpts = {
    ...opts,
    filter: { models: ['gpt-4o'], range: { start: rangeStart, end: now } },
  };
  bench('buildSnapshot (10k events, model+range filter)', () =>
    buildSnapshot(events10k, filteredOpts), { warmup: 3, iters: 20 });
}

// ─── Runner ─────────────────────────────────────────────────────────────────

function printTable(): void {
  const COL = {
    name:   50,
    iters:   7,
    mean:    10,
    min:     10,
    max:     10,
    ops:     12,
  };

  const pad = (s: string, n: number) => s.padEnd(n);
  const rpad = (s: string, n: number) => s.padStart(n);

  const header =
    pad('Benchmark', COL.name) +
    rpad('Iters', COL.iters) +
    rpad('Mean (ms)', COL.mean) +
    rpad('Min (ms)', COL.min) +
    rpad('Max (ms)', COL.max) +
    rpad('ops/sec', COL.ops);

  const sep = '─'.repeat(header.length);
  console.log('\n' + sep);
  console.log(header);
  console.log(sep);

  for (const r of results) {
    const isSection = r.name.startsWith('─');
    if (isSection) {
      console.log('\n' + r.name);
      continue;
    }
    const row =
      pad(r.name, COL.name) +
      rpad(String(r.iterations), COL.iters) +
      rpad(r.meanMs.toFixed(3), COL.mean) +
      rpad(r.minMs.toFixed(3), COL.min) +
      rpad(r.maxMs.toFixed(3), COL.max) +
      rpad(r.opsPerSec < 10 ? r.opsPerSec.toFixed(2) : Math.round(r.opsPerSec).toString(), COL.ops);
    console.log(row);
  }

  console.log(sep);
  console.log(`\nTotal benchmarks: ${results.length}`);
}

async function main(): Promise<void> {
  console.log('Mallard Optimization Benchmarks');
  console.log(`Node.js ${process.version}  |  ${new Date().toISOString()}`);

  benchmarkAggregation();
  benchmarkForecasting();
  benchmarkChartData();
  benchmarkFullSnapshot();

  printTable();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
