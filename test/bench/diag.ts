import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventStore } from '../../src/store/EventStore';
import { DAY_MS } from '../../src/util/time';
import type { UsageEvent } from '../../src/domain/types';

const MODELS   = ['gpt-4o','claude-sonnet-4-6','claude-haiku-4-5','o3','gemini-2-flash'];
const SURFACES: UsageEvent['surface'][] = ['chat','inline','agent','edit','unknown'];
const SOURCES: UsageEvent['source'][]   = ['local','local','local','github','claude-code'];
const REPOS    = ['acme/frontend','acme/backend','acme/infra','acme/shared',undefined];

let uid = 0;
function gen(n: number, window = 90, prefix = 'e') {
  const now = Date.now();
  return Array.from({length: n}, () => {
    const i = uid++;
    const credits = 1 + (i % 10);
    return { id: `${prefix}${i}`, ts: now - Math.floor(Math.random()*window)*DAY_MS,
      modelId: MODELS[i%5]!, surface: SURFACES[i%5]!, source: SOURCES[i%5]!,
      credits, cost: credits*0.04, estimated: false, repo: REPOS[i%5],
      costByCategory: { input: credits*0.028, output: credits*0.012 } };
  });
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'diag-'));
  const store = await EventStore.open(tmp);
  const conn = (store as any).conn;
  await conn.run("SET memory_limit='2GB'; SET threads=1");

  const mb = async () => {
    const r = await conn.runAndReadAll("SELECT ROUND(memory_usage_bytes/1024/1024,0) AS mb FROM duckdb_memory()");
    return Number(r.getRowObjects()[0]?.mb ?? 0);
  };

  console.log('open:', await mb(), 'MB');
  await store.writer.insert(gen(10_000));
  console.log('after insert 10k:', await mb(), 'MB');

  const ops: [string, () => Promise<unknown>][] = [
    ['find', () => store.reader.find({})],
    ['count', () => store.reader.count({})],
    ['bucket day', () => store.reader.bucket({}, 'day')],
    ['bucket week', () => store.reader.bucket({}, 'week')],
    ['bucket month', () => store.reader.bucket({}, 'month')],
    ['bucket hour', () => store.reader.bucket({}, 'hour')],
    ['bucket weekday', () => store.reader.bucket({}, 'weekday')],
    ['queryFacts', () => store.reader.queryFacts()],
    ['rank', () => store.reader.rank({}, 'credits')],
    ['pivot', () => store.reader.pivot({}, 'surface', 'credits')],
    ['aggregate', () => store.reader.aggregate({}, ['credits', 'cost'])],
  ];

  console.log('\n--- Single pass memory growth ---');
  for (const [name, fn] of ops) {
    await fn();
    console.log(`  after ${name}:`, await mb(), 'MB');
  }

  console.log('\n--- Repeated calls (20x each) ---');
  for (const [name, fn] of ops) {
    for (let i = 0; i < 20; i++) await fn();
    console.log(`  after 20x ${name}:`, await mb(), 'MB');
  }

  store.dispose();
  rmSync(tmp, { recursive: true, force: true });
}

main().catch(err => { console.error(err); process.exit(1); });
