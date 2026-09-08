import { describe, it, expect } from 'vitest';
import {
  getModelCurrentList,
  getDealsData,
  getMarketStats,
  insertSnapshots,
  insertEvents,
} from '../src/lib/db/queries';

const PREFIX = 'catpush';

// Distinct names/prices/contexts chosen to make every sort order unambiguous.
const SEED = [
  { model_id: `${PREFIX}/zeta`, provider: 'CatPush', name: 'Catpush Zeta', price_prompt: 0.000009, price_completion: 0.00002, context_length: 32000, is_free: false },
  { model_id: `${PREFIX}/alpha`, provider: 'CatPush', name: 'Catpush Alpha', price_prompt: 0.000001, price_completion: 0.000004, context_length: 256000, is_free: true },
  { model_id: `${PREFIX}/mid`, provider: 'OtherCo', name: 'Catpush Mid', price_prompt: 0.000005, price_completion: 0.00001, context_length: 128000, is_free: false },
];

async function seedOnce() {
  const now = new Date().toISOString();
  await insertSnapshots(
    SEED.map((s) => ({
      ...s,
      modality: 'text->text',
      raw_json: {},
      polled_at: now,
    })) as any
  );
  await insertEvents([
    {
      model_id: `${PREFIX}/zeta`,
      event_type: 'PRICE_CHANGE',
      old_value: { price_prompt: 0.000018 },
      new_value: { price_prompt: 0.000009 },
      pct_change: -50,
      source: 'catpush-seed',
      detected_at: now,
    },
  ] as any);
}

describe('Catalog SQL pushdown (getModelCurrentList / getDealsData / getMarketStats)', () => {
  it('1. search-scoped list is total-accurate, ordered, and paginated in SQL', async () => {
    await seedOnce();

    const byName = await getModelCurrentList({ search: 'Catpush Z', limit: 10 });
    expect(byName.total).toBeGreaterThanOrEqual(1);
    const names = byName.models.map((m) => m.name);
    expect(names).toContain('Catpush Zeta');

    // Price ascending over the seeded set: alpha < mid < zeta
    const asc = await getModelCurrentList({ search: PREFIX, sortBy: 'price', sortOrder: 'asc', limit: 100 });
    const order = asc.models.map((m) => m.model_id);
    expect(order.indexOf(`${PREFIX}/alpha`)).toBeLessThan(order.indexOf(`${PREFIX}/mid`));
    expect(order.indexOf(`${PREFIX}/mid`)).toBeLessThan(order.indexOf(`${PREFIX}/zeta`));

    // Descending flips exactly
    const desc = await getModelCurrentList({ search: PREFIX, sortBy: 'price', sortOrder: 'desc', limit: 100 });
    const dorder = desc.models.map((m) => m.model_id);
    expect(dorder.indexOf(`${PREFIX}/zeta`)).toBeLessThan(dorder.indexOf(`${PREFIX}/alpha`));

    // Provider + free filters compose, totals stay consistent
    const free = await getModelCurrentList({ search: PREFIX, isFree: true, limit: 100 });
    expect(free.total).toBe(1);
    expect(free.models[0].model_id).toBe(`${PREFIX}/alpha`);
    const prov = await getModelCurrentList({ search: PREFIX, provider: 'otherco', limit: 100 });
    expect(prov.total).toBe(1);
    expect(prov.models[0].model_id).toBe(`${PREFIX}/mid`);

    // Pagination window is bounded server-side
    const page = await getModelCurrentList({ search: PREFIX, limit: 2, offset: 1 });
    expect(page.models.length).toBeLessThanOrEqual(2);
    expect(page.total).toBe(3);
  });

  it('2. stats aggregates agree with the list endpoint (no hydration drift)', async () => {
    await seedOnce();
    const [stats, list, free] = await Promise.all([
      getMarketStats(),
      getModelCurrentList({ limit: 1 }),
      getModelCurrentList({ isFree: true, limit: 1 }),
    ]);
    expect(stats.totalActiveModels).toBe(list.total);
    expect(stats.totalFreeModels).toBe(free.total);
    expect(stats.totalProviders).toBeGreaterThanOrEqual(1);
    expect(stats.lastPolledAt).toBeTruthy();
  });

  it('3. deals are bounded, ordered, and contain seeded drops', async () => {
    await seedOnce();
    const deals = await getDealsData();
    expect(deals.topDrops30d.length).toBeLessThanOrEqual(30);
    expect(deals.topDrops7d.length).toBeLessThanOrEqual(20);
    const pcts = deals.topDrops30d.map((d) => d.pct_change);
    const sorted = [...pcts].sort((a, b) => a - b);
    expect(pcts).toEqual(sorted);
    expect(deals.freeModels.some((m) => m.model_id === `${PREFIX}/alpha`)).toBe(true);
    expect(deals.topDrops30d.some((d) => d.model_id === `${PREFIX}/zeta`)).toBe(true);
  });
});
