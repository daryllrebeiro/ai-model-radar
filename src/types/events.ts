export type EventType =
  | 'NEW_MODEL'
  | 'MODEL_REMOVED'
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
  // Joined fields for rich UI display
  model_name?: string;
  provider?: string;
  context_length?: number | null;
  modality?: string;
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
