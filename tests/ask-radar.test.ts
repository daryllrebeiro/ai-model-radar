import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { ModelSnapshot } from '../src/types/models';
import { ModelEvent } from '../src/types/events';
import { MarketSignal } from '../src/types/signals';
import { PriceDropForecast } from '../src/types/forecast';
import { EndpointTelemetry } from '../src/types/telemetry';
import { AskAnswer } from '../src/types/ask';
import {
  answerQuestion,
  validateAnswer,
  matchModelIds,
  AskContext,
} from '../src/lib/ask-answer';
import { buildMarketBrief, buildWatchlistBriefs } from '../src/lib/briefs';
import { createOrGetUser, createApiKey } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { POST as askRoute } from '../src/app/api/v1/ask/route';

function snap(modelId: string, provider: string, isFree = false): ModelSnapshot {
  return {
    model_id: modelId,
    provider,
    name: modelId.split('/').pop() || modelId,
    price_prompt: 0.000004,
    price_completion: 0.000016,
    context_length: 200000,
    modality: 'text->text',
    is_free: isFree,
    raw_json: {},
    polled_at: new Date().toISOString(),
  };
}

function event(overrides: Partial<ModelEvent> & { model_id: string; event_type: ModelEvent['event_type'] }): ModelEvent {
  return {
    id: 99,
    old_value: null,
    new_value: null,
    pct_change: null,
    source: 'test',
    detected_at: new Date().toISOString(),
    ...overrides,
  };
}

function signal(overrides: Partial<MarketSignal> = {}): MarketSignal {
  return {
    id: `SIG-${Math.random().toString(36).slice(2, 8)}`,
    signal_type: 'MODEL_EOL',
    model_id: 'acme/a-1',
    provider: 'Acme',
    title: 'EOL test signal',
    summary: 'test',
    evidence: { metric: 'x', current_value: '1', baseline_value: '0', deviation: '100%' },
    detected_at: new Date().toISOString(),
    severity: 'high',
    strength: 80,
    ...overrides,
  };
}

function forecast(modelId: string, probability = 0.8): PriceDropForecast {
  return {
    id: `F-${modelId}`,
    model_id: modelId,
    provider: 'Acme',
    model_name: modelId,
    family: modelId,
    probability,
    confidence: 'high',
    expected_pct_change: 10,
    expected_window_days: 14,
    model_age_days: 100,
    days_since_last_cut: 200,
    cadence_days: 90,
    cadence_samples: 3,
    factors: ['test'],
    generated_at: new Date().toISOString(),
  };
}

function telemetry(modelId: string): EndpointTelemetry {
  return {
    id: 1,
    model_id: modelId,
    provider: 'Acme',
    endpoint_url: `https://example.com/${modelId}`,
    checked_at: new Date().toISOString(),
    online: true,
    http_status: 200,
    p95_latency_ms: 1200,
    avg_latency_ms: 800,
    tokens_per_sec: 25,
    rate_limited: false,
    rate_limited_count: 0,
    retry_after_sec: null,
    sample_count: 5,
    is_free: false,
    free_tier_active: null,
    error: null,
  };
}

function ctx(): AskContext {
  return {
    snapshots: [snap('acme/a-1', 'Acme')],
    events: [
      event({ model_id: 'acme/a-1', event_type: 'PRICE_CHANGE', pct_change: -20 }),
      event({ id: 100, model_id: 'beta/b-1', event_type: 'NEW_MODEL' }),
    ],
    signals: [signal()],
    forecasts: [forecast('acme/a-1', 0.75)],
    telemetry: [telemetry('acme/a-1')],
  };
}

describe('Phase 6 - Ask the Radar: intent detection & answered questions', () => {
  it('1. unmapped open question falls back to the market overview intent', () => {
    const answer = answerQuestion({ question: 'What changed in the market recently?', context: ctx() });
    expect(answer.intent).toBe('overview');
    expect(answer.answer.length).toBeGreaterThan(20);
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it('2. a bare model id mention is answered as model_status with linked citations', () => {
    const answer = answerQuestion({ question: 'acme/a-1', context: ctx() });
    expect(answer.intent).toBe('model_status');
    expect(answer.answer).toContain('Acme');
    const types = answer.citations.map((c) => c.type);
    expect(types).toContain('model');
    expect(types).toContain('event');
  });

  it('3. forecast wording maps to the forecast intent and cites that forecast', () => {
    const answer = answerQuestion({ question: 'Is the price of acme/a-1 forecast to drop?', context: ctx() });
    expect(answer.intent).toBe('forecast');
    expect(answer.citations.some((c) => c.type === 'forecast')).toBe(true);
  });

  it('4. EOL questions list flagged models with signal citations', () => {
    const answer = answerQuestion({ question: 'Which models are end-of-life or deprecated?', context: ctx() });
    expect(answer.intent).toBe('eol');
    expect(answer.citations.some((c) => c.type === 'signal')).toBe(true);
    expect(answer.answer).toContain('acme/a-1');
  });

  it('5. savings questions without a profile return profile_required and market context', () => {
    const answer = answerQuestion({ question: 'How can I save money by switching?', context: ctx() });
    expect(answer.intent).toBe('recommendation');
    expect(answer.profile_required).toBe(true);
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it('6. savings questions with a profile no longer require one', () => {
    const answer = answerQuestion({
      question: 'Which cheaper model should I switch to?',
      context: ctx(),
      profile: { primary_model_id: 'acme/a-1', monthly_prompt_tokens: 1_000_000, monthly_comp_tokens: 500_000 },
    });
    expect(answer.intent).toBe('recommendation');
    expect(answer.profile_required).toBe(false);
  });

  it('7. telemetry questions cite the probe record for matched models', () => {
    const answer = answerQuestion({ question: 'Is acme/a-1 healthy right now?', context: ctx() });
    expect(answer.intent).toBe('telemetry');
    expect(answer.citations.some((c) => c.type === 'telemetry')).toBe(true);
  });

  it('8. same-family questions route to arbitrage clusters', () => {
    const cheaperBeta: ModelSnapshot = {
      ...snap('beta/llama-3.3-70b', 'Beta'),
      price_prompt: 0.000002,
      price_completion: 0.000008,
    };
    const clustersCtx: AskContext = {
      snapshots: [snap('acme/llama-3.3-70b', 'Acme'), cheaperBeta],
      events: [],
      signals: [],
      forecasts: [],
    };
    const answer = answerQuestion({ question: 'Do I have cheaper same family endpoints?', context: clustersCtx });
    expect(answer.intent).toBe('arbitrage');
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it('9. matchModelIds finds models by full id, dashed id and bare name', () => {
    const list = ctx().snapshots;
    expect(matchModelIds('acme/a-1', list)).toHaveLength(1);
    expect(matchModelIds('acme-a-1', list)).toHaveLength(1);
    expect(matchModelIds('a-1', list)).toHaveLength(1);
  });
});

describe('Phase 6 - Ask the Radar: citation validation', () => {
  it('10. every citation produced by a real answer verifies against the source context', () => {
    for (const q of [
      'What changed in the market recently?',
      'acme/a-1',
      'Which models are due for a price cut?',
      'Which models are deprecated?',
      'Is acme/a-1 healthy right now?',
      'How can I switch to save money?',
    ]) {
      const answer = answerQuestion({ question: q, context: ctx() });
      expect(validateAnswer(answer, ctx()), `unverified citations for "${q}"`).toEqual([]);
    }
  });

  it('11. validateAnswer flags citations that reference models outside the dataset', () => {
    const bogus: AskAnswer = {
      question: 'x',
      intent: 'model_status',
      answer: 'claim',
      citations: [
        { id: 'model:ghost/x', type: 'model', title: 'ghost', model_id: 'ghost/x', url: '/models/ghost/x' },
        { id: 'forecast:acme/a-1', type: 'forecast', title: 'f', model_id: 'acme/a-1', url: '/forecast' },
      ],
    };
    const unverifiable = validateAnswer(bogus, ctx());
    expect(unverifiable).toEqual(['model:ghost/x']);
  });
});

describe('Phase 6 - Market briefs (free tier history + diff)', () => {
  it('12. buildMarketBrief summarizes per-watchlist changes with changelog citations', () => {
    const brief = buildMarketBrief({
      watchlist: ['acme/a-1', 'beta/b-1'],
      source: ctx(),
    });
    expect(brief.scope).toBe('watchlist');
    expect(brief.watchlist).toEqual(['acme/a-1', 'beta/b-1']);
    expect(brief.models.length).toBeGreaterThan(0);
    const a = brief.models.find((m) => m.model_id === 'acme/a-1');
    expect(a).toBeDefined();
    expect(a!.window_pct_change).toBe(-20);
    expect(brief.citations.some((c) => c.type === 'event')).toBe(true);
    expect(brief.citations.some((c) => c.type === 'model')).toBe(true);
    expect(brief.headline.length).toBeGreaterThan(5);
  });

  it('13. buildWatchlistBriefs emits one per-email brief for digest dispatch', () => {
    const targets = [
      { email: 'one@test.dev', model_ids: ['acme/a-1'] },
      { email: 'two@test.dev', model_ids: ['beta/b-1'] },
    ];
    const briefs = buildWatchlistBriefs(targets, { source: ctx() });
    expect(briefs).toHaveLength(2);
    expect(briefs[0].email).toBe('one@test.dev');
    expect(briefs[0].brief.scope).toBe('watchlist');
  });

  it('14. brief with no watchlist scans the whole catalog (scope all)', () => {
    const brief = buildMarketBrief({ source: ctx() });
    expect(brief.scope).toBe('all');
    expect(Array.isArray(brief.models)).toBe(true);
  });

  it('18. buildMarketBrief is verifiable against a fixed asOf point in time', () => {
    const fixedEvent: ModelEvent = {
      id: 7,
      model_id: 'acme/a-1',
      event_type: 'PRICE_CHANGE',
      old_value: { price_prompt: '0.000004' },
      new_value: { price_prompt: '0.000003' },
      pct_change: -25,
      source: 'test',
      detected_at: '2026-01-10T12:00:00.000Z',
    };
    const source = { ...ctx(), events: [fixedEvent] };

    const inside = buildMarketBrief({ watchlist: ['acme/a-1'], source, asOf: '2026-01-12T00:00:00.000Z' });
    expect(inside.models[0].window_pct_change).toBe(-25);
    expect(inside.headline).toContain('dropped 25%');
    expect(inside.generated_at).toBe('2026-01-12T00:00:00.000Z');

    const outside = buildMarketBrief({
      watchlist: ['acme/a-1'],
      source: { ...source, signals: [] },
      asOf: '2026-03-01T00:00:00.000Z',
    });
    expect(outside.models[0].window_pct_change).toBeNull();
    expect(outside.headline).toContain('No tracked models changed');
  });
});

describe('Phase 6 - Ask the Radar: API (v1)', () => {
  it('15. POST /api/v1/ask requires authentication', async () => {
    const res = await askRoute(new NextRequest('http://localhost/api/v1/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'hello' }),
    }));
    expect(res.status).toBe(401);
  });

  it('16. POST rejects questions shorter than 3 characters', async () => {
    const user = await createOrGetUser({ email: `ask.short.${Date.now()}@test.dev` });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'production');
    await createApiKey(keyRecord);
    const res = await askRoute(new NextRequest('http://localhost/api/v1/ask', {
      method: 'POST',
      headers: { Authorization: `Bearer ${plaintextKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'hi' }),
    }));
    expect(res.status).toBe(400);
  });

  it('17. POST answers an authenticated question and validates its citations', async () => {
    const user = await createOrGetUser({ email: `ask.ok.${Date.now()}@test.dev` });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'production');
    await createApiKey(keyRecord);

    const res = await askRoute(new NextRequest('http://localhost/api/v1/ask', {
      method: 'POST',
      headers: { Authorization: `Bearer ${plaintextKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'What changed in the market recently?',
        profile: { primary_model_id: 'acme/a-1', monthly_prompt_tokens: 1_000_000, monthly_comp_tokens: 500_000 },
      }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('protocol');
    expect(body.citations_validated).toBe(true);
    expect(typeof body.answer.intent).toBe('string');
    expect(body.answer.answer.length).toBeGreaterThan(20);
    expect(Array.isArray(body.answer.citations)).toBe(true);
  });
});