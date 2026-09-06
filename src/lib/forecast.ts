import { ModelSnapshot } from '@/types/models';
import { ModelEvent } from '@/types/events';
import { PriceDropForecast, ForecastOptions } from '@/types/forecast';

const DAY_MS = 24 * 60 * 60 * 1000;

const SUFFIX_TOKENS = [
  ':free',
  ':online',
  ':thinking',
  '-free',
  '-latest',
  '-beta',
  '-preview',
  '-thinking',
  '-reasoning',
  '-online',
  '-snapshot',
  // Size/variant markers so siblings share a cadence line.
  // e.g. acme/cloud-3-opus, -haiku, -flash → acme/cloud-3
  '-sonnet',
  '-haiku',
  '-opus',
  '-mini',
  '-nano',
  '-max',
  '-flash',
  '-turbo',
  '-pro',
  '-ultra',
  '-large',
  '-small',
  '-fast',
  '-lite',
  '-slim',
];

/**
 * Collapses version/image/date/size variants of a model into a line family so
 * that cadence statistics aggregate across siblings (e.g. gpt-4o-2025-04-09
 * and openai/gpt-4o-mini both collapse to openai/gpt-4o).
 */
export function toFamily(modelId: string): string {
  let family = modelId.toLowerCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SUFFIX_TOKENS) {
      if (family.endsWith(suffix)) {
        family = family.slice(0, family.length - suffix.length);
        changed = true;
      }
    }
    if (/-\d{4}-\d{2}-\d{2}$/.test(family)) {
      family = family.replace(/-\d{4}-\d{2}-\d{2}$/, '');
      changed = true;
    } else if (/-(v\d+(\.\d+)?)$/.test(family)) {
      family = family.replace(/-(v\d+(\.\d+)?)$/, '');
      changed = true;
    }
  }
  return family;
}

interface CutObservation {
  at: number;
  pct: number;
}

interface CadencePool {
  gaps: number[];
  pcts: number[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function extractProvider(modelId: string): string {
  const parts = modelId.split('/');
  return parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : 'Unknown';
}

function probabilityFromRatio(ratio: number): number {
  if (ratio >= 2.5) return 0.93;
  if (ratio >= 1.5) return 0.75;
  if (ratio >= 0.8) return 0.55;
  return clamp(0.15 + 0.3 * ratio, 0.08, 0.55);
}

function confidenceFromSamples(samples: number): PriceDropForecast['confidence'] {
  if (samples >= 4) return 'high';
  if (samples >= 2) return 'medium';
  return 'low';
}

/**
 * Statistical price-drop forecasting built on the append-only event archive.
 *
 * For every listed, paid model we estimate the line/provider/market median
 * "cadence" of price cuts (release→first-cut and cut→cut gaps) and compare how
 * overdue the model is relative to that cadence. Overdue models get a higher
 * probability that a cut lands in the expected window.
 */
export function computePriceDropForecasts(
  snapshots: ModelSnapshot[],
  events: ModelEvent[],
  opts: ForecastOptions = {}
): PriceDropForecast[] {
  const now = opts.asOf ? opts.asOf.getTime() : Date.now();

  const releaseAt = new Map<string, number>();
  const firstSeenAt = new Map<string, number>();
  const cutsByModel = new Map<string, CutObservation[]>();

  for (const e of events) {
    const at = new Date(e.detected_at).getTime();
    if (!Number.isFinite(at)) continue;

    const prevSeen = firstSeenAt.get(e.model_id);
    if (prevSeen === undefined || at < prevSeen) firstSeenAt.set(e.model_id, at);

    if (e.event_type === 'NEW_MODEL') {
      const prevRelease = releaseAt.get(e.model_id);
      if (prevRelease === undefined || at > prevRelease) releaseAt.set(e.model_id, at);
    } else if (e.event_type === 'PRICE_CHANGE' && e.pct_change !== null && e.pct_change < 0) {
      const cuts = cutsByModel.get(e.model_id) || [];
      cuts.push({ at, pct: Math.abs(e.pct_change) });
      cutsByModel.set(e.model_id, cuts);
    }
  }

  // Line, provider, and market-wide cadence pools.
  const familyPools = new Map<string, CadencePool>();
  const providerPools = new Map<string, CadencePool>();
  const marketPool: CadencePool = { gaps: [], pcts: [] };

  const pushObservation = (
    pool: CadencePool,
    gapDays: number,
    pct: number | null
  ): void => {
    if (Number.isFinite(gapDays) && gapDays > 0) pool.gaps.push(gapDays);
    if (pct !== null) pool.pcts.push(pct);
  };

  const poolFor = (key: string, pools: Map<string, CadencePool>): CadencePool => {
    let pool = pools.get(key);
    if (!pool) {
      pool = { gaps: [], pcts: [] };
      pools.set(key, pool);
    }
    return pool;
  };

  for (const [modelId, cuts] of cutsByModel.entries()) {
    const provider = extractProvider(modelId);
    const providerKey = provider.toLowerCase();
    const family = toFamily(modelId);
    const release = releaseAt.get(modelId);
    const familyPool = poolFor(family, familyPools);
    const providerPool = poolFor(providerKey, providerPools);

    const sorted = [...cuts].sort((a, b) => a.at - b.at);
    for (let i = 0; i < sorted.length; i += 1) {
      if (release !== undefined && i === 0) {
        const toFirst = (sorted[i].at - release) / DAY_MS;
        if (toFirst > 0) {
          pushObservation(familyPool, toFirst, sorted[i].pct);
          pushObservation(providerPool, toFirst, sorted[i].pct);
          pushObservation(marketPool, toFirst, sorted[i].pct);
        }
      }
      if (i > 0) {
        const gap = (sorted[i].at - sorted[i - 1].at) / DAY_MS;
        if (gap > 0) {
          pushObservation(familyPool, gap, sorted[i].pct);
          pushObservation(providerPool, gap, sorted[i].pct);
          pushObservation(marketPool, gap, sorted[i].pct);
        }
      }
    }
  }

  const resolvePool = (modelId: string, provider: string) => {
    const familyPool = familyPools.get(toFamily(modelId));
    if (familyPool && familyPool.gaps.length > 0) return { level: 'line', pool: familyPool } as const;
    const providerPool = providerPools.get(provider.toLowerCase());
    if (providerPool && providerPool.gaps.length > 0) return { level: 'provider', pool: providerPool } as const;
    if (marketPool.gaps.length > 0) return { level: 'market', pool: marketPool } as const;
    return null;
  };

  const forecasts: PriceDropForecast[] = [];
  const nowIso = new Date(now).toISOString();

  for (const snap of snapshots) {
    if (snap.is_free) continue;

    const modelId = snap.model_id;
    const provider = snap.provider || extractProvider(modelId);
    const family = toFamily(modelId);

    const cuts = (cutsByModel.get(modelId) || []).sort((a, b) => a.at - b.at);
    const lastCut = cuts.length > 0 ? cuts[cuts.length - 1].at : null;
    const release = releaseAt.get(modelId);
    const firstSeen = firstSeenAt.get(modelId) ?? new Date(snap.polled_at).getTime();
    const anchorBase = release ?? firstSeen;
    const anchor = lastCut ?? anchorBase;

    const ageDays =
      release !== undefined ? Math.max(0, (now - release) / DAY_MS) : Math.max(0, (now - firstSeen) / DAY_MS);
    const daysSinceLastCut = lastCut !== null ? Math.max(0, (now - lastCut) / DAY_MS) : null;

    const resolved = resolvePool(modelId, provider);
    const cadenceDays = resolved ? median(resolved.pool.gaps) : null;
    const cadenceSamples = resolved ? resolved.pool.gaps.length : 0;
    const expectedPct = resolved ? median(resolved.pool.pcts) : null;

    let probability = 0.12;
    let windowDays = 60;
    const factors: string[] = [];

    if (daysSinceLastCut !== null) {
      factors.push(`Last price cut ${Math.floor(daysSinceLastCut)}d ago`);
    } else {
      factors.push(`Never observed a price cut (est. age ${Math.floor(ageDays)}d)`);
    }

    if (cadenceDays !== null) {
      const elapsed = (now - anchor) / DAY_MS;
      const ratio = elapsed / cadenceDays;
      probability = probabilityFromRatio(ratio);
      const remaining = cadenceDays - elapsed;
      windowDays = remaining >= 0 ? Math.max(1, Math.ceil(remaining)) : 7;
      const levelLabel = resolved!.level === 'line' ? 'line' : resolved!.level === 'provider' ? 'provider-wide' : 'market-wide';
      factors.push(
        `${levelLabel} median cut cadence ${Math.round(cadenceDays)}d (${cadenceSamples} observations, est. ${round1(ratio)}x due)`
      );
      if (ratio >= 1.5) factors.push(`Cut is overdue by ${Math.floor(elapsed - cadenceDays)}d`);
    } else {
      factors.push('No price-cut history yet in archive — forecast uses market prior');
    }

    if (expectedPct !== null) {
      factors.push(`Typical cut magnitude ≈ ${Math.round(expectedPct)}%`);
    }

    if (windowDays <= 7) factors.push('Window: any day now');
    if (release === undefined) factors.push('Release date estimated from first-seen event');

    forecasts.push({
      id: `forecast-${modelId.replace(/[^a-zA-Z0-9-]/g, '-')}`,
      model_id: modelId,
      provider,
      model_name: snap.name,
      family,
      probability: round2(clamp(probability, 0, 1)),
      confidence: confidenceFromSamples(cadenceSamples),
      expected_pct_change: expectedPct !== null ? Math.round(expectedPct) : null,
      expected_window_days: windowDays,
      model_age_days: Number.isFinite(ageDays) ? Math.floor(ageDays) : null,
      days_since_last_cut: daysSinceLastCut !== null ? Math.floor(daysSinceLastCut) : null,
      cadence_days: cadenceDays !== null ? Math.round(cadenceDays) : null,
      cadence_samples: cadenceSamples,
      factors,
      generated_at: nowIso,
    });
  }

  return forecasts;
}

/**
 * Convenience entry point: full forecast run, filtered to a minimum
 * probability, sorted strongest first, capped at `maxForecasts`.
 */
export function getPriceDropForecasts(
  snapshots: ModelSnapshot[],
  events: ModelEvent[],
  opts: ForecastOptions = {}
): PriceDropForecast[] {
  const { asOf = new Date(), minProbability = 0.35, maxForecasts = 15 } = opts;
  return computePriceDropForecasts(snapshots, events, { asOf, minProbability: 0 })
    .filter((f) => f.probability >= minProbability)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, maxForecasts);
}