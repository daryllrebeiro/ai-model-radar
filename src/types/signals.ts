export type MarketSignalType =
  | 'PRICE_ANOMALY'
  | 'STEALTH_ENDPOINT'
  | 'RAPID_PRICE_WAR'
  | 'CONTEXT_BREAKTHROUGH'
  | 'FREE_GRADIENT'
  | 'CONTEXT_EXPANSION'
  | 'SECTOR_PRICE_WAR'
  | 'MODEL_EOL';

export interface MarketSignal {
  id: string;
  signal_type: MarketSignalType;
  model_id: string;
  provider: string;
  title: string;
  summary: string;
  evidence: {
    metric: string;
    current_value: string;
    baseline_value: string;
    deviation: string;
  };
  detected_at: string;
  severity: 'high' | 'medium' | 'info';
  // Enhanced Market Signals (Pro): confidence scoring on 0..100
  strength?: number;
  strength_factors?: string[];
}
