import { ModelSnapshot } from '@/types/models';
import {
  EndpointProbeTarget,
  EndpointTelemetry,
  EndpointHealthReport,
} from '@/types/telemetry';
import { saveEndpointTelemetry, getRecentEndpointTelemetry } from './db/queries';

/**
 * Known public API base URLs per provider, used when a snapshot does not carry
 * an explicit endpoint URL. Providers without a public model-listing endpoint
 * are skipped by the probe worker.
 */
export const PROVIDER_API_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models',
  google: 'https://generativelanguage.googleapis.com/v1beta/models',
  deepseek: 'https://api.deepseek.com/models',
  mistral: 'https://api.mistral.ai/v1/models',
  xai: 'https://api.x.ai/v1/models',
  groq: 'https://api.groq.com/openai/v1/models',
  together: 'https://api.together.xyz/v1/models',
  fireworks: 'https://api.fireworks.ai/v1/models',
  moonshot: 'https://api.moonshot.cn/v1/models',
  cohere: 'https://api.cohere.com/v1/models',
  alibaba: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
};

/**
 * Resolves the probe endpoint for a model snapshot:
 * explicit endpoint URL from raw_json (BYO endpoints) wins, then the provider map.
 */
export function resolveEndpointUrl(snapshot: ModelSnapshot): string | null {
  const rawEndpoint = snapshot.raw_json?.endpoint?.url;
  if (typeof rawEndpoint === 'string' && rawEndpoint.length > 0) {
    return rawEndpoint;
  }
  return PROVIDER_API_URLS[snapshot.provider.toLowerCase()] || null;
}

/**
 * Converts snapshots into probe targets, skipping models without a resolvable URL.
 */
export function buildProbeTargets(snapshots: ModelSnapshot[]): EndpointProbeTarget[] {
  const targets: EndpointProbeTarget[] = [];
  for (const s of snapshots) {
    const url = resolveEndpointUrl(s);
    if (url) {
      targets.push({
        model_id: s.model_id,
        provider: s.provider,
        url,
        is_free: s.is_free,
      });
    }
  }
  return targets;
}

interface ProbeSample {
  status: number | null;
  latencyMs: number | null;
  retryAfterSec: number | null;
  bytes: number;
  timedOut: boolean;
  error?: string;
}

export interface ProbeRequestOptions {
  sampleCount?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  nowFn?: () => number;
}

/**
 * Probes a single endpoint once: small GET against the model-listing URL with a
 * timeout. Deterministic for unit tests via injectable fetchFn + nowFn.
 */
async function probeOnce(
  target: EndpointProbeTarget,
  opts: Required<Pick<ProbeRequestOptions, 'timeoutMs' | 'fetchFn' | 'nowFn'>>
): Promise<ProbeSample> {
  const start = opts.nowFn();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const response = await opts.fetchFn(target.url, {
      method: 'GET',
      headers: {
        'User-Agent': 'AI-Model-Radar/1.0 (endpoint-probe)',
        Accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store' as RequestCache,
    });
    const latencyMs = opts.nowFn() - start;

    let bytes = 0;
    try {
      bytes = (await response.text()).length;
    } catch {
      bytes = 0;
    }

    const retryAfter = response.headers.get('retry-after');
    return {
      status: response.status,
      latencyMs: Math.max(0, latencyMs),
      retryAfterSec: retryAfter ? Number(retryAfter) : null,
      bytes,
      timedOut: false,
    };
  } catch (err: any) {
    const latencyMs = opts.nowFn() - start;
    if (err?.name === 'AbortError') {
      return { status: null, latencyMs: Math.max(0, latencyMs), retryAfterSec: null, bytes: 0, timedOut: true };
    }
    return { status: null, latencyMs: Math.max(0, latencyMs), retryAfterSec: null, bytes: 0, timedOut: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Probes an endpoint `sampleCount` times (default 3) and returns raw samples.
 */
export async function probeEndpoint(
  target: EndpointProbeTarget,
  opts: ProbeRequestOptions = {}
): Promise<ProbeSample[]> {
  const sampleCount = Math.max(1, Math.min(10, Math.floor(opts.sampleCount ?? 3)));
  const timeoutMs = opts.timeoutMs ?? 8000;
  const fetchFn = opts.fetchFn ?? fetch;
  const nowFn = opts.nowFn ?? Date.now.bind(Date);

  const samples: ProbeSample[] = [];
  for (let i = 0; i < sampleCount; i++) {
    samples.push(await probeOnce(target, { timeoutMs, fetchFn, nowFn }));
  }
  return samples;
}

function percentile95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

/**
 * Reduces raw probe samples into a persisted EndpointTelemetry record.
 */
export function analyzeProbeResults(
  target: EndpointProbeTarget,
  samples: ProbeSample[],
  checkedAt = new Date().toISOString()
): EndpointTelemetry {
  const ok = samples.filter((s) => s.status !== null && s.status >= 200 && s.status < 300);
  const online = ok.length > 0;

  const latencies = samples
    .map((s) => s.latencyMs)
    .filter((v): v is number => v !== null);

  const okDurationMs = ok
    .map((s) => s.latencyMs)
    .filter((v): v is number => v !== null)
    .reduce((acc, v) => acc + v, 0);

  const okBytes = ok.reduce((acc, s) => acc + s.bytes, 0);
  const estimatedTokens = okBytes / 4;
  const tokensPerSec = okDurationMs > 0 ? (estimatedTokens / okDurationMs) * 1000 : null;

  const rateLimitedSamples = samples.filter((s) => s.status === 429);
  const lastRateLimited = rateLimitedSamples[rateLimitedSamples.length - 1];
  const lastSample = samples[samples.length - 1];

  return {
    model_id: target.model_id,
    provider: target.provider,
    endpoint_url: target.url,
    checked_at: checkedAt,
    online,
    http_status: lastSample.status,
    p95_latency_ms: percentile95(latencies),
    avg_latency_ms: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
    tokens_per_sec: tokensPerSec !== null ? Math.round(tokensPerSec * 100) / 100 : null,
    rate_limited: rateLimitedSamples.length > 0,
    rate_limited_count: rateLimitedSamples.length,
    retry_after_sec: lastRateLimited?.retryAfterSec ?? null,
    sample_count: samples.length,
    is_free: target.is_free,
    free_tier_active: target.is_free ? online : null,
    error: lastSample.error || null,
  };
}

export interface HealthThresholds {
  maxP95LatencyMs?: number;
  maxRateLimitedPct?: number;
}

/**
 * Classifies an endpoint telemetry record as healthy / degraded / down with reasons.
 */
export function evaluateEndpointHealth(
  record: EndpointTelemetry,
  thresholds: HealthThresholds = {}
): EndpointHealthReport {
  const maxLatency = thresholds.maxP95LatencyMs ?? 8000;
  const maxRlPct = thresholds.maxRateLimitedPct ?? 0.5;

  if (!record.online) {
    const reasons = ['Endpoint did not answer any probe sample'];
    if (record.rate_limited) reasons.push(`Rate-limited on all probes (429, Retry-After ${record.retry_after_sec ?? '?'}s)`);
    if (record.error) reasons.push(`Last error: ${record.error}`);
    return { status: 'down', reasons };
  }

  // Free-tier endpoint that is reachable but not serving traffic is effectively down.
  if (record.is_free && record.free_tier_active === false) {
    return { status: 'down', reasons: ['Free tier is not serving traffic'] };
  }

  const reasons: string[] = [];
  if (record.p95_latency_ms !== null && record.p95_latency_ms > maxLatency) {
    reasons.push(`P95 latency ${Math.round(record.p95_latency_ms)}ms exceeds ${maxLatency}ms`);
  }
  if (record.sample_count > 0) {
    const rlPct = record.rate_limited_count / record.sample_count;
    if (rlPct >= maxRlPct) {
      reasons.push(`Rate-limited on ${Math.round(rlPct * 100)}% of probes (429)`);
    }
  }
  if (record.tokens_per_sec !== null && record.tokens_per_sec < 5) {
    reasons.push(`Throughput extremely low (${Math.round(record.tokens_per_sec)} tokens/sec)`);
  }

  return {
    status: reasons.length > 0 ? 'degraded' : 'healthy',
    reasons,
  };
}

export interface RunProbesOptions {
  snapshots?: ModelSnapshot[];
  targets?: EndpointProbeTarget[];
  watchedModelIds?: Set<string>;
  limit?: number;
  sampleCount?: number;
  fetchFn?: typeof fetch;
  nowFn?: () => number;
  asOf?: string;
}

export interface RunProbesResult {
  runId: string;
  checked_at: string;
  probed: number;
  saved: number;
  healthy: number;
  degraded: number;
  down: number;
  incompatible: number;
  records: EndpointTelemetry[];
}

/**
 * Runs a scheduled probe cycle over tracked endpoints and persists results.
 * Prioritizes watched models and free-tier endpoints when a limit is set.
 */
export async function runEndpointProbes(opts: RunProbesOptions = {}): Promise<RunProbesResult> {
  const runId = `probe-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const checkedAt = opts.asOf || new Date().toISOString();

  const allTargets = opts.targets || (opts.snapshots ? buildProbeTargets(opts.snapshots) : []);
  const watched = opts.watchedModelIds || new Set<string>();

  const ranked = [...allTargets];
  ranked.sort((a, b) => {
    const aw = watched.has(a.model_id) ? 2 : a.is_free ? 1 : 0;
    const bw = watched.has(b.model_id) ? 2 : b.is_free ? 1 : 0;
    return bw - aw;
  });

  const selected = ranked.slice(0, Math.max(1, Math.floor(opts.limit ?? 50)));

  const records: EndpointTelemetry[] = [];
  let healthy = 0;
  let degraded = 0;
  let down = 0;

  for (const target of selected) {
    const samples = await probeEndpoint(target, {
      sampleCount: opts.sampleCount,
      fetchFn: opts.fetchFn,
      nowFn: opts.nowFn,
    });
    const record = analyzeProbeResults(target, samples, checkedAt);

    const health = evaluateEndpointHealth(record);
    if (health.status === 'down') down++;
    else if (health.status === 'degraded') degraded++;
    else healthy++;

    records.push(record);
    await saveEndpointTelemetry(record);
  }

  return {
    runId,
    checked_at: checkedAt,
    probed: selected.length,
    saved: records.length,
    healthy,
    degraded,
    down,
    incompatible: Math.max(0, allTargets.length - selected.length),
    records,
  };
}

export interface WatchlistTelemetryQuery {
  modelIds?: string[];
  sinceMs?: number;
  thresholds?: HealthThresholds;
}

export interface WatchlistTelemetryResult {
  model_id: string;
  provider: string;
  status: EndpointHealthReport['status'];
  reasons: string[];
  latest: EndpointTelemetry | null;
}

/**
 * Teams watchlist hook: latest telemetry health for a set of watched model ids.
 */
export async function getDegradedEndpointsForWatchlist(
  modelIds: string[],
  opts: WatchlistTelemetryQuery = {}
): Promise<WatchlistTelemetryResult[]> {
  const sinceMs = opts.sinceMs ?? 24 * 60 * 60 * 1000;
  const rows = modelIds.length > 0
    ? await getRecentEndpointTelemetry({ limit: 500, sinceMs })
    : [];

  const byModel = new Map<string, EndpointTelemetry>();
  for (const row of rows) {
    if (modelIds.includes(row.model_id) && !byModel.has(row.model_id)) {
      byModel.set(row.model_id, row);
    }
  }

  const results: WatchlistTelemetryResult[] = [];
  for (const modelId of modelIds) {
    const latest = byModel.get(modelId) || null;
    if (!latest) continue;
    const health = evaluateEndpointHealth(latest, opts.thresholds);
    results.push({
      model_id: modelId,
      provider: latest.provider,
      status: health.status,
      reasons: health.reasons,
      latest,
    });
  }

  return results.sort((a, b) => {
    const rank = { down: 2, degraded: 1, healthy: 0 } as const;
    return rank[b.status] - rank[a.status];
  });
}