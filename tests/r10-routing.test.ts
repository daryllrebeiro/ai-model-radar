import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as chatCompletions } from '../src/app/api/v1/chat/completions/route';
import { GET as routingStats } from '../src/app/api/v1/routing/stats/route';
import { POST as optIn } from '../src/app/api/v1/routing/opt-in/route';
import {
  createOrGetUser,
  createApiKey,
  insertSnapshots,
  createRoutingOptIn,
  getRoutingReliability,
} from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { uniqueEmail } from './helpers';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

async function pilotSetup() {
  const email = uniqueEmail('r10.pilot');
  await createOrGetUser({ email });
  const pair = generateApiKey(email, 'production');
  await createApiKey(pair.keyRecord);
  await insertSnapshots([
    {
      model_id: 'r10/alpha',
      provider: 'R10Co',
      name: 'R10 Alpha',
      price_prompt: 0.000001,
      price_completion: 0.000002,
      context_length: 32000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
  ] as any);
  process.env.ROUTING_ENABLED = 'true';
  process.env.ROUTING_PILOT_ALLOWLIST = email;
  delete process.env.ROUTING_UPSTREAM_KEY;
  await createRoutingOptIn(email);
  return { email, key: pair.plaintextKey };
}

function chatReq(key: string, body: unknown) {
  return new NextRequest('http://localhost/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

describe('R10 routing gateway (pilot-gated, ADR-010)', () => {
  it('deny-by-default: disabled gateway is 503 even for pilot members', async () => {
    const { key } = await pilotSetup();
    process.env.ROUTING_ENABLED = 'false';
    const res = await chatCompletions(chatReq(key, { model: 'r10/alpha', messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(503);
  });

  it('non-pilot callers get 403 (closed pilot)', async () => {
    await pilotSetup();
    const outsider = uniqueEmail('r10.outsider');
    await createOrGetUser({ email: outsider });
    const pair = generateApiKey(outsider, 'production');
    await createApiKey(pair.keyRecord);
    const res = await chatCompletions(chatReq(pair.plaintextKey, { model: 'r10/alpha', messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(403);
  });

  it('no silent smart routing: no model + no policy is 400', async () => {
    const { key } = await pilotSetup();
    const res = await chatCompletions(chatReq(key, { messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/routing_policy/);
  });

  it('explicit model is used verbatim; missing upstream fails closed (503)', async () => {
    const { key } = await pilotSetup();
    const res = await chatCompletions(chatReq(key, { model: 'r10/alpha', messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/no upstream/i);
    const rel = await getRoutingReliability(24);
    expect(rel.attempts).toBeGreaterThan(0);
  });

  it('fail_open_original names the original model explicitly, never substitutes', async () => {
    const { key } = await pilotSetup();
    process.env.ROUTING_UPSTREAM_BASE = 'http://127.0.0.1:1';
    process.env.ROUTING_UPSTREAM_KEY = 'test-key';
    const res = await chatCompletions(
      chatReq(key, { model: 'r10/alpha', messages: [{ role: 'user', content: 'hi' }], on_failure: 'fail_open_original' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe('r10/alpha');
    expect(body.proxy_fallback).toBe(true);
    expect(res.headers.get('X-Radar-Proxy-Fallback')).toBe('1');
    expect(res.headers.get('X-Radar-Routed-Model')).toBeNull();
  });

  it('stats endpoint reports reliability, gated to pilot', async () => {
    const { key, email } = await pilotSetup();
    const denied = await routingStats(
      new NextRequest('http://localhost/api/v1/routing/stats', { headers: { Authorization: 'Bearer bad' } })
    );
    expect([401, 403, 429].includes(denied.status)).toBe(true);
    const ok = await routingStats(
      new NextRequest('http://localhost/api/v1/routing/stats?hours=24', { headers: { Authorization: `Bearer ${key}` } })
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toHaveProperty('success_rate');
    expect(body).toHaveProperty('by_policy');
    void email;
  });

  it('opt-in endpoint records consent for authenticated callers', async () => {
    const email = uniqueEmail('r10.optin');
    await createOrGetUser({ email });
    const pair = generateApiKey(email, 'free');
    await createApiKey(pair.keyRecord);
    const res = await optIn(
      new NextRequest('http://localhost/api/v1/routing/opt-in', {
        method: 'POST',
        headers: { Authorization: `Bearer ${pair.plaintextKey}` },
      })
    );
    expect(res.status).toBe(200);
  });
});
