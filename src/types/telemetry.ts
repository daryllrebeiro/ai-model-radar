export interface EndpointTelemetry {
  id?: number;
  model_id: string;
  provider: string;
  endpoint_url?: string | null;
  checked_at: string;
  online: boolean;
  http_status: number | null;
  p95_latency_ms: number | null;
  avg_latency_ms: number | null;
  tokens_per_sec: number | null;
  rate_limited: boolean;
  rate_limited_count: number;
  retry_after_sec: number | null;
  sample_count: number;
  is_free: boolean;
  free_tier_active: boolean | null;
  error?: string | null;
}

export type EndpointHealthStatus = 'healthy' | 'degraded' | 'down';

export interface EndpointHealthReport {
  status: EndpointHealthStatus;
  reasons: string[];
}

export interface EndpointProbeTarget {
  model_id: string;
  provider: string;
  url: string;
  is_free: boolean;
}