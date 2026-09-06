export type AskIntent =
  | 'model_status'
  | 'price_change'
  | 'forecast'
  | 'eol'
  | 'arbitrage'
  | 'recommendation'
  | 'telemetry'
  | 'overview';

export type RadarCitationType = 'model' | 'event' | 'signal' | 'forecast' | 'telemetry';

export interface RadarCitation {
  id: string;
  type: RadarCitationType;
  title: string;
  model_id?: string;
  url: string;
}

export interface AskAnswer {
  question: string;
  intent: AskIntent;
  answer: string;
  citations: RadarCitation[];
  /** Set when a recommendation intent needs the caller's usage profile. */
  profile_required?: boolean;
}

export interface MarketBriefModel {
  model_id: string;
  name: string;
  provider: string;
  window_pct_change: number | null;
  old_prompt_1m: number | null;
  new_prompt_1m: number | null;
  became_free: boolean;
  eol: boolean;
  forecast_probability: number | null;
  cited_events: number;
}

export interface MarketBrief {
  generated_at: string;
  scope: 'watchlist' | 'all';
  window_days: number;
  watchlist: string[];
  headline: string;
  models: MarketBriefModel[];
  citations: RadarCitation[];
}

export interface WatchlistBriefTarget {
  email: string;
  model_ids: string[];
}