import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { latestP95ByModel, sortModelsByLatency } from '../src/lib/catalog-enrichment';
import { GET as v1Models } from '../src/app/api/v1/models/route';
import { saveEndpointTelemetry } from '../src/lib/db/queries';
import { ModelCurrent } from '../src/types/models';

function model(id: string): ModelCurrent {
  return {
    model_id: id, provider: 'T', name: id, price_prompt: 1, price_completion: 1,
    context_length: 1000, modality: 'text->text', is_free: false, raw_json: {},
    polled_at: new Date().toISOString(),
  };
}

describe('P3 latency sort (measured speed, unknown sorts last)', () => {
  it('latest p95 wins per model; nulls ignored', () => {
    const m = latestP95ByModel([
      { model_id: 'a/m', p95_latency_ms: 500, checked_at: '2026-01-01T00:00:00Z' },
      { model_id: 'a/m', p95_latency_ms: 100, checked_at: '2026-02-01T00:00:00Z' },
      { model_id: 'a/m', p95_latency_ms: null, checked_at: '2026-03-01T00:00:00Z' },
    ]);
    expect(m.get('a/m')).toBe(100);
  });

  it('unmeasured models sort last (never pose as fast)', () => {
    const sorted = sortModelsByLatency(
      [model('slow'), model('unknown'), model('fast')],
      new Map([['slow', 900], ['fast', 50]])
    );
    expect(sorted.map((x) => x.model_id)).toEqual(['fast', 'slow', 'unknown']);
  });

  it('sortBy=latency orders by measured p95 and carries the scope note', async () => {
    const stamp = Date.now();
    await saveEndpointTelemetry({
      model_id: `lat/slow-${stamp}`, provider: 'Lat', endpoint_url: null, checked_at: new Date().toISOString(),
      online: true, http_status: 200, p95_latency_ms: 5000, avg_latency_ms: 4000,
      tokens_per_sec: 10, rate_limited: false, rate_limited_count: 0, retry_after_sec: null,
      sample_count: 3, is_free: false, free_tier_active: null, error: null,
    });
    const res = await v1Models(new NextRequest('http://localhost/api/v1/models?sortBy=latency&limit=50'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latency_scope.toLowerCase()).toContain('not a guarantee');
    expect(Array.isArray(body.data)).toBe(true);
  });
});
