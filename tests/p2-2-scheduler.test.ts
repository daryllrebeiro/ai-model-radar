import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/cron/active-probe/route';
import { buildProbeGenerateFn } from '../src/lib/active-probe';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

function authed(url: string, secret: string) {
  return new NextRequest(url, { headers: { Authorization: `Bearer ${secret}` } });
}

describe('P2-2 active-probe scheduler gates (spend-safe order)', () => {
  it('no CRON_SECRET match → 401 before any work', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.ACTIVE_PROBE_ENABLED = 'true';
    const res = await GET(authed('http://localhost/api/cron/active-probe?dry_run=1', 'wrong'));
    expect(res.status).toBe(401);
  });

  it('kill switch OFF → disabled, zero spend, zero calls', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    delete process.env.ACTIVE_PROBE_ENABLED;
    const res = await GET(authed('http://localhost/api/cron/active-probe?dry_run=1', 'test-cron-secret'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('disabled');
  });

  it('dry_run resolves targets without credentials or spend', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.ACTIVE_PROBE_ENABLED = 'true';
    delete process.env.PROBE_OPENAI_KEY;
    const res = await GET(authed('http://localhost/api/cron/active-probe?dry_run=1', 'test-cron-secret'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dry_run).toBe(true);
    expect(Array.isArray(body.targets)).toBe(true);
    expect(body.budgeted_calls).toBeLessThanOrEqual(30);
  });

  it('live run without a dedicated key → 503, never half-run', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.ACTIVE_PROBE_ENABLED = 'true';
    delete process.env.PROBE_OPENAI_KEY;
    const res = await GET(authed('http://localhost/api/cron/active-probe', 'test-cron-secret'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('no-credentials');
  });
});

describe('P2-2 probe generator (OpenAI-compatible, timed)', () => {
  it('parses content and measures ttft/tokens from stub fetch', async () => {
    const fetchFn = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Paris' } }] }),
    })) as any;
    const gen = buildProbeGenerateFn({ baseUrl: 'https://x.test/v1', apiKey: 'k', fetchFn });
    const r = await gen('a/m', 'Capital of France?', 32);
    expect(r.output).toBe('Paris');
    expect(r.ttft_ms).not.toBeNull();
    expect(r.tokens_per_sec).toBeGreaterThan(0);
  });

  it('upstream HTTP error throws (counted as cycle error, never sampled)', async () => {
    const fetchFn = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as any;
    const gen = buildProbeGenerateFn({ baseUrl: 'https://x.test/v1', apiKey: 'k', fetchFn });
    await expect(gen('a/m', 'hi', 8)).rejects.toThrow(/HTTP 500/);
  });
});
