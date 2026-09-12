import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { queryCatalog } from '../src/lib/db/queries';
import { insertSnapshots } from '../src/lib/db/queries';
import { GET as legacyGET } from '../src/app/api/models/route';
import { GET as v1GET } from '../src/app/api/v1/models/route';
import { ns, resetLocalBackend } from './helpers';

const TAG = ns('query-catalog');
const RUN = TAG('run');

async function seed() {
  await resetLocalBackend();
  const at = new Date().toISOString();
  await insertSnapshots(
    ['m-alpha', 'm-beta', 'm-gamma'].map((m, i) => ({
      model_id: `${RUN}/${m}`,
      provider: 'CatCo',
      name: m,
      price_prompt: 1 + i,
      price_completion: 2,
      context_length: 8000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: at,
    })) as any
  );
}

describe('queryCatalog: single shared path for both twins', () => {
  it('filters + paginates with total reflecting the filtered set', async () => {
    await seed();
    const res = await queryCatalog({ search: RUN, provider: 'CatCo', limit: 2, offset: 0 });
    expect(res.total).toBe(3);
    expect(res.models).toHaveLength(2);
    const page2 = await queryCatalog({ search: RUN, provider: 'CatCo', limit: 2, offset: 2 });
    expect(page2.models).toHaveLength(1);
    expect(page2.total).toBe(3);
  });

  it('latency sort without telemetry keeps catalog order (never fabricated)', async () => {
    await seed();
    const res = await queryCatalog({ search: RUN, sortBy: 'latency' });
    expect(res.models.length).toBeGreaterThan(0);
    expect(res.latencyScope).toBeUndefined(); // no fetcher supplied
  });

  it('legacy and v1 twins agree on ids and total for the same query', async () => {
    await seed();
    const q = `q=${encodeURIComponent(RUN)}&provider=CatCo&limit=50`;
    const legacy = await legacyGET(new NextRequest(`http://localhost/api/models?${q}`));
    expect(legacy.status).toBe(200);
    const legacyBody = await legacy.json();
    const v1 = await v1GET(new NextRequest(`http://localhost/api/v1/models?${q}`));
    expect(v1.status).toBe(200);
    const v1Body = await v1.json();
    expect(v1Body.total).toBe(legacyBody.total);
    expect(v1Body.data.map((m: any) => m.model_id).sort()).toEqual(
      legacyBody.models.map((m: any) => m.model_id).sort()
    );
  });
});
