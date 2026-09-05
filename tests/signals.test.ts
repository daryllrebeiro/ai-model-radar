import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { detectMarketSignals, computeRobustDeviation, scoreSignal } from '../src/lib/signals';
import { createOrGetUser, createApiKey } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { GET as signalsRoute } from '../src/app/api/v1/signals/route';
import { ModelSnapshot } from '../src/types/models';
import { ModelEvent } from '../src/types/events';

afterEach(() => {
  delete process.env.FEATURE_ENFORCEMENT;
});

describe('Phase P0.3: Robust Statistical Anomaly (Median + MAD)', () => {
  const sampleSnapshots: ModelSnapshot[] = [
    {
      model_id: 'anthropic/claude-3-7-sonnet',
      provider: 'Anthropic',
      name: 'Claude 3.7 Sonnet',
      price_prompt: 0.000003, // $3.00/1M
      price_completion: 0.000015,
      context_length: 200000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
    {
      model_id: 'openai/gpt-4o',
      provider: 'OpenAI',
      name: 'GPT-4o',
      price_prompt: 0.0000025, // $2.50/1M
      price_completion: 0.00001,
      context_length: 128000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
    {
      model_id: 'meta-llama/llama-3.3-70b',
      provider: 'Meta',
      name: 'Llama 3.3 70B',
      price_prompt: 0.0000007, // $0.70/1M
      price_completion: 0.0000008,
      context_length: 131072,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
    {
      model_id: 'deepseek/deepseek-chat',
      provider: 'DeepSeek',
      name: 'DeepSeek V3',
      price_prompt: 0.00000014, // $0.14/1M (Extreme outlier)
      price_completion: 0.00000028,
      context_length: 64000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
    {
      model_id: 'google/gemini-2.0-flash',
      provider: 'Google',
      name: 'Gemini 2.0 Flash',
      price_prompt: 0.0000001, // $0.10/1M
      price_completion: 0.0000004,
      context_length: 1048576, // 1M context
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
  ];

  it('1. Computes Median and Median Absolute Deviation (MAD) correctly', () => {
    const stats = computeRobustDeviation(sampleSnapshots);
    expect(stats.sampleSize).toBe(5);
    // Prices: 0.10, 0.14, 0.70, 2.50, 3.00. Median = 0.70
    expect(stats.median).toBe(0.70);
    expect(stats.mad).toBeGreaterThan(0);
  });

  it('2. Detects genuine pricing outliers using MAD distance with transparent evidence', () => {
    const signals = detectMarketSignals(sampleSnapshots, []);
    expect(signals.length).toBeGreaterThanOrEqual(2);

    const priceAnomaly = signals.find((s) => s.signal_type === 'PRICE_ANOMALY');
    expect(priceAnomaly).toBeDefined();
    expect(priceAnomaly?.evidence.metric).toContain('Median Absolute Deviation');
    expect(priceAnomaly?.evidence.deviation).toContain('MAD');

    const contextBreakthrough = signals.find((s) => s.signal_type === 'CONTEXT_BREAKTHROUGH');
    expect(contextBreakthrough).toBeDefined();
  });
});

describe('Phase 2.3: Enhanced Market Signals (Pro)', () => {
  const snapshots: ModelSnapshot[] = [
    {
      model_id: 'test/acme-sonnet',
      provider: 'Acme',
      name: 'Acme Sonnet Clone',
      price_prompt: 0.000001,
      price_completion: 0.000004,
      context_length: 32000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
    {
      model_id: 'test/acme-mini',
      provider: 'Acme',
      name: 'Acme Mini',
      price_prompt: 0.000002,
      price_completion: 0.000006,
      context_length: 32000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
  ];

  const events: ModelEvent[] = [
    {
      id: 1,
      model_id: 'test/acme-sonnet',
      event_type: 'BECAME_FREE',
      old_value: null,
      new_value: null,
      pct_change: -100,
      source: 'openrouter',
      detected_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 2,
      model_id: 'test/acme-mini',
      event_type: 'CONTEXT_CHANGED',
      old_value: { context_length: 32000 },
      new_value: { context_length: 128000 },
      pct_change: null,
      source: 'openrouter',
      detected_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 3,
      model_id: 'test/acme-mini',
      event_type: 'PRICE_CHANGE',
      old_value: { prompt: 0.000004, completion: 0.000012 },
      new_value: { prompt: 0.000002, completion: 0.000006 },
      pct_change: -50,
      source: 'openrouter',
      detected_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 4,
      model_id: 'test/acme-sonnet',
      event_type: 'PRICE_CHANGE',
      old_value: { prompt: 0.000002, completion: 0.000008 },
      new_value: { prompt: 0.000001, completion: 0.000004 },
      pct_change: -50,
      source: 'openrouter',
      detected_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  it('3. Every signal carries a bounded strength score and factor list', () => {
    const signals = detectMarketSignals(snapshots, events);
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(s.strength).toBeGreaterThanOrEqual(1);
      expect(s.strength).toBeLessThanOrEqual(100);
      expect(Array.isArray(s.strength_factors)).toBe(true);
    }
  });

  it('4. scoreSignal composes severity base + recency bonus and honors the 100 cap', () => {
    const freshHigh = scoreSignal('high', new Date().toISOString(), 15, []);
    expect(freshHigh.strength).toBe(100); // 70 + 15 + 15 = 100
    expect(freshHigh.factors.length).toBeGreaterThanOrEqual(2);

    const staleInfo = scoreSignal('info', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), 0, []);
    expect(staleInfo.strength).toBe(20);
    expect(staleInfo.factors).toHaveLength(0);
  });

  it('5. Detects FREE_GRADIENT from recent BECAME_FREE events', () => {
    const signals = detectMarketSignals(snapshots, events);
    const gradient = signals.find((s) => s.signal_type === 'FREE_GRADIENT');
    expect(gradient).toBeDefined();
    expect(gradient?.model_id).toBe('test/acme-sonnet');
    expect(gradient?.severity).toBe('high');
  });

  it('6. Detects CONTEXT_EXPANSION when context grows >= 25%', () => {
    const signals = detectMarketSignals(snapshots, events);
    const expansion = signals.find((s) => s.signal_type === 'CONTEXT_EXPANSION');
    expect(expansion).toBeDefined();
    expect(expansion?.model_id).toBe('test/acme-mini');
    expect(expansion?.evidence.deviation).toContain('+300%'); // 128k / 32k = 4x
  });

  it('7. Detects SECTOR_PRICE_WAR when a provider reprices 3+ distinct models', () => {
    const providerEvents: ModelEvent[] = [
      events[2], // acme-mini cut
      events[3], // acme-sonnet cut
      {
        id: 5,
        model_id: 'test/acme-third',
        event_type: 'PRICE_CHANGE',
        old_value: null,
        new_value: null,
        pct_change: -30,
        source: 'openrouter',
        detected_at: new Date().toISOString(),
      },
    ];
    const providerSnaps: ModelSnapshot[] = [
      ...snapshots,
      {
        model_id: 'test/acme-third',
        provider: 'Acme',
        name: 'Acme Third',
        price_prompt: 0.000001,
        price_completion: 0.000003,
        context_length: 32000,
        modality: 'text->text',
        is_free: false,
        raw_json: {},
        polled_at: new Date().toISOString(),
      },
    ];
    const signals = detectMarketSignals(providerSnaps, providerEvents);
    const war = signals.find((s) => s.signal_type === 'SECTOR_PRICE_WAR');
    expect(war).toBeDefined();
    expect(war?.provider).toBe('Acme');
    expect(war?.evidence.current_value).toContain('3 Models Reduced');
  });

  it('8. Returns a sorted-by-strength signals list from the API endpoint', async () => {
    const email = `signal_api_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'pro' });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'pro');
    await createApiKey(keyRecord);

    const req = new NextRequest('http://localhost:3000/api/v1/signals?limit=5', {
      headers: { Authorization: `Bearer ${plaintextKey}` },
    });
    const res = await signalsRoute(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.version).toBe('v1');
    expect(body.summary).toBeDefined();
    expect(body.summary.total).toBeGreaterThanOrEqual(0);
    const strengths = body.signals.map((s: any) => s.strength ?? 0);
    expect([...strengths].sort((a, b) => b - a)).toEqual(strengths);
  });

  it('9. Signals endpoint requires authentication (401 unauthenticated)', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/signals');
    const res = await signalsRoute(req);
    expect(res.status).toBe(401);
  });

  it('10. Enforcement ON: free user receives 403 for the Pro signals feed', async () => {
    process.env.FEATURE_ENFORCEMENT = 'true';
    const email = `signal_free_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'free' });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'free');
    await createApiKey(keyRecord);

    const req = new NextRequest('http://localhost:3000/api/v1/signals', {
      headers: { Authorization: `Bearer ${plaintextKey}` },
    });
    const res = await signalsRoute(req);
    expect(res.status).toBe(403);
  });

  it('11. Detects MODEL_EOL for delisted models that never returned', () => {
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const events: ModelEvent[] = [
      { model_id: 'acme/retired-1', event_type: 'MODEL_REMOVED', old_value: null, new_value: null, pct_change: null, source: 'openrouter', detected_at: daysAgo(10) },
      { model_id: 'acme/retired-2', event_type: 'MODEL_REMOVED', old_value: null, new_value: null, pct_change: null, source: 'openrouter', detected_at: daysAgo(0) },
      // Temporarily vanished, then relisted: must NOT be flagged EOL
      { model_id: 'acme/temp-gone', event_type: 'MODEL_REMOVED', old_value: null, new_value: null, pct_change: null, source: 'openrouter', detected_at: daysAgo(5) },
      { model_id: 'acme/temp-gone', event_type: 'NEW_MODEL', old_value: null, new_value: null, pct_change: null, source: 'openrouter', detected_at: daysAgo(2) },
    ];

    const signals = detectMarketSignals([], events);
    const eol = signals.filter((s) => s.signal_type === 'MODEL_EOL');

    expect(eol).toHaveLength(2);
    const retired1 = eol.find((s) => s.model_id === 'acme/retired-1');
    const retired2 = eol.find((s) => s.model_id === 'acme/retired-2');

    expect(retired1?.severity).toBe('high');
    expect(retired1?.evidence.deviation).toBe('10d since last observed');
    expect(retired1?.title).toContain('End of Life');
    expect(retired2?.severity).toBe('info');
    expect(eol.some((s) => s.model_id === 'acme/temp-gone')).toBe(false);
  });
});
