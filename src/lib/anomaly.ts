/**
 * P3 anomaly alerts: evidence-based spend/EOL-risk shapes over the existing
 * event stream. No confidence percentages, no predictions — every anomaly
 * cites the events that triggered it. Pure functions, fully unit-testable.
 */
import { ModelEvent } from '@/types/events';

export type AnomalyKind = 'price_churn' | 'deep_cut' | 'free_flurry';

export interface SpendAnomaly {
  kind: AnomalyKind;
  model_id: string | null;
  provider: string | null;
  window_hours: number;
  event_count: number;
  max_drop_pct: number | null;
  event_ids: number[];
  detail: string;
}

export interface AnomalyOptions {
  churnCount?: number;
  churnHours?: number;
  deepCutPct?: number;
  freeFlurryCount?: number;
  freeFlurryHours?: number;
  nowMs?: number;
}

const DEFAULTS = {
  churnCount: 3,
  churnHours: 24,
  deepCutPct: 50,
  freeFlurryCount: 2,
  freeFlurryHours: 24,
};

/** Detects churn / deep-cut / free-flurry anomalies in an event batch. */
export function detectSpendAnomalies(
  events: ModelEvent[],
  opts: AnomalyOptions = {}
): SpendAnomaly[] {
  const o = { ...DEFAULTS, ...opts };
  const now = opts.nowMs ?? Date.now();
  const out: SpendAnomaly[] = [];

  const byModel = new Map<string, ModelEvent[]>();
  for (const e of events) {
    const list = byModel.get(e.model_id) || [];
    list.push(e);
    byModel.set(e.model_id, list);
  }

  for (const [modelId, list] of byModel) {
    const recent = list.filter(
      (e) => now - new Date(e.detected_at).getTime() <= o.churnHours * 3600_000
    );
    const drops = recent.filter(
      (e) => e.event_type === 'PRICE_CHANGE' || e.event_type === 'BECAME_FREE'
    );
    // Deep cut: single drop at/over the threshold (BECAME_FREE counts as 100).
    for (const e of drops) {
      const drop = e.event_type === 'BECAME_FREE'
        ? 100
        : e.pct_change !== null && e.pct_change !== undefined ? Math.abs(e.pct_change) : 0;
      if (drop >= o.deepCutPct) {
        out.push({
          kind: 'deep_cut',
          model_id: modelId,
          provider: e.provider || null,
          window_hours: o.churnHours,
          event_count: 1,
          max_drop_pct: drop,
          event_ids: e.id !== undefined ? [Number(e.id)] : [],
          detail: `${modelId} dropped ${drop}% (event ${e.event_type})`,
        });
        break;
      }
    }
    // Churn: repeated repricing inside the window.
    if (drops.length >= o.churnCount) {
      const maxDrop = Math.max(
        ...drops.map((e) =>
          e.event_type === 'BECAME_FREE' ? 100
          : e.pct_change !== null && e.pct_change !== undefined ? Math.abs(e.pct_change) : 0
        )
      );
      out.push({
        kind: 'price_churn',
        model_id: modelId,
        provider: drops[0]?.provider || null,
        window_hours: o.churnHours,
        event_count: drops.length,
        max_drop_pct: maxDrop,
        event_ids: drops.map((e) => Number(e.id)).filter((n) => Number.isFinite(n)),
        detail: `${modelId} repriced ${drops.length}× in ${o.churnHours}h`,
      });
    }
  }

  // Free flurry: provider pushing multiple models to free inside the window.
  const byProvider = new Map<string, ModelEvent[]>();
  for (const e of events) {
    if (e.event_type !== 'BECAME_FREE') continue;
    if (now - new Date(e.detected_at).getTime() > o.freeFlurryHours * 3600_000) continue;
    const list = byProvider.get(e.provider || 'unknown') || [];
    list.push(e);
    byProvider.set(e.provider || 'unknown', list);
  }
  for (const [provider, list] of byProvider) {
    if (list.length >= o.freeFlurryCount) {
      out.push({
        kind: 'free_flurry',
        model_id: null,
        provider,
        window_hours: o.freeFlurryHours,
        event_count: list.length,
        max_drop_pct: 100,
        event_ids: list.map((e) => Number(e.id)).filter((n) => Number.isFinite(n)),
        detail: `${provider} moved ${list.length} models to free in ${o.freeFlurryHours}h`,
      });
    }
  }

  return out;
}
