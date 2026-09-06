import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { computePriceDropForecasts, getPriceDropForecasts, toFamily } from '../src/lib/forecast';
import { detectMarketSignals } from '../src/lib/signals';
import { createOrGetUser, createApiKey } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { GET as forecastRoute } from '../src/app/api/v1/forecast/route';
import { ModelSnapshot } from '../src/types/models';
import { ModelEvent } from '../src/types/events';

const AS_OF = new Date('2026-09-05T00:00:00Z');
const daysAgo = (days: number) =>
  new Date(AS_OF.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

function snap(modelId: string, provider: string, name: string, isFree = false): ModelSnapshot {
  return {
    model_id: modelId,
    provider,
    name,
    price_prompt: 0.000001,
    price_completion: 0.000004,
    context_length: 200000,
    modality: 'text->text',
    is_free: isFree,
    raw_json: {},
    polled_at: daysAgo(0),
  };
}

function cut(modelId: string, daysAgoTs: number, pct: number): ModelEvent {
  return {
    model_id: modelId,
    event_type: 'PRICE_CHANGE',
    old_value: null,
    new_value: null,
    pct_change: pct,
    source: 'openrouter',
    detected_at: daysAgo(daysAgoTs),
  };
}

function release(modelId: string, daysAgoTs: number): ModelEvent {
  return {
    model_id: modelId,
    event_type: 'NEW_MODEL',
    old_value: null,
    new_value: null,
    pct_change: null,
    source: 'openrouter',
    detected_at: daysAgo(daysAgoTs),
  };
}

describe('Phase 4 - RadarForecast: toFamily', () => {
  it('1. Collapses date, free, version, size, and variant suffixes into a line family', () => {
    expect(toFamily('openai/gpt-4o-2025-04-09')).toBe('openai/gpt-4o');
    expect(toFamily('openai/gpt-4o-mini')).toBe('openai/gpt-4o');
    expect(toFamily('anthropic/claude-3-5-haiku:free')).toBe('anthropic/claude-3-5');
    expect(toFamily('anthropic/claude-3-7-sonnet')).toBe('anthropic/claude-3-7');
    expect(toFamily('metavorm/model-v3')).toBe('metavorm/model');
    expect(toFamily('acme/cloud-3-sonnet')).toBe('acme/cloud-3');
    expect(toFamily('acme/cloud-3-opus:online')).toBe('acme/cloud-3');
  });
});

describe('Phase 4 - RadarForecast: cadence engine', () => {
  const snapshots: ModelSnapshot[] = [
    snap('acme/cloud-3-opus', 'Acme', 'Cloud 3 Opus'),
    snap('acme/cloud-3-haiku', 'Acme', 'Cloud 3 Haiku'),
    snap('acme/cloud-3-flash', 'Acme', 'Cloud 3 Flash'),
    snap('acme/cloud-3-sonnet', 'Acme', 'Cloud 3 Sonnet'),
    snap('acme/cloud-3-free', 'Acme', 'Cloud 3 Free', true),
  ];

  const events: ModelEvent[] = [
    release('acme/cloud-3-opus', 420),
    cut('acme/cloud-3-opus', 320, -30),
    cut('acme/cloud-3-opus', 230, -25),
    release('acme/cloud-3-haiku', 300),
    cut('acme/cloud-3-haiku', 260, -50),
    cut('acme/cloud-3-haiku', 180, -40),
    release('acme/cloud-3-flash', 200),
    release('acme/cloud-3-sonnet', 120),
    cut('acme/cloud-3-sonnet', 45, -35),
  ];

  it('2. Overdue newcomer flash in a regularly-cut line is forecast with high confidence', () => {
    const forecasts = getPriceDropForecasts(snapshots, events, { asOf: AS_OF });
    const flash = forecasts.find((f) => f.model_id === 'acme/cloud-3-flash');

    expect(flash).toBeDefined();
    expect(flash!.probability).toBe(0.93);
    expect(flash!.confidence).toBe('high');
    expect(flash!.expected_window_days).toBe(7);
    expect(flash!.days_since_last_cut).toBeNull();
    expect(flash!.cadence_days).toBe(80);
    expect(flash!.expected_pct_change).toBe(35);
    expect(flash!.factors.join(' ')).toContain('Never observed a price cut (est. age 200d)');
    expect(flash!.factors.join(' ')).toContain('Typical cut magnitude \u2248 35%');
  });

  it('3. Line cadence is the median of all gap observations (release->cut and cut->cut)', () => {
    const forecasts = computePriceDropForecasts(snapshots, events, { asOf: AS_OF, minProbability: 0 });
    const haiku = forecasts.find((f) => f.model_id === 'acme/cloud-3-haiku');
    expect(haiku!.cadence_days).toBe(80);
    expect(haiku!.cadence_samples).toBe(5);
    expect(haiku!.confidence).toBe('high');
  });

  it('4. Recently-cut models are flagged below the emission floor', () => {
    const forecasts = getPriceDropForecasts(snapshots, events, { asOf: AS_OF });
    expect(forecasts.find((f) => f.model_id === 'acme/cloud-3-sonnet')).toBeUndefined();
    expect(forecasts.find((f) => f.model_id === 'acme/cloud-3-free')).toBeUndefined();

    const full = computePriceDropForecasts(snapshots, events, { asOf: AS_OF, minProbability: 0 });
    const sonnet = full.find((f) => f.model_id === 'acme/cloud-3-sonnet');
    expect(sonnet!.probability).toBe(0.32);
    expect(sonnet!.expected_window_days).toBe(35);
  });

  it('5. Free models are excluded entirely', () => {
    const full = computePriceDropForecasts(snapshots, events, { asOf: AS_OF, minProbability: 0 });
    expect(full.some((f) => f.model_id === 'acme/cloud-3-free')).toBe(false);
  });

  it('6. Results sort strongest first and respect the maxForecasts cap', () => {
    const forecasts = getPriceDropForecasts(snapshots, events, { asOf: AS_OF, maxForecasts: 2 });
    expect(forecasts).toHaveLength(2);
    expect(forecasts.every((f) => f.probability >= 0.75)).toBe(true);
  });

  it('7. Estimate is deterministic for a fixed asOf point', () => {
    const a = computePriceDropForecasts(snapshots, events, { asOf: AS_OF, minProbability: 0 });
    const b = computePriceDropForecasts(snapshots, events, { asOf: AS_OF, minProbability: 0 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('Phase 4 - RadarForecast: fallbacks', () => {
  it('8. Models with no archive history fall back to a low-confidence market prior', () => {
    const snapshots: ModelSnapshot[] = [snap('newco/model-x', 'NewCo', 'Model X')];
    const full = computePriceDropForecasts(snapshots, [], { asOf: AS_OF, minProbability: 0 });
    const forecast = full[0];

    expect(forecast.probability).toBe(0.12);
    expect(forecast.confidence).toBe('low');
    expect(forecast.cadence_days).toBeNull();
    expect(forecast.factors.join(' ')).toContain('No price-cut history yet');

    expect(getPriceDropForecasts(snapshots, [], { asOf: AS_OF })).toHaveLength(0);
  });

  it('9. Family-less models use provider-wide cadence when the provider reprices other lines', () => {
    const snapshots: ModelSnapshot[] = [
      snap('othercorp/sigma-a', 'OtherCorp', 'Sigma A'),
      snap('othercorp/sigma-b', 'OtherCorp', 'Sigma B'),
      snap('othercorp/omega', 'OtherCorp', 'Omega'),
    ];
    const events: ModelEvent[] = [
      release('othercorp/sigma-a', 500),
      cut('othercorp/sigma-a', 400, -40),
      cut('othercorp/sigma-a', 310, -20),
      release('othercorp/sigma-b', 460),
      cut('othercorp/sigma-b', 370, -30),
      cut('othercorp/sigma-b', 280, -15),
      release('othercorp/omega', 315),
    ];

    const forecasts = getPriceDropForecasts(snapshots, events, { asOf: AS_OF });
    const omega = forecasts.find((f) => f.model_id === 'othercorp/omega');

    expect(omega).toBeDefined();
    expect(omega!.cadence_days).toBe(90);
    expect(omega!.confidence).toBe('high');
    expect(omega!.factors.join(' ')).toContain('provider-wide median cut cadence 90d');
    expect(omega!.probability).toBe(0.93);
  });
});

describe('Phase 4 - RadarForecast: PRICE_DROP_EXPECTED signal', () => {
  const snapshots: ModelSnapshot[] = [
    snap('acme/cloud-beta', 'Acme', 'Cloud Beta'),
    snap('acme/cloud-gamma', 'Acme', 'Cloud Gamma'),
  ];
  const events: ModelEvent[] = [
    release('acme/cloud-beta', 400),
    cut('acme/cloud-beta', 300, -30),
    cut('acme/cloud-beta', 200, -20),
    release('acme/cloud-gamma', 100),
    cut('acme/cloud-gamma', 15, -25),
  ];

  it('10. Emits a high-severity PRICE_DROP_EXPECTED for a model overdue a cut', () => {
    const signals = detectMarketSignals(snapshots, events);
    const forecastSignals = signals.filter((s) => s.signal_type === 'PRICE_DROP_EXPECTED');

    expect(forecastSignals.length).toBeGreaterThan(0);
    const top = forecastSignals[0];
    expect(top.model_id).toBe('acme/cloud-beta');
    expect(top.severity).toBe('high');
    expect(top.title).toContain('Price Cut Likely');
    expect(String(top.strength)).toMatch(/^\d+(\.\d+)?$/);
  });

  it('11. Recently-cut models do not emit forecast signals', () => {
    const signals = detectMarketSignals(snapshots, events);
    expect(signals.some((s) => s.signal_type === 'PRICE_DROP_EXPECTED' && s.model_id === 'acme/cloud-gamma')).toBe(false);
  });
});

describe('Phase 4 - RadarForecast: /api/v1/forecast', () => {
  async function withProKey() {
    const user = await createOrGetUser({ email: 'forecast.pro@test.dev' });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'production');
    await createApiKey(keyRecord);
    return plaintextKey;
  }

  it('12. Rejects unauthenticated requests', async () => {
    const res = await forecastRoute(new NextRequest('http://localhost/api/v1/forecast'));
    expect(res.status).toBe(401);
  });

  it('13. Returns forecasts for an authenticated pro request', async () => {
    const key = await withProKey();
    const res = await forecastRoute(
      new NextRequest('http://localhost/api/v1/forecast?limit=5', {
        headers: { Authorization: `Bearer ${key}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe('v1');
    expect(typeof body.summary.total).toBe('number');
    expect(Array.isArray(body.forecasts)).toBe(true);
    expect(body.forecasts.length).toBeLessThanOrEqual(5);
  });

  it('14. Clamps limit to the 1..50 window', async () => {
    const key = await withProKey();
    const res = await forecastRoute(
      new NextRequest('http://localhost/api/v1/forecast?limit=9999', {
        headers: { Authorization: `Bearer ${key}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.forecasts.length).toBeLessThanOrEqual(50);
  });
});
