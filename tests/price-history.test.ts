import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  insertSnapshots,
  insertEvents,
  getModelPriceHistory,
  isHistoryRange,
  HISTORY_RANGE_MS,
} from '../src/lib/db/queries';
import { createOrGetUser, createApiKey } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { ModelSnapshot } from '../src/types/models';
import { ModelEvent } from '../src/types/events';
import { GET as historyRoute } from '../src/app/api/v1/models/history/[...id]/route';
import { GET as detailRoute } from '../src/app/api/v1/models/[...id]/route';

const MODEL_ID = 'test/price-history-model';

function makeSnapshot(prompt: number, completion: number, daysAgo: number): ModelSnapshot {
  return {
    model_id: MODEL_ID,
    provider: 'TestProvider',
    name: 'Price History Model',
    price_prompt: prompt,
    price_completion: completion,
    context_length: 64000,
    modality: 'text->text',
    is_free: false,
    raw_json: {},
    polled_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
  };
}

afterEach(() => {
  delete process.env.FEATURE_ENFORCEMENT;
});

describe('Phase 2.1: Price History Charts', () => {
  it('1. isHistoryRange validates range params and rejects bad ones', () => {
    expect(isHistoryRange('7d')).toBe(true);
    expect(isHistoryRange('30d')).toBe(true);
    expect(isHistoryRange('90d')).toBe(true);
    expect(isHistoryRange('1y')).toBe(true);
    expect(isHistoryRange('all')).toBe(true);
    expect(isHistoryRange(null)).toBe(false);
    expect(isHistoryRange(undefined)).toBe(false);
    expect(isHistoryRange('999d')).toBe(false);
    expect(HISTORY_RANGE_MS['7d']).toBe(7 * 24 * 60 * 60 * 1000);
    expect(HISTORY_RANGE_MS.all).toBeNull();
  });

  it('2. getModelPriceHistory returns time-ordered snapshots and event annotations', async () => {
    await insertSnapshots([
      makeSnapshot(0.000005, 0.000015, 40),
      makeSnapshot(0.000004, 0.000012, 12),
      makeSnapshot(0.000003, 0.00001, 2),
    ]);

    const event: ModelEvent = {
      model_id: MODEL_ID,
      event_type: 'PRICE_CHANGE',
      old_value: { prompt: 0.000005, completion: 0.000015 },
      new_value: { prompt: 0.000004, completion: 0.000012 },
      pct_change: -20,
      source: 'openrouter',
      detected_at: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await insertEvents([event]);

    const result = await getModelPriceHistory(MODEL_ID, 'all');

    expect(result).not.toBeNull();
    expect(result!.snapshots.length).toBeGreaterThanOrEqual(3);
    // Snapshot times ascending
    const times = result!.snapshots.map((s) => new Date(s.polled_at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);

    expect(result!.events.length).toBeGreaterThanOrEqual(1);
    expect(result!.events[0].event_type).toBe('PRICE_CHANGE');
    expect(result!.current).not.toBeNull();
  });

  it('3. getModelPriceHistory filters snapshots and events by range window', async () => {
    await insertSnapshots([
      makeSnapshot(0.00002, 0.00006, 60),
      makeSnapshot(0.00001, 0.00003, 2),
    ]);

    const shortRange = await getModelPriceHistory(MODEL_ID, '7d');
    expect(shortRange).not.toBeNull();
    // Only the recent snapshot (2 days ago) should survive the 7d window
    for (const s of shortRange!.snapshots) {
      expect(new Date(s.polled_at).getTime()).toBeGreaterThan(Date.now() - 8 * 24 * 60 * 60 * 1000);
    }
    expect(shortRange!.current!.price_prompt).toBeCloseTo(0.00001, 10);
  });

  it('4. Unknown model returns null', async () => {
    const result = await getModelPriceHistory('test/does-not-exist', 'all');
    expect(result).toBeNull();
  });
});

describe('Phase 2.1: History API Endpoint', () => {
  it('5. History route returns 401 unauthenticated', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/v1/models/history/${encodeURIComponent(MODEL_ID)}?range=30d`
    );
    const res = await historyRoute(req, { params: { id: [MODEL_ID] } });
    expect(res.status).toBe(401);
  });

  it('6. History route rejects invalid range params gracefully with 200 (defaults to all)', async () => {
    const email = `hist_key_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'pro' });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'pro');
    await createApiKey(keyRecord);

    const req = new NextRequest(
      `http://localhost:3000/api/v1/models/history/${encodeURIComponent(MODEL_ID)}?range=999d`,
      { headers: { Authorization: `Bearer ${plaintextKey}` } }
    );
    const res = await historyRoute(req, { params: { id: [MODEL_ID] } });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.range).toBe('all');
    expect(body.version).toBe('v1');
    expect(body.data.snapshots).toBeInstanceOf(Array);
  });

  it('7. Unknown model returns 404 with model_id', async () => {
    const email = `hist_key_404_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'free' });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'free');
    await createApiKey(keyRecord);

    const req = new NextRequest(
      `http://localhost:3000/api/v1/models/history/${encodeURIComponent('test/ghost-model')}`,
      { headers: { Authorization: `Bearer ${plaintextKey}` } }
    );
    const res = await historyRoute(req, { params: { id: ['test/ghost-model'] } });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.model_id).toBe('test/ghost-model');
  });

  it('7b. Model detail route returns a real HTTP 404 for unknown models (regression)', async () => {
    const email = `detail_404_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'free' });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'free');
    await createApiKey(keyRecord);

    const req = new NextRequest(
      `http://localhost:3000/api/v1/models/${encodeURIComponent('test/ghost-model')}`,
      { headers: { Authorization: `Bearer ${plaintextKey}` } }
    );
    const res = await detailRoute(req, { params: { id: ['test/ghost-model'] } });
    expect(res.status).toBe(404);
  });

  it('8. Enforcement ON: free user blocked (403), pro user allowed (200)', async () => {
    process.env.FEATURE_ENFORCEMENT = 'true';

    const freeUser = await createOrGetUser({ email: `hist_free_${Date.now()}@test.com`, tier: 'free' });
    const freeKey = generateApiKey(freeUser.email, 'free');
    await createApiKey(freeKey.keyRecord);

    const freeReq = new NextRequest(
      `http://localhost:3000/api/v1/models/history/${encodeURIComponent(MODEL_ID)}`,
      { headers: { Authorization: `Bearer ${freeKey.plaintextKey}` } }
    );
    const freeRes = await historyRoute(freeReq, { params: { id: [MODEL_ID] } });
    expect(freeRes.status).toBe(403);

    const proUser = await createOrGetUser({ email: `hist_pro_${Date.now()}@test.com`, tier: 'pro' });
    const proKey = generateApiKey(proUser.email, 'pro');
    await createApiKey(proKey.keyRecord);

    const proReq = new NextRequest(
      `http://localhost:3000/api/v1/models/history/${encodeURIComponent(MODEL_ID)}`,
      { headers: { Authorization: `Bearer ${proKey.plaintextKey}` } }
    );
    const proRes = await historyRoute(proReq, { params: { id: [MODEL_ID] } });
    expect(proRes.status).toBe(200);
  });
});