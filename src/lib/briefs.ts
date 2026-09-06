import { ModelSnapshot } from '@/types/models';
import { ModelEvent } from '@/types/events';
import { MarketSignal } from '@/types/signals';
import { PriceDropForecast } from '@/types/forecast';
import { EndpointTelemetry } from '@/types/telemetry';
import { MarketBrief, MarketBriefModel, RadarCitation } from '@/types/ask';

/**
 * Market briefs (free tier): a scheduled per-watchlist history + diff summary.
 * Every model card cites the changelog/forecast/signal records that back its
 * numbers, so briefs are traceable to the same radar data the UI shows.
 */

export interface BriefSource {
  snapshots: ModelSnapshot[];
  events: ModelEvent[];
  signals: MarketSignal[];
  forecasts: PriceDropForecast[];
  telemetry?: EndpointTelemetry[];
}

function per1m(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? Math.round(n * 1_000_000) : null;
}

function eventInWindow(e: ModelEvent, windowDays: number, nowMs: number): boolean {
  const days = (nowMs - new Date(e.detected_at).getTime()) / 86_400_000;
  return days >= -1 && days <= windowDays + 1;
}

function citationsFor(
  modelId: string,
  snap: ModelSnapshot | undefined,
  events: ModelEvent[],
  signals: MarketSignal[],
  forecasts: PriceDropForecast[]
): RadarCitation[] {
  const cited: RadarCitation[] = [];
  const modelEvents = events.filter((e) => e.model_id === modelId);
  for (const e of modelEvents.slice(-3)) {
    cited.push({
      id: `event:${e.id || `${modelId}:${e.event_type}`}`,
      type: 'event',
      title: `${e.event_type} (${e.pct_change ?? 0}%) on ${new Date(e.detected_at).toLocaleDateString()}`,
      model_id: modelId,
      url: `/changelog?model=${encodeURIComponent(modelId)}`,
    });
  }
  for (const s of signals) {
    if (s.model_id !== modelId) continue;
    cited.push({
      id: `signal:${s.id}`,
      type: 'signal',
      title: s.title,
      model_id: modelId,
      url: '/signals',
    });
  }
  const forecast = forecasts.find((f) => f.model_id === modelId);
  if (forecast) {
    cited.push({
      id: `forecast:${modelId}`,
      type: 'forecast',
      title: `${Math.round(forecast.probability * 100)}% cut within ${forecast.expected_window_days}d`,
      model_id: modelId,
      url: `/forecast?model=${encodeURIComponent(modelId)}`,
    });
  }
  if (snap) {
    cited.push({
      id: `model:${modelId}`,
      type: 'model',
      title: `${snap.name} latest snapshot`,
      model_id: modelId,
      url: `/models/${encodeURIComponent(modelId)}`,
    });
  }
  return cited;
}

export function buildMarketBrief(opts: {
  watchlist?: string[];
  windowDays?: number;
  source: BriefSource;
  /** Fixed point-in-time for deterministic tests. Defaults to now. */
  asOf?: string | number | Date;
}): MarketBrief {
  const { watchlist, windowDays = 7, source, asOf } = opts;
  const { snapshots, events, signals, forecasts } = source;
  const nowMs = asOf ? new Date(asOf).getTime() : Date.now();

  const scope = watchlist && watchlist.length > 0 ? 'watchlist' : 'all';
  const ids =
    scope === 'watchlist'
      ? [...new Set(watchlist!.map((id) => id.toLowerCase()))]
      : snapshots.slice(0, 10).map((s) => s.model_id.toLowerCase());

  const models: MarketBriefModel[] = [];
  for (const id of ids) {
    const snap = snapshots.find((s) => s.model_id.toLowerCase() === id);
    const modelEvents = events
      .filter((e) => e.model_id.toLowerCase() === id && eventInWindow(e, windowDays, nowMs))
      .sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime());

    const priceEvent = modelEvents.find((e) => e.event_type === 'PRICE_CHANGE');
    const becameFree = modelEvents.some((e) => e.event_type === 'BECAME_FREE');
    const eol = signals.some((s) => s.model_id.toLowerCase() === id && s.signal_type === 'MODEL_EOL');
    const forecast = forecasts.find((f) => f.model_id.toLowerCase() === id);

    const oldPrompt = priceEvent?.old_value && 'price_prompt' in priceEvent.old_value
      ? per1m(priceEvent.old_value.price_prompt as number | string | null)
      : null;
    const newPrompt = priceEvent?.new_value && 'price_prompt' in priceEvent.new_value
      ? per1m(priceEvent.new_value.price_prompt as number | string | null)
      : per1m(snap?.price_prompt);

    models.push({
      model_id: snap?.model_id || id,
      name: snap?.name || id,
      provider: snap?.provider || priceEvent?.provider || 'Unknown',
      window_pct_change: priceEvent?.pct_change ?? null,
      old_prompt_1m: oldPrompt,
      new_prompt_1m: newPrompt,
      became_free: becameFree,
      eol,
      forecast_probability: forecast ? forecast.probability : null,
      cited_events: priceEvent ? 1 : 0,
    });
  }

  models.sort((a, b) => {
    const av = a.forecast_probability ?? 0;
    const bv = b.forecast_probability ?? 0;
    if (Math.abs(a.window_pct_change ?? 0) > 0 || Math.abs(b.window_pct_change ?? 0) > 0) {
      const ah = a.window_pct_change ?? 0;
      const bh = b.window_pct_change ?? 0;
      if (ah !== bh) return ah - bh;
    }
    return bv - av;
  });

  const changed = models.filter((m) => m.window_pct_change !== null || m.became_free || m.eol);
  const bigDrop = changed.find((m) => (m.window_pct_change || 0) < 0);
  const headline = bigDrop
    ? `${bigDrop.name} dropped ${Math.abs(bigDrop.window_pct_change as number)}% in the last ${windowDays}d`
    : changed.length > 0
      ? `${changed.length} tracked model${changed.length === 1 ? '' : 's'} changed in the last ${windowDays}d`
      : `No tracked models changed in the last ${windowDays}d`;

  const citations: RadarCitation[] = [];
  for (const m of models.slice(0, 8)) {
    citations.push(
      ...citationsFor(m.model_id, snapshots.find((s) => s.model_id === m.model_id), events, signals, forecasts)
    );
  }

  return {
    generated_at: new Date(nowMs).toISOString(),
    scope,
    window_days: windowDays,
    watchlist: ids,
    headline,
    models,
    citations,
  };
}

export function buildWatchlistBriefs(
  targets: { email: string; model_ids: string[] }[],
  opts: { windowDays?: number; source: BriefSource; asOf?: string | number | Date }
): { email: string; brief: MarketBrief }[] {
  return targets.map((t) => ({
    email: t.email,
    brief: buildMarketBrief({ watchlist: t.model_ids, windowDays: opts.windowDays, source: opts.source, asOf: opts.asOf }),
  }));
}