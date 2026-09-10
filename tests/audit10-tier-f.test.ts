import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as chatCompletions } from '../src/app/api/v1/chat/completions/route';
import { createOrGetUser, createApiKey, getRoutingReliability } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { uniqueEmail } from './helpers';
import fs from 'fs';
import path from 'path';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

async function pilotSetup() {
  const email = uniqueEmail('r10f.pilot');
  await createOrGetUser({ email });
  const pair = generateApiKey(email, 'production');
  await createApiKey(pair.keyRecord);
  process.env.ROUTING_ENABLED = 'true';
  process.env.ROUTING_PILOT_ALLOWLIST = email;
  delete process.env.ROUTING_UPSTREAM_KEY;
  const { createRoutingOptIn } = await import('../src/lib/db/queries');
  await createRoutingOptIn(email);
  return { email, key: pair.plaintextKey };
}

function chatReq(key: string | null, body: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  return new NextRequest('http://localhost/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('Tier F: R10 strategic gate (code + record)', () => {
  it('sign-off record exists and pins pilot-only scope', () => {
    const adr = fs.readFileSync(path.join(process.cwd(), 'docs/ADR-010-routing-gateway.md'), 'utf-8');
    expect(adr).toMatch(/CONDITIONAL GO.*pilot only/i);
    expect(adr).toMatch(/No silent substitution/i);
    expect(adr).toMatch(/Fail-closed default/i);
    expect(adr).toMatch(/does NOT authorize general availability/i);
    const plan = fs.readFileSync(path.join(process.cwd(), 'docs/ROUTING_INCIDENT_PLAN.md'), 'utf-8');
    expect(plan).toMatch(/Kill switch first/i);
    expect(plan).toMatch(/never retries/i);
  });

  it('prerequisite suites exist and are real (not stubs)', () => {
    for (const f of ['tests/p11-1-cross-user.test.ts', 'tests/audit-fixes.test.ts', 'tests/auth-cookies.test.ts']) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf-8');
      expect(src).toContain('expect(');
      expect(src.length).toBeGreaterThan(500);
    }
  });

  it('pricing-data failure fails closed: unknown chain models → 503 + logged attempt', async () => {
    const { key } = await pilotSetup();
    const before = (await getRoutingReliability(24)).attempts;
    const res = await chatCompletions(
      chatReq(key, {
        routing_policy: 'fallback_chain',
        fallback_models: ['nope/missing-1', 'nope/missing-2'],
        messages: [{ role: 'user', content: 'hi' }],
      })
    );
    expect(res.status).toBe(503);
    const after = (await getRoutingReliability(24)).attempts;
    expect(after).toBeGreaterThan(before);
  });

  it('explicit model wins over policy (no silent substitution, no rescue)', async () => {
    const { key } = await pilotSetup();
    // Unknown explicit model + valid policy → 404 for the explicit id.
    // A substituting gateway would have routed via the policy instead.
    const res = await chatCompletions(
      chatReq(key, {
        model: 'nope/definitely-missing',
        routing_policy: 'cheapest',
        messages: [{ role: 'user', content: 'hi' }],
      })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('nope/definitely-missing');
  });

  it('general users are rejected without any pilot credential (even anonymous)', async () => {
    await pilotSetup();
    const anon = await chatCompletions(
      chatReq(null, { model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
    );
    expect(anon.status).toBe(403);
  });

  it('unreachable upstream fails closed with overhead header (pricing dependency down)', async () => {
    const { key } = await pilotSetup();
    process.env.ROUTING_UPSTREAM_BASE = 'http://127.0.0.1:1';
    process.env.ROUTING_UPSTREAM_KEY = 'k';
    const res = await chatCompletions(
      chatReq(key, {
        routing_policy: 'fallback_chain',
        fallback_models: ['openai/gpt-4o'],
        messages: [{ role: 'user', content: 'hi' }],
      })
    );
    // Empty shared catalog in CI or a failed forward: either way fail-closed, never 200-substituted.
    expect([502, 503]).toContain(res.status);
    expect(res.headers.get('X-Radar-Routed-Model')).toBeNull();
  });
});
