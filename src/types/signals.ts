export type MarketSignalType =
  | 'PRICE_ANOMALY'
  | 'STEALTH_ENDPOINT'
  | 'RAPID_PRICE_WAR'
  | 'CONTEXT_BREAKTHROUGH';

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
}
