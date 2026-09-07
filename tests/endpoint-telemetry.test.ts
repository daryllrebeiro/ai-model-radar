import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  resolveEndpointUrl,
  buildProbeTargets,
  probeEndpoint,
  analyzeProbeResults,
  evaluateEndpointHealth,
  runEndpointProbes,
  getDegradedEndpointsForWatchlist,
} from '../src/lib/probe';
import { evaluateEndpointAlertRules } from '../src/lib/alerts/endpoint-alerts';
import { saveEndpointTelemetry, getRecentEndpointTelemetry } from '../src/lib/db/queries';
import { ModelSnapshot } from '../src/types/models';
import { EndpointTelemetry } from '../src/types/telemetry';
import { createOrGetUser, createApiKey } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { GET as telemetryRoute } from '../src/app/api/v1/telemetry/route';
import { GET as probesCronRoute } from '../src/app/api/cron/probes/route';

function snap(modelId: string, provider: string, isFree = false): ModelSnapshot {
  return {
    model_id: modelId,
    provider,
    name: modelId,
    price_prompt: 0.000001,
    price_completion: 0.000004,
    context_length: 200000,
    modality: 'text->text',
    is_free: isFree,
    raw_json: {},
    polled_at: new Date().toISOString(),
  };
}

describe('Phase 5 - Endpoint Intelligence: url resolution & targets', () => {
  it('1. Uses explicit endpoint URL from raw_json when present', () => {
    const s = snap('acme/x', 'Acme');
    s.raw_json = { endpoint: { url: 'https://custom.example/x' } };
    expect(resolveEndpointUrl(s)).toBe('https://custom.example/x');
  });

  it('2. Falls back to the provider endpoint map; unknown providers yield null', () => {
    expect(resolveEndpointUrl(snap('openai/gpt-4o', 'OpenAI'))).toBe('https://api.openai.com/v1/models');
    expect(resolveEndpointUrl(snap('anthropic/claude', 'Anthropic'))).toBe('https://api.anthropic.com/v1/models');
    expect(resolveEndpointUrl(snap('tinyco/tiny', 'TinyCo'))).toBeNull();
  });

  it('3. buildProbeTargets skips models without a resolvable endpoint', () => {
    const targets = buildProbeTargets([snap('openai/gpt-4o', 'OpenAI'), snap('tinyco/tiny', 'TinyCo')]);
    expect(targets).toHaveLength(1);
    expect(targets[0].model_id).toBe('openai/gpt-4o');
  });
});

describe('Phase 5 - Endpoint Intelligence: probe + analysis', () => {
  const target = { model_id: 'openai/gpt-5', provider: 'OpenAI', url: 'https://api.openai.com/v1/models', is_free: false };

  it('4. Successful probes produce an online record with latency and throughput', async () => {
    const fetchFn = (async () => {
      return new Response(JSON.stringify({ data: [{ id: 'x' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const samples = await probeEndpoint(target, { sampleCount: 3, fetchFn, nowFn: () => 10 });
    expect(samples).toHaveLength(3);
    expect(samples.every((s) => s.status === 200)).toBe(true);

    const record = analyzeProbeResults(target, samples);
    expect(record.online).toBe(true);
    expect(record.http_status).toBe(200);
    expect(record.p95_latency_ms).not.toBeNull();
    expect(record.sample_count).toBe(3);
  });

  it('5. All-429 probes mark the endpoint as rate-limited and down', async () => {
    const fetchFn = (async () => {
      return new Response('slow down', { status: 429, headers: { 'Retry-After': '5' } });
    }) as unknown as typeof fetch;

    const samples = await probeEndpoint(target, { sampleCount: 2, fetchFn, nowFn: () => 1 });
    const record = analyzeProbeResults(target, samples);
    expect(record.online).toBe(false);
    expect(record.rate_limited).toBe(true);
    expect(record.rate_limited_count).toBe(2);
    expect(record.retry_after_sec).toBe(5);

    const health = evaluateEndpointHealth(record);
    expect(health.status).toBe('down');
  });

  it('6. Timeouts produce a non-online record with a timed-out-free null status', async () => {
    const abortingFetch = (() => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as unknown as typeof fetch;

    const samples = await probeEndpoint(target, { sampleCount: 1, fetchFn: abortingFetch, nowFn: () => 5 });
    const record = analyzeProbeResults(target, samples);
    expect(record.online).toBe(false);
    expect(record.http_status).toBeNull();
    expect(record.p95_latency_ms).not.toBeNull();
  });

  it('7. evaluateEndpointHealth flags degraded for P95 over threshold', () => {
    const rec: EndpointTelemetry = {
      model_id: 'x',
      provider: 'OpenAI',
      checked_at: new Date().toISOString(),
      online: true,
      http_status: 200,
      p95_latency_ms: 9000,
      avg_latency_ms: 8000,
      tokens_per_sec: 100,
      rate_limited: false,
      rate_limited_count: 0,
      retry_after_sec: null,
      sample_count: 3,
      is_free: false,
      free_tier_active: null,
    };
    const health = evaluateEndpointHealth(rec);
    expect(health.status).toBe('degraded');
    expect(health.reasons.join(' ')).toContain('9000ms');
  });

  it('8. Free-tier non-serving endpoints classify as down', () => {
    const rec: EndpointTelemetry = {
      model_id: 'x',
      provider: 'OpenAI',
      checked_at: new Date().toISOString(),
      online: true,
      http_status: null,
      p95_latency_ms: 100,
      avg_latency_ms: 90,
      tokens_per_sec: 50,
      rate_limited: false,
      rate_limited_count: 0,
      retry_after_sec: null,
      sample_count: 3,
      is_free: true,
      free_tier_active: false,
    };
    expect(evaluateEndpointHealth(rec).status).toBe('down');
  });
});

describe('Phase 5 - Endpoint Intelligence: persistence & query', () => {
  it('9. save/get round-trips a telemetry record', async () => {
    const now = new Date().toISOString();
    const rec: EndpointTelemetry = {
      model_id: 'roundtrip/model',
      provider: 'Acme',
      endpoint_url: 'https://api.acme.example/models',
      checked_at: now,
      online: true,
      http_status: 200,
      p95_latency_ms: 320.5,
      avg_latency_ms: 200,
      tokens_per_sec: 88.5,
      rate_limited: false,
      rate_limited_count: 0,
      retry_after_sec: null,
      sample_count: 3,
      is_free: false,
      free_tier_active: null,
    };
    await saveEndpointTelemetry(rec);

    const rows = await getRecentEndpointTelemetry({ modelId: 'roundtrip/model', limit: 5 });
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row.model_id).toBe('roundtrip/model');
    expect(row.online).toBe(true);
    expect(row.p95_latency_ms).toBeCloseTo(320.5, 1);
    expect(row.tokens_per_sec).toBeCloseTo(88.5, 1);
  });
});

describe('Phase 5 - Endpoint Intelligence: watchlist + alert rule', () => {
  it('10. getDegradedEndpointsForWatchlist ranks degraded/down first for watched ids', async () => {
    const base = new Date(Date.now() - 1000).toISOString();
    const downRec: EndpointTelemetry = { model_id: 'watch/down', provider: 'Acme', checked_at: base, online: false, http_status: null, p95_latency_ms: null, avg_latency_ms: null, tokens_per_sec: null, rate_limited: false, rate_limited_count: 0, retry_after_sec: null, sample_count: 2, is_free: false, free_tier_active: null };
    const okRec: EndpointTelemetry = { model_id: 'watch/ok', provider: 'Acme', checked_at: base, online: true, http_status: 200, p95_latency_ms: 120, avg_latency_ms: 100, tokens_per_sec: 200, rate_limited: false, rate_limited_count: 0, retry_after_sec: null, sample_count: 2, is_free: false, free_tier_active: null };
    await saveEndpointTelemetry(downRec);
    await saveEndpointTelemetry(okRec);

    const results = await getDegradedEndpointsForWatchlist(['watch/ok', 'watch/down'], { sinceMs: 60_000 });
    expect(results.length).toBeGreaterThanOrEqual(2);
    const downIdx = results.findIndex((r) => r.model_id === 'watch/down');
    const okIdx = results.findIndex((r) => r.model_id === 'watch/ok');
    expect(downIdx).toBeLessThan(okIdx);
    expect(results.find((r) => r.model_id === 'watch/down')?.status).toBe('down');
  });

  it('11. evaluateEndpointAlertRules emits alerts only for non-healthy endpoints', () => {
    const healthy: EndpointTelemetry = { model_id: 'a', provider: 'Acme', checked_at: new Date().toISOString(), online: true, http_status: 200, p95_latency_ms: 100, avg_latency_ms: 90, tokens_per_sec: 300, rate_limited: false, rate_limited_count: 0, retry_after_sec: null, sample_count: 3, is_free: false, free_tier_active: null };
    const down: EndpointTelemetry = { model_id: 'b', provider: 'Acme', checked_at: new Date().toISOString(), online: false, http_status: null, p95_latency_ms: null, avg_latency_ms: null, tokens_per_sec: null, rate_limited: false, rate_limited_count: 0, retry_after_sec: null, sample_count: 3, is_free: false, free_tier_active: null };
    const degraded: EndpointTelemetry = { model_id: 'c', provider: 'Acme', checked_at: new Date().toISOString(), online: true, http_status: 200, p95_latency_ms: 12000, avg_latency_ms: 11000, tokens_per_sec: 30, rate_limited: false, rate_limited_count: 0, retry_after_sec: null, sample_count: 3, is_free: false, free_tier_active: null };

    const result = evaluateEndpointAlertRules([healthy, down, degraded]);
    expect(result.total).toBe(2);
    expect(result.alerts.some((a) => a.record.model_id === 'b' && a.severity === 'down')).toBe(true);
    expect(result.alerts.some((a) => a.record.model_id === 'c')).toBe(true);

    const downOnly = evaluateEndpointAlertRules([down, degraded], { minSeverity: 'down' });
    expect(downOnly.alerts.length).toBe(1);
    expect(downOnly.alerts[0].record.model_id).toBe('b');
  });

  it('12. Provider filter restricts alert rule evaluation', async () => {
    const degraded: EndpointTelemetry = { model_id: 'c', provider: 'Beta', checked_at: new Date().toISOString(), online: true, http_status: 200, p95_latency_ms: 12000, avg_latency_ms: 11000, tokens_per_sec: 30, rate_limited: false, rate_limited_count: 0, retry_after_sec: null, sample_count: 3, is_free: false, free_tier_active: null };
    const filtered = evaluateEndpointAlertRules([degraded], { providers: ['acme'] });
    expect(filtered.total).toBe(0);
  });
});

describe('Phase 5 - Endpoint Intelligence: runEndpointProbes', () => {
  it('13. runEndpointProbes persists results and summarizes health', async () => {
    const fetchFn = (async () => {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;

    const result = await runEndpointProbes({
      snapshots: [snap('openai/gpt-5', 'OpenAI'), snap('anthropic/claude-5', 'Anthropic')],
      sampleCount: 2,
      fetchFn,
      nowFn: () => 3,
    });

    expect(result.probed).toBe(2);
    expect(result.saved).toBe(2);
    expect(typeof result.runId).toBe('string');
    expect(result.records.every((r) => r.online)).toBe(true);
  });

  it('14. Watched models are prioritized when a limit is set', async () => {
    const fetchFn = (async () => {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;

    const result = await runEndpointProbes({
      snapshots: [
        snap('openai/a', 'OpenAI'),
        snap('openai/b', 'OpenAI'),
        snap('anthropic/c', 'Anthropic'),
      ],
      watchedModelIds: new Set(['anthropic/c']),
      limit: 2,
      sampleCount: 1,
      fetchFn,
      nowFn: () => 2,
    });

    expect(result.probed).toBe(2);
    expect(result.records.map((r) => r.model_id)).toContain('anthropic/c');
  });
});

describe('Phase 5 - Endpoint Intelligence: /api/v1/telemetry', () => {
  async function withProKey() {
    const user = await createOrGetUser({ email: `telemetry.pro.${Date.now()}@test.dev` });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'production');
    await createApiKey(keyRecord);
    return plaintextKey;
  }

  it('15. Rejects unauthenticated requests', async () => {
    const res = await telemetryRoute(new NextRequest('http://localhost/api/v1/telemetry'));
    expect(res.status).toBe(401);
  });

  it('16. Returns telemetry with a health summary for an authenticated pro request', async () => {
    const key = await withProKey();
    await saveEndpointTelemetry({
      model_id: 'api/route-model',
      provider: 'Acme',
      endpoint_url: 'https://api.acme.example/models',
      checked_at: new Date().toISOString(),
      online: true,
      http_status: 200,
      p95_latency_ms: 150,
      avg_latency_ms: 120,
      tokens_per_sec: 240,
      rate_limited: false,
      rate_limited_count: 0,
      retry_after_sec: null,
      sample_count: 3,
      is_free: false,
      free_tier_active: null,
    });

    const res = await telemetryRoute(
      new NextRequest('http://localhost/api/v1/telemetry?model_id=api/route-model&limit=5', {
        headers: { Authorization: `Bearer ${key}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe('v1');
    expect(typeof body.summary.total).toBe('number');
    expect(typeof body.summary.healthy).toBe('number');
    expect(Array.isArray(body.telemetry)).toBe(true);
    const row = body.telemetry[0];
    expect(['healthy', 'degraded', 'down']).toContain(row.health.status);
    expect(row.health.reasons).toBeDefined();
  });
});

describe('Phase 5 - Endpoint Intelligence: /api/cron/probes', () => {
  it('17. Rejects requests with a wrong bearer token when CRON_SECRET is set', async () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'test-secret-probes';
    try {
      const res = await probesCronRoute(new NextRequest('http://localhost/api/cron/probes'));
      expect(res.status).toBe(401);
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previous;
    }
  });

  it('18. dry_run resolves probe targets from the tracked catalog without probing', async () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'test-secret-probes-dryrun';
    try {
      const res = await probesCronRoute(
        new NextRequest('http://localhost/api/cron/probes?dry_run=1', {
          headers: { Authorization: 'Bearer test-secret-probes-dryrun' },
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.dry_run).toBe(true);
      expect(typeof body.snapshots).toBe('number');
      expect(typeof body.targets).toBe('number');
      expect(body.targets).toBeLessThanOrEqual(body.snapshots);
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previous;
    }
  });

  it('19. rejects cron probes when CRON_SECRET is unset (fail-closed)', async () => {
    const previous = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await probesCronRoute(new NextRequest('http://localhost/api/cron/probes?dry_run=1'));
      expect(res.status).toBe(401);
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previous;
    }
  });
});