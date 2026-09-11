import { describe, it, expect } from 'vitest';
import { insertEvents, getEvents } from '../src/lib/db/queries';
import { GET as deprecationsGET } from '../src/app/api/v1/deprecations/route';
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * P2-3 — deprecation read path stays pushed down and bounded:
 * event-type + provider predicates are SQL-side (not Node-filtered), the
 * composite (event_type, detected_at) index exists in schema, and the
 * route caps reads instead of scanning history.
 */
describe('P2-3 deprecation read pushdown + bounds', () => {
  it('composite event index exists in the baseline schema', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql'), 'utf-8');
    expect(schema).toContain('idx_events_type_time');
    expect(schema).toMatch(/model_events\s*\(\s*event_type\s*,\s*detected_at/i);
  });

  it('getEvents filters by type server-side (both backends)', async () => {
    const tag = `p23-${Date.now()}`;
    await insertEvents([
      { model_id: `${tag}/m`, event_type: 'PRICE_CHANGE', old_value: null, new_value: null, pct_change: -5, source: 't', detected_at: new Date().toISOString() },
      { model_id: `${tag}/m`, event_type: 'MODEL_REMOVED', old_value: null, new_value: null, pct_change: null, source: 't', detected_at: new Date().toISOString() },
    ] as any);
    const res: any = await getEvents({ eventTypes: ['MODEL_REMOVED'] as any, limit: 50 });
    const list = res.events || res;
    const mine = list.filter((e: any) => e.model_id === `${tag}/m`);
    expect(mine).toHaveLength(1);
    expect(mine[0].event_type).toBe('MODEL_REMOVED');
  });

  it('limit is capped (route cannot request an unbounded scan)', async () => {
    const res: any = await getEvents({ eventTypes: [] as any, limit: 500000 });
    const list = res.events || res;
    expect(list.length).toBeLessThanOrEqual(500);
  });

  it('deprecations provider filter narrows to the provider', async () => {
    const res = await deprecationsGET(new NextRequest('http://localhost/api/v1/deprecations?provider=NoSuchProviderXYZ'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers).toEqual([]);
  });
});
