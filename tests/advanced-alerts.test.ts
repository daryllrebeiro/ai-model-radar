import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { evaluateAdvancedAlertRules } from '../src/lib/alerts';
import { ModelEvent } from '../src/types/events';
import { createOrGetUser, createApiKey } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { POST as evaluateRoute } from '../src/app/api/v1/alerts/evaluate/route';

afterEach(() => {
  delete process.env.FEATURE_ENFORCEMENT;
});

function makeEvent(overrides: Partial<ModelEvent>): ModelEvent {
  return {
    id: Math.floor(Math.random() * 1e6),
    model_id: 'openai/gpt-4o',
    event_type: 'PRICE_CHANGE',
    old_value: { prompt: 0.0000025, completion: 0.00001 },
    new_value: { prompt: 0.0000015, completion: 0.000006 },
    pct_change: -40,
    source: 'openrouter',
    detected_at: new Date().toISOString(),
    provider: 'OpenAI',
    ...overrides,
  };
}

describe('Phase 2.6: Advanced Alert Rules (Pro)', () => {
  const events: ModelEvent[] = [
    makeEvent({
      id: 1,
      model_id: 'openai/gpt-4o',
      provider: 'OpenAI',
      old_value: { prompt: 0.0000025, completion: 0.00001 },
      new_value: { prompt: 0.0000015, completion: 0.000006 },
      pct_change: -40,
      event_type: 'PRICE_CHANGE',
    }),
    makeEvent({
      id: 2,
      model_id: 'anthropic/claude-3-7-sonnet',
      provider: 'Anthropic',
      old_value: { prompt: 0.0000022, completion: 0.000015 },
      new_value: { prompt: 0.000002, completion: 0.000012 },
      pct_change: -9,
      event_type: 'PRICE_CHANGE',
    }),
    makeEvent({
      id: 3,
      model_id: 'microsoft/other-model',
      provider: 'Microsoft',
      old_value: null,
      new_value: null,
      pct_change: null,
      event_type: 'NEW_MODEL',
    }),
    makeEvent({
      id: 4,
      model_id: 'openai/gpt-4o-mini',
      provider: 'OpenAI',
      event_type: 'CONTEXT_CHANGED',
      context_length: 128000,
      old_value: { context_length: 32000 },
      new_value: { context_length: 128000 },
      pct_change: null,
    }),
  ];

  it('1. Basic config (mode=basic) still returns ranked events', () => {
    const result = evaluateAdvancedAlertRules(events, { mode: 'basic' });
    expect(result.total).toBe(events.length);
    expect(result.events).toHaveLength(events.length);
    expect(result.events[0].score).toBeGreaterThanOrEqual(0);
  });

  it('2. Suppress-providers filter excludes matching providers', () => {
    const result = evaluateAdvancedAlertRules(events, {
      mode: 'advanced',
      suppressProviders: ['OpenAI'],
    });
    expect(result.events.every((s) => s.event.provider !== 'OpenAI')).toBe(true);
    expect(result.total).toBeLessThan(events.length);
  });

  it('3. requireFamousFamilies keeps only recognized families with a reason', () => {
    const result = evaluateAdvancedAlertRules(events, {
      mode: 'advanced',
      requireFamousFamilies: true,
    });
    expect(result.total).toBeGreaterThan(0);
    expect(result.events.every((s) => s.event.model_id !== 'some-unknown/weird-model')).toBe(true);
    const claude = result.events.find((s) => s.event.model_id === 'anthropic/claude-3-7-sonnet');
    expect(claude?.reasons).toContain('Recognized model family');
  });

  it('4. minAbsoluteDropUsd only matches cuts that clear the threshold, with reason', () => {
    const result = evaluateAdvancedAlertRules(events, {
      mode: 'advanced',
      minAbsoluteDropUsd: 0.5, // >= $0.50/1M
    });
    expect(result.total).toBe(1);
    expect(result.events[0].event.model_id).toBe('openai/gpt-4o'); // $1.00 drop
    expect(result.events[0].reasons.some((r) => r.includes('Absolute drop'))).toBe(true);
  });

  it('5. maxContextWindowTokens filters by context range; matchModelId filters model', () => {
    const ctxFiltered = evaluateAdvancedAlertRules(events, {
      mode: 'advanced',
      minContextWindowTokens: 100000,
    });
    // Only the CONTEXT_CHANGED event exposes context_length
    expect(ctxFiltered.total).toBe(1);
    expect(ctxFiltered.events[0].event.event_type).toBe('CONTEXT_CHANGED');

    const modelFiltered = evaluateAdvancedAlertRules(events, {
      mode: 'advanced',
      matchModelId: 'mini',
    });
    expect(modelFiltered.total).toBe(1);
    expect(modelFiltered.events[0].event.model_id).toBe('openai/gpt-4o-mini');
  });

  it('6. Watchlist membership boosts the score', () => {
    const watchSet = new Set(['anthropic/claude-3-7-sonnet']);
    const result = evaluateAdvancedAlertRules(events, { mode: 'advanced' }, watchSet);
    const claude = result.events.find((s) => s.event.model_id === 'anthropic/claude-3-7-sonnet');
    expect(claude?.score).toBeGreaterThanOrEqual(30);
    expect(claude?.reasons).toContain('On your watchlist');
  });

  it('7. Results are sorted by descending score', () => {
    const result = evaluateAdvancedAlertRules(events, {
      mode: 'advanced',
      requireFamousFamilies: true,
      matchModelId: 'gpt',
    });
    const scores = result.events.map((s) => s.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('8. API endpoint requires authentication (401)', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/alerts/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { mode: 'advanced' } }),
    });
    const res = await evaluateRoute(req);
    expect(res.status).toBe(401);
  });

  it('9. Enforcement ON: free user blocked from advanced rules (403)', async () => {
    process.env.FEATURE_ENFORCEMENT = 'true';
    const email = `adv_free_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'free' });
    const { plaintextKey, keyRecord } = generateApiKey(email, 'free');
    await createApiKey(keyRecord);

    const req = new NextRequest('http://localhost:3000/api/v1/alerts/evaluate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${plaintextKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { mode: 'advanced' } }),
    });
    const res = await evaluateRoute(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.requiredTier).toBe('pro');
  });

  it('10. Enforcement ON: pro user evaluates advanced rules (200)', async () => {
    process.env.FEATURE_ENFORCEMENT = 'true';
    const email = `adv_pro_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'pro' });
    const { plaintextKey, keyRecord } = generateApiKey(email, 'pro');
    await createApiKey(keyRecord);

    const req = new NextRequest('http://localhost:3000/api/v1/alerts/evaluate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${plaintextKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { mode: 'advanced', requireFamousFamilies: true } }),
    });
    const res = await evaluateRoute(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.events)).toBe(true);
  });
});