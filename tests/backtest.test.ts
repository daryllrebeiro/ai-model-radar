import { describe, it, expect } from 'vitest';
import { backtestCutoff, resolveTrial, runBacktest } from '@/lib/backtest';
import type { ModelSnapshot } from '@/types/models';
import type { ModelEvent } from '@/types/events';
import type { PriceDropForecast } from '@/types/forecast';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2025, 0, 1);

function snap(modelId: string): ModelSnapshot {
  return {
    model_id: modelId,
    provider: 'BtCo',
    name: modelId,
    price_prompt: 0.000002,
    price_completion: 0.000008,
    context_length: 64000,
    modality: 'text->text',
    is_free: false,
    raw_json: {},
    polled_at: new Date(T0).toISOString(),
  };
}

function cut(modelId: string, atMs: number, pct = -10): ModelEvent {
  return {
    model_id: modelId,
    event_type: 'PRICE_CHANGE',
    old_value: { price_prompt: 0.000002 },
    new_value: { price_prompt: 0.0000018 },
    pct_change: pct,
    source: 'bt-seed',
    detected_at: new Date(atMs).toISOString(),
  };
}

function release(modelId: string, atMs: number): ModelEvent {
  return {
    model_id: modelId,
    event_type: 'NEW_MODEL',
    old_value: null,
    new_value: null,
    pct_change: null,
    source: 'bt-seed',
    detected_at: new Date(atMs).toISOString(),
  };
}

function forecast(modelId: string, probability: number, windowDays: number): PriceDropForecast {
  return {
    id: modelId,
    model_id: modelId,
    provider: 'BtCo',
    model_name: modelId,
    family: modelId,
    probability,
    confidence: 'medium',
    expected_pct_change: 10,
    expected_window_days: windowDays,
    model_age_days: 100,
    days_since_last_cut: 30,
    cadence_days: 30,
    cadence_samples: 3,
    factors: [],
    generated_at: new Date(T0).toISOString(),
  };
}

describe('resolveTrial', () => {
  const asOf = T0 + 65 * DAY_MS;
  const dataEnd = T0 + 400 * DAY_MS;
  const events = [
    release('bt/steady', T0),
    cut('bt/steady', T0 + 30 * DAY_MS),
    cut('bt/steady', T0 + 60 * DAY_MS),
    cut('bt/steady', T0 + 90 * DAY_MS),
    release('bt/other', T0 + 400 * DAY_MS),
  ];

  it('hits when a cut lands inside the window', () => {
    const t = resolveTrial(forecast('bt/steady', 0.8, 30), asOf, events, dataEnd);
    expect(t.hit).toBe(true);
  });

  it('misses when the window elapses without a cut', () => {
    const t = resolveTrial(forecast('bt/steady', 0.8, 10), asOf, events, dataEnd);
    // window (65d, 75d]: cuts at 60d (before) and 90d (after) -> miss
    expect(t.hit).toBe(false);
  });

  it('is unresolvable when the window extends past known data', () => {
    const t = resolveTrial(forecast('bt/steady', 0.8, 30), asOf, events, asOf + 5 * DAY_MS);
    expect(t.hit).toBeNull();
  });

  it('ignores cuts for other models and non-cut events', () => {
    const eventsOnlyOther = [release('bt/other', asOf + DAY_MS), cut('bt/other', asOf + 2 * DAY_MS)];
    const t = resolveTrial(forecast('bt/steady', 0.8, 30), asOf, eventsOnlyOther, dataEnd);
    expect(t.hit).toBe(false);
  });
});

describe('backtestCutoff', () => {
  it('scores a regular-cadence model end to end', () => {
    const snapshots = [snap('bt/steady')];
    const events = [
      release('bt/steady', T0),
      cut('bt/steady', T0 + 30 * DAY_MS),
      cut('bt/steady', T0 + 60 * DAY_MS),
      cut('bt/steady', T0 + 90 * DAY_MS),
      release('bt/other', T0 + 400 * DAY_MS),
    ];
    const report = backtestCutoff(snapshots, events, new Date(T0 + 65 * DAY_MS), {
      minProbability: 0,
      maxForecasts: 50,
    });
    const trial = report.trials.find((t) => t.model_id === 'bt/steady');
    expect(trial).toBeDefined();
    expect(trial!.hit).not.toBeNull();
    expect(report.resolved + report.unresolved).toBe(report.trials.length);
    if (report.resolved > 0) {
      expect(report.precision).toBeGreaterThanOrEqual(0);
      expect(report.precision).toBeLessThanOrEqual(1);
      expect(report.brier_score).toBeGreaterThanOrEqual(0);
      expect(report.brier_score).toBeLessThanOrEqual(1);
      const bucketN = report.calibration.reduce((s, b) => s + b.n, 0);
      expect(bucketN).toBe(report.resolved);
    }
  });

  it('returns null metrics without resolvable history', () => {
    const report = backtestCutoff([snap('bt/steady')], [], new Date(T0), { minProbability: 0 });
    // The engine may still emit age-based forecasts, but with no future
    // data every window is unresolvable — never a miss.
    expect(report.resolved).toBe(0);
    expect(report.unresolved).toBe(report.trials.length);
    expect(report.precision).toBeNull();
    expect(report.brier_score).toBeNull();
  });

  it('marks everything unresolved when the cutoff nears the data end', () => {
    const events = [release('bt/steady', T0), cut('bt/steady', T0 + 30 * DAY_MS)];
    const report = backtestCutoff([snap('bt/steady')], events, new Date(T0 + 29 * DAY_MS), {
      minProbability: 0,
    });
    expect(report.unresolved).toBe(report.trials.length);
    expect(report.resolved).toBe(0);
  });
});

describe('runBacktest', () => {
  it('aggregates across cutoffs', () => {
    const snapshots = [snap('bt/steady')];
    const events = [
      release('bt/steady', T0),
      cut('bt/steady', T0 + 30 * DAY_MS),
      cut('bt/steady', T0 + 60 * DAY_MS),
      cut('bt/steady', T0 + 90 * DAY_MS),
      release('bt/other', T0 + 400 * DAY_MS),
    ];
    const suite = runBacktest(
      snapshots,
      events,
      [new Date(T0 + 35 * DAY_MS), new Date(T0 + 65 * DAY_MS)],
      { minProbability: 0 }
    );
    expect(suite.cutoffs).toHaveLength(2);
    const totalTrials = suite.cutoffs.reduce((s, r) => s + r.trials.length, 0);
    expect(suite.aggregate.resolved + suite.aggregate.unresolved).toBe(totalTrials);
    expect(suite.data_end).toBe(new Date(T0 + 400 * DAY_MS).toISOString());
  });
});
