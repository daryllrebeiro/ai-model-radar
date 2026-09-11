export type EventType =
  | 'NEW_MODEL'
  | 'MODEL_REMOVED'
  | 'DEPRECATION_ANNOUNCED'
  | 'PRICE_CHANGE'
  | 'BECAME_FREE'
  | 'LEFT_FREE'
  | 'CONTEXT_CHANGED';

export interface ModelEvent {
  id?: number;
  model_id: string;
  event_type: EventType;
  old_value: Record<string, any> | null;
  new_value: Record<string, any> | null;
  pct_change: number | null;
  source: string;
  detected_at: string;
  // Optional human-readable field deltas attached by the diff engine / tests
  diff_summary?: Record<string, any> | null;
  // Joined fields for rich UI display
  model_name?: string;
  provider?: string;
  context_length?: number | null;
  modality?: string;
}

/**
 * P1-5 — `new_value` schema registry. Two JSONB conventions exist
 * (diff-engine blobs + S1 `{source_url, announced_at}`); every event type
 * documents its shape here, and `insertEvents` enforces the registry so a
 * third type can't invent a third undocumented shape.
 */
export const EVENT_NEW_VALUE_SCHEMAS: Record<EventType, string> = {
  NEW_MODEL: 'snapshot summary {name, provider, price_prompt, price_completion}',
  MODEL_REMOVED: 'null (removal carries no new value)',
  DEPRECATION_ANNOUNCED: '{source_url: https-url, announced_at: ISO timestamp} — real changelog URL required',
  PRICE_CHANGE: '{prompt, completion} price pair (old_value) and (new_value)',
  BECAME_FREE: 'null or {price_prompt: 0, price_completion: 0}',
  LEFT_FREE: 'price pair like PRICE_CHANGE',
  CONTEXT_CHANGED: '{context_length} old/new pair',
};

/** Full https URL required for sourced announcement events. */
export function isValidAnnouncementNewValue(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, any>;
  return (
    typeof o.source_url === 'string' &&
    o.source_url.startsWith('https://') &&
    typeof o.announced_at === 'string' &&
    Number.isFinite(Date.parse(o.announced_at))
  );
}

export interface EventFilterParams {
  eventTypes?: EventType[];
  provider?: string;
  isFree?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  startDate?: string;
  endDate?: string;
}

export interface MarketStats {
  totalActiveModels: number;
  totalProviders: number;
  totalFreeModels: number;
  priceDrops24h: number;
  priceDrops7d: number;
  newModels7d: number;
  lastPolledAt: string | null;
}

export interface PriceDropDeal {
  model_id: string;
  model_name: string;
  provider: string;
  old_prompt: number;
  new_prompt: number;
  old_completion: number;
  new_completion: number;
  pct_change: number;
  detected_at: string;
  context_length: number | null;
}
