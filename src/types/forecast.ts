export interface PriceDropForecast {
  id: string;
  model_id: string;
  provider: string;
  model_name: string;
  family: string;
  /** Estimated likelihood (0..1) of a price cut landing within the expected window. */
  probability: number;
  confidence: 'high' | 'medium' | 'low';
  /** Typical historical cut magnitude for the line/provider (% as positive integer), when known. */
  expected_pct_change: number | null;
  /** Days until the cut is expected to land. 7 means "any day now". */
  expected_window_days: number;
  /** Estimated model age in days (based on release / first-seen event when unknown). */
  model_age_days: number | null;
  /** Days since the most recent observed price cut (null if never cut). */
  days_since_last_cut: number | null;
  /** Median cut cadence in days for the line/provider/market, when enough data exists. */
  cadence_days: number | null;
  /** Number of historical gap observations supporting the cadence estimate. */
  cadence_samples: number;
  /** Human-readable evidence items backing the forecast. */
  factors: string[];
  generated_at: string;
}

export interface ForecastOptions {
  /** Point in time to forecast from (defaults to now). Injected for deterministic tests. */
  asOf?: Date;
  /** Only emit forecasts at or above this probability (default 0.35). */
  minProbability?: number;
  /** Cap on emitted forecasts, highest probability first (default 15). */
  maxForecasts?: number;
}