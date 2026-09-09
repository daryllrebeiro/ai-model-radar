/**
 * Forecast Backtesting (pure): scores historical price-drop forecasts
 * against realized cuts.
 *
 * Method: for each cutoff T, replay the forecaster with only events known
 * at T (`asOf: T`), then resolve each emitted forecast against later
 * events. A forecast is a HIT when its model posts a PRICE_CHANGE cut
 * inside (T, T + expected_window_days]. Forecasts whose window extends
 * past the newest known event are UNRESOLVABLE (not counted — penalizing
 * the model for missing future would be dishonest).
 *
 * Limitation: snapshot metadata (prices, names) is current-as-run; only
 * the event stream is time-sliced. Cut outcomes depend on events, so the
 * bias is limited to cadence inputs that read snapshot fields.
 */

import type { ModelSnapshot } from '@/types/models';
import type { ModelEvent } from '@/types/events';
import type { PriceDropForecast } from '@/types/forecast';
import { getPriceDropForecasts } from './forecast';

export interface BacktestTrial {
  model_id: string;
  probability: number;
  expected_window_days: number;
  as_of: string;
  resolves_at: string;
  /** true = cut landed in window, false = window elapsed without a cut, null = window extends past known data. */
  hit: boolean | null;
}

export interface CalibrationBucket {
  range: string;
  n: number;
  mean_predicted: number;
  observed_rate: number | null;
}

export interface BacktestReport {
  as_of: string;
  trials: BacktestTrial[];
  resolved: number;
  hits: number;
  unresolved: number;
  precision: number | null;
  brier_score: number | null;
  mean_predicted: number | null;
  calibration: CalibrationBucket[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isCutEvent(e: ModelEvent): boolean {
  return e.event_type === 'PRICE_CHANGE' && e.pct_change !== null && e.pct_change < 0;
}

/**
 * Resolves one forecast against the full event stream. Exported for tests.
 */
export function resolveTrial(
  forecast: PriceDropForecast,
  asOfMs: number,
  allEvents: ModelEvent[],
  dataEndMs: number
): BacktestTrial {
  const resolvesAt = asOfMs + forecast.expected_window_days * DAY_MS;
  const asOfIso = new Date(asOfMs).toISOString();
  const base: BacktestTrial = {
    model_id: forecast.model_id,
    probability: forecast.probability,
    expected_window_days: forecast.expected_window_days,
    as_of: asOfIso,
    resolves_at: new Date(resolvesAt).toISOString(),
    hit: null,
  };
  if (resolvesAt > dataEndMs) return base;
  const hit = allEvents.some((e) => {
    if (e.model_id.toLowerCase() !== forecast.model_id.toLowerCase()) return false;
    if (!isCutEvent(e)) return false;
    const at = new Date(e.detected_at).getTime();
    return Number.isFinite(at) && at > asOfMs && at <= resolvesAt;
  });
  return { ...base, hit };
}

const BUCKET_EDGES = [0, 0.35, 0.5, 0.65, 0.8, 1.01];

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function backtestCutoff(
  snapshots: ModelSnapshot[],
  allEvents: ModelEvent[],
  asOf: Date,
  opts: { minProbability?: number; maxForecasts?: number } = {}
): BacktestReport {
  const asOfMs = asOf.getTime();
  const times = allEvents
    .map((e) => new Date(e.detected_at).getTime())
    .filter((t) => Number.isFinite(t));
  const dataEndMs = times.length > 0 ? Math.max(...times) : asOfMs;

  const history = allEvents.filter((e) => {
    const t = new Date(e.detected_at).getTime();
    return Number.isFinite(t) && t <= asOfMs;
  });

  const forecasts = getPriceDropForecasts(snapshots, history, {
    asOf,
    minProbability: opts.minProbability ?? 0.35,
    maxForecasts: opts.maxForecasts ?? 50,
  });

  const trials = forecasts.map((f) => resolveTrial(f, asOfMs, allEvents, dataEndMs));
  const resolved = trials.filter((t) => t.hit !== null);
  const hits = resolved.filter((t) => t.hit === true).length;

  const precision = resolved.length > 0 ? round4(hits / resolved.length) : null;
  const brier_score =
    resolved.length > 0
      ? round4(
          resolved.reduce((s, t) => s + (t.probability - (t.hit === true ? 1 : 0)) ** 2, 0) /
            resolved.length
        )
      : null;
  const mean_predicted =
    resolved.length > 0
      ? round4(resolved.reduce((s, t) => s + t.probability, 0) / resolved.length)
      : null;

  const calibration: CalibrationBucket[] = [];
  for (let i = 0; i < BUCKET_EDGES.length - 1; i += 1) {
    const lo = BUCKET_EDGES[i];
    const hi = BUCKET_EDGES[i + 1];
    const inBucket = resolved.filter((t) => t.probability >= lo && t.probability < hi);
    calibration.push({
      range: `${lo.toFixed(2)}–${hi >= 1 ? '1.00' : hi.toFixed(2)}`,
      n: inBucket.length,
      mean_predicted: inBucket.length > 0
        ? round4(inBucket.reduce((s, t) => s + t.probability, 0) / inBucket.length)
        : 0,
      observed_rate: inBucket.length > 0
        ? round4(inBucket.filter((t) => t.hit === true).length / inBucket.length)
        : null,
    });
  }

  return {
    as_of: asOf.toISOString(),
    trials,
    resolved: resolved.length,
    hits,
    unresolved: trials.length - resolved.length,
    precision,
    brier_score,
    mean_predicted,
    calibration,
  };
}

export interface BacktestSuiteResult {
  generated_at: string;
  data_end: string | null;
  cutoffs: BacktestReport[];
  aggregate: {
    resolved: number;
    hits: number;
    unresolved: number;
    precision: number | null;
    brier_score: number | null;
  };
}

export function runBacktest(
  snapshots: ModelSnapshot[],
  allEvents: ModelEvent[],
  cutoffs: Date[],
  opts: { minProbability?: number; maxForecasts?: number } = {}
): BacktestSuiteResult {
  const reports = cutoffs.map((c) => backtestCutoff(snapshots, allEvents, c, opts));
  const resolvedTrials = reports.flatMap((r) => r.trials.filter((t) => t.hit !== null));
  const hits = resolvedTrials.filter((t) => t.hit === true).length;
  const unresolved = reports.reduce((s, r) => s + r.unresolved, 0);
  const times = allEvents
    .map((e) => new Date(e.detected_at).getTime())
    .filter((t) => Number.isFinite(t));
  return {
    generated_at: new Date().toISOString(),
    data_end: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
    cutoffs: reports,
    aggregate: {
      resolved: resolvedTrials.length,
      hits,
      unresolved,
      precision: resolvedTrials.length > 0 ? round4(hits / resolvedTrials.length) : null,
      brier_score: resolvedTrials.length > 0
        ? round4(
            resolvedTrials.reduce((s, t) => s + (t.probability - (t.hit === true ? 1 : 0)) ** 2, 0) /
              resolvedTrials.length
          )
        : null,
    },
  };
}
