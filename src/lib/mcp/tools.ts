import { computeArbitrageOpportunities } from '../arbitrage';
import {
  getEvents,
  getLatestSnapshotsMap,
  getMarketStats,
  getModelCurrentList,
  getModelDetail,
} from '../db/queries';
import { detectMarketSignals } from '../signals';
import type { EventFilterParams } from '@/types/events';
import type { MarketSignal } from '@/types/signals';

export interface McpToolResult {
  data: unknown;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

export interface ListModelsOptions {
  provider?: string;
  isFree?: boolean;
  search?: string;
  limit?: number;
}

export async function mcpListModels(opts: ListModelsOptions = {}): Promise<McpToolResult> {
  const { provider, isFree, search, limit } = opts;
  const list = await getModelCurrentList({
    provider,
    isFree,
    search,
    sortBy: 'updated',
    sortOrder: 'desc',
    limit: clampLimit(limit, 50, 500),
  });
  return {
    data: {
      total: list.total,
      models: list.models.map((m) => ({
        model_id: m.model_id,
        name: m.name,
        provider: m.provider,
        price_prompt_per_1m: m.price_prompt === null ? null : m.price_prompt * 1_000_000,
        price_completion_per_1m: m.price_completion === null ? null : m.price_completion * 1_000_000,
        context_length: m.context_length,
        is_free: m.is_free,
        modality: m.modality,
        last_polled_at: m.polled_at,
      })),
    },
  };
}

export async function mcpGetModel(modelId: string, historyLimit?: number): Promise<McpToolResult> {
  const detail = await getModelDetail(modelId);
  if (!detail || !detail.current) {
    return { data: { found: false, model_id: modelId } };
  }
  const snapshots = detail.snapshots.slice(-clampLimit(historyLimit, 50, 500));
  return {
    data: {
      found: true,
      model_id: modelId,
      current: {
        name: detail.current.name,
        provider: detail.current.provider,
        price_prompt_per_1m: detail.current.price_prompt === null ? null : detail.current.price_prompt * 1_000_000,
        price_completion_per_1m: detail.current.price_completion === null ? null : detail.current.price_completion * 1_000_000,
        context_length: detail.current.context_length,
        is_free: detail.current.is_free,
        modality: detail.current.modality,
        last_polled_at: detail.current.polled_at,
      },
      snapshot_count: snapshots.length,
      recent_events: detail.events.slice(0, 50),
    },
  };
}

export async function mcpPriceHistory(modelId: string, limit?: number): Promise<McpToolResult> {
  const detail = await getModelDetail(modelId);
  if (!detail) {
    return { data: { found: false, model_id: modelId } };
  }
  const points = detail.snapshots.slice(-clampLimit(limit, 100, 1000));
  return {
    data: {
      model_id: modelId,
      name: detail.current?.name ?? modelId,
      points: points.map((s) => ({
        polled_at: s.polled_at,
        price_prompt_per_1m: s.price_prompt === null ? null : s.price_prompt * 1_000_000,
        price_completion_per_1m: s.price_completion === null ? null : s.price_completion * 1_000_000,
        context_length: s.context_length,
        is_free: s.is_free,
      })),
    },
  };
}

export interface RecentEventsOptions {
  eventTypes?: string[];
  provider?: string;
  search?: string;
  limit?: number;
}

export async function mcpRecentEvents(opts: RecentEventsOptions = {}): Promise<McpToolResult> {
  const { eventTypes, provider, search, limit } = opts;
  const res = await getEvents({
    eventTypes: eventTypes as EventFilterParams['eventTypes'],
    provider,
    search,
    limit: clampLimit(limit, 50, 500),
  });
  return { data: { total: res.total, hasMore: res.hasMore, events: res.events } };
}

export async function mcpSignals(limit?: number, severity?: 'high' | 'medium' | 'info'): Promise<McpToolResult> {
  const [snapshotsMap, eventsRes] = await Promise.all([
    getLatestSnapshotsMap(),
    getEvents({ limit: 500 }),
  ]);

  const snapshots = Array.from(snapshotsMap.values());
  const allSignals = detectMarketSignals(snapshots, eventsRes.events);
  const filtered = severity
    ? allSignals.filter((s) => s.severity === severity)
    : allSignals;
  const sorted = [...filtered].sort((a, b) => (b.strength || 0) - (a.strength || 0));

  return {
    data: {
      generated_at: new Date().toISOString(),
      summary: {
        total: allSignals.length,
        high: allSignals.filter((s) => s.severity === 'high').length,
        medium: allSignals.filter((s) => s.severity === 'medium').length,
        info: allSignals.filter((s) => s.severity === 'info').length,
        eol: allSignals.filter((s) => s.signal_type === 'MODEL_EOL').length,
      },
      signals: sorted.slice(0, clampLimit(limit, 20, 100)),
    },
  };
}

export async function mcpEolModels(limit?: number): Promise<McpToolResult> {
  const result = await mcpSignals(undefined);
  const signals = result.data as { signals: MarketSignal[] };
  return {
    data: {
      generated_at: new Date().toISOString(),
      eol_models: signals.signals.filter((s) => s.signal_type === 'MODEL_EOL').slice(0, clampLimit(limit, 50, 100)),
    },
  };
}

export async function mcpArbitrage(limit?: number): Promise<McpToolResult> {
  const snapshotsMap = await getLatestSnapshotsMap();
  const clusters = computeArbitrageOpportunities(Array.from(snapshotsMap.values()));
  return {
    data: {
      generated_at: new Date().toISOString(),
      cluster_count: clusters.length,
      clusters: clusters.slice(0, clampLimit(limit, 25, 200)),
    },
  };
}

export async function mcpMarketStats(): Promise<McpToolResult> {
  return { data: await getMarketStats() };
}