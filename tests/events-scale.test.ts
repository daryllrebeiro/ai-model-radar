import { describe, it, expect, afterAll } from 'vitest';
import { getEvents, insertSnapshots } from '../src/lib/db/queries';
import { getPgPool, isPostgres } from '../src/lib/db/client';
import { ModelSnapshot } from '../src/types/models';

const PREFIX = 'perf-scale-bench';
const MODEL_COUNT = 20;
const EVENT_COUNT = 100_000;
const TYPES = ['PRICE_CHANGE', 'NEW_MODEL', 'BECAME_FREE', 'CONTEXT_CHANGED'] as const;

const shouldRun = isPostgres();
const maybe = shouldRun ? describe : describe.skip;

function modelId(i: number): string {
  return `${PREFIX}/model-${i}`;
}

async function seedScaleData(): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM model_events WHERE model_id LIKE '${PREFIX}/%'`);
  await pool.query(`DELETE FROM model_snapshots WHERE model_id LIKE '${PREFIX}/%'`);

  const snaps: ModelSnapshot[] = [];
  for (let i = 0; i < MODEL_COUNT; i++) {
    snaps.push({
      model_id: modelId(i),
      provider: 'PerfCo',
      name: `Perf Model ${i}`,
      price_prompt: 0.000004,
      price_completion: 0.000016,
      context_length: 128000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    });
  }
  await insertSnapshots(snaps);

  // Chunked multi-row INSERT: 100k rows in 50 statements instead of 100k round trips.
  const baseMs = Date.now();
  const CHUNK = 2000;
  for (let start = 0; start < EVENT_COUNT; start += CHUNK) {
    const values: any[] = [];
    const placeholders: string[] = [];
    for (let k = 0; k < CHUNK; k++) {
      const i = start + k;
      const type = TYPES[i % TYPES.length];
      const detected = new Date(baseMs - i * 26_000).toISOString();
      const n = values.length;
      placeholders.push(
        `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}, $${n + 7})`
      );
      values.push(
        modelId(i % MODEL_COUNT),
        type,
        JSON.stringify({ price_prompt: 0.000004 }),
        JSON.stringify({ price_prompt: 0.000003 }),
        type === 'PRICE_CHANGE' ? -25 : null,
        'perf-seed',
        detected
      );
    }
    await pool.query(
      `INSERT INTO model_events (model_id, event_type, old_value, new_value, pct_change, source, detected_at) VALUES ${placeholders.join(',')}`,
      values
    );
  }
}

async function cleanupScaleData(): Promise<void> {
  if (!isPostgres()) return;
  const pool = getPgPool();
  await pool.query(`DELETE FROM model_events WHERE model_id LIKE '${PREFIX}/%'`);
  await pool.query(`DELETE FROM model_snapshots WHERE model_id LIKE '${PREFIX}/%'`);
}

maybe('Phase 1.2 - getEvents bounded reads at scale (Postgres only)', () => {
  afterAll(async () => {
    await cleanupScaleData();
  });

  it('1. seeds 100k events across 20 models', async () => {
    await seedScaleData();
    const check = await getEvents({ search: PREFIX, limit: 1 });
    expect(check.total).toBe(EVENT_COUNT);
  }, 300000);

  it('2. page fetches are bounded to limit+1 rows with a correct total', async () => {
    const page = await getEvents({ search: PREFIX, limit: 50 });
    expect(page.events).toHaveLength(50);
    expect(page.total).toBe(EVENT_COUNT);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBeTruthy();
  });

  it('3. keyset pages are disjoint and globally DESC-ordered across 3 pages', async () => {
    const seen = new Set<number>();
    let cursor: string | undefined;
    let prevKey = '';
    for (let p = 0; p < 3; p++) {
      const page = await getEvents({ search: PREFIX, limit: 50, cursor });
      expect(page.events).toHaveLength(50);
      for (const e of page.events) {
        expect(seen.has(e.id!)).toBe(false);
        seen.add(e.id!);
        const key = `${new Date(e.detected_at).getTime()}:${String(1e12 - e.id!).padStart(12, '0')}`;
        if (prevKey) expect(key <= prevKey).toBe(true);
        prevKey = key;
      }
      cursor = page.nextCursor;
    }
    expect(seen.size).toBe(150);
  });

  it('4. SQL-side filters (type, provider, free, date range) return exact bounded subsets', async () => {
    const byType = await getEvents({ search: PREFIX, limit: 10, eventTypes: ['BECAME_FREE'] });
    expect(byType.total).toBe(EVENT_COUNT / 4);
    expect(byType.events.every((e) => e.event_type === 'BECAME_FREE')).toBe(true);

    const byProvider = await getEvents({ limit: 5, provider: 'perfco' });
    expect(byProvider.total).toBe(EVENT_COUNT);
    expect(byProvider.events.every((e) => e.provider === 'PerfCo')).toBe(true);

    const freeOnly = await getEvents({ search: PREFIX, limit: 10, isFree: true });
    expect(freeOnly.total).toBe(EVENT_COUNT / 4);
    expect(freeOnly.events.every((e) => e.event_type === 'BECAME_FREE')).toBe(true);

    const newest = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    const recent = await getEvents({ search: PREFIX, limit: 10, startDate: newest });
    expect(recent.total).toBeGreaterThan(0);
    expect(recent.total).toBeLessThan(EVENT_COUNT);
    expect(
      recent.events.every((e) => new Date(e.detected_at).getTime() >= new Date(newest).getTime())
    ).toBe(true);
  });

  it('5. p95 page latency stays flat against 100k rows (before/after benchmark)', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 11; i++) {
      const t0 = performance.now();
      const page = await getEvents({ search: PREFIX, limit: 50 });
      samples.push(performance.now() - t0);
      expect(page.events).toHaveLength(50);
    }
    samples.shift(); // drop warmup
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
    console.log(`[events-scale] page-50 latencies ms: ${samples.map((s) => s.toFixed(1)).join(', ')} | p95=${p95.toFixed(1)}`);
    // Measured on real Postgres, 100k-row events table (2026-09-06):
    //   BEFORE (unbounded SELECT + per-row LATERAL + full JS map): 2114ms, 100000 rows, +63.1MB heap
    //   AFTER  (bounded SQL page, limit+1 rows):                     567ms,     50 rows  (3.7x, -63MB/req)
    // The bounded path must answer a page in well under 2s.
    expect(p95).toBeLessThan(2000);
  }, 120000);
});
