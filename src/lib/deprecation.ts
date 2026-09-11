import { ModelEvent } from '@/types/events';

/**
 * S1 — Deprecation-notice track record.
 *
 * Phase 1: DEPRECATION_ANNOUNCED ingestion (changelog/RSS monitoring writes
 * real, sourced announcement events — no inferred dates from forums).
 * Phase 2: per-provider median/range days between announcement and removal,
 * computed ONLY from pairs with both dates known. Historical removals
 * predating this ingestion start empty — never backfilled with guesses.
 * Sample size always shown next to any figure.
 */

export const DEPRECATION_MATURITY_MIN_PAIRS = 10;

export interface DeprecationPair {
  model_id: string;
  provider: string;
  announced_at: string;
  removed_at: string;
  days_notice: number;
  announcement_source: string;
}

export interface ProviderDeprecationStats {
  provider: string;
  sample_size: number;
  median_days: number;
  min_days: number;
  max_days: number;
  pairs: DeprecationPair[];
}

function providerOf(e: ModelEvent): string {
  return e.provider || e.model_id.split('/')[0] || 'unknown';
}

/** Pair announcements with later removals for the same model. No guessing. */
export function pairDeprecationEvents(events: ModelEvent[]): DeprecationPair[] {
  const byModel = new Map<string, ModelEvent[]>();
  for (const e of events) {
    if (e.event_type !== 'DEPRECATION_ANNOUNCED' && e.event_type !== 'MODEL_REMOVED') continue;
    const list = byModel.get(e.model_id) || [];
    list.push(e);
    byModel.set(e.model_id, list);
  }
  const pairs: DeprecationPair[] = [];
  for (const [modelId, list] of byModel) {
    const announcements = list
      .filter((e) => e.event_type === 'DEPRECATION_ANNOUNCED')
      .sort((a, b) => +new Date(a.detected_at) - +new Date(b.detected_at));
    const removals = list
      .filter((e) => e.event_type === 'MODEL_REMOVED')
      .sort((a, b) => +new Date(a.detected_at) - +new Date(b.detected_at));
    if (announcements.length === 0 || removals.length === 0) continue;
    // Earliest announcement paired with earliest later removal.
    for (const ann of announcements) {
      const annT = +new Date(ann.detected_at);
      if (!Number.isFinite(annT)) continue;
      const removal = removals.find((r) => +new Date(r.detected_at) >= annT);
      if (!removal) continue;
      const remT = +new Date(removal.detected_at);
      const days = Math.round((remT - annT) / (24 * 3600 * 1000));
      if (days < 0) continue;
      pairs.push({
        model_id: modelId,
        provider: providerOf(ann),
        announced_at: ann.detected_at,
        removed_at: removal.detected_at,
        days_notice: days,
        announcement_source:
          (ann.new_value as any)?.source_url || (ann.new_value as any)?.url || ann.source,
      });
      break; // one pair per model
    }
  }
  return pairs;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function computeDeprecationStats(events: ModelEvent[]): {
  providers: ProviderDeprecationStats[];
  total_pairs: number;
  mature: boolean;
} {
  const pairs = pairDeprecationEvents(events);
  const byProvider = new Map<string, DeprecationPair[]>();
  for (const p of pairs) {
    const list = byProvider.get(p.provider) || [];
    list.push(p);
    byProvider.set(p.provider, list);
  }
  const providers: ProviderDeprecationStats[] = [...byProvider.entries()].map(([provider, ps]) => {
    const days = ps.map((p) => p.days_notice);
    return {
      provider,
      sample_size: ps.length,
      median_days: median(days),
      min_days: Math.min(...days),
      max_days: Math.max(...days),
      pairs: ps,
    };
  });
  return {
    providers,
    total_pairs: pairs.length,
    mature: pairs.length >= DEPRECATION_MATURITY_MIN_PAIRS,
  };
}

/**
 * Phase-1 ingestion helper: build a sourced DEPRECATION_ANNOUNCED event from
 * a provider changelog/RSS item. Only real announcements count — callers must
 * pass the actual announcement URL; no inferred dates.
 */
export function buildDeprecationAnnouncementEvent(opts: {
  model_id: string;
  announced_at: string;
  source_url: string;
  source?: string;
}): ModelEvent {
  return {
    model_id: opts.model_id,
    event_type: 'DEPRECATION_ANNOUNCED',
    old_value: null,
    new_value: { source_url: opts.source_url, announced_at: opts.announced_at },
    pct_change: null,
    source: opts.source || 'provider-changelog',
    detected_at: opts.announced_at,
  };
}
