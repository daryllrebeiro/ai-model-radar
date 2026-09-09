/**
 * Endpoint telemetry: probe-result writes and recent-telemetry reads.
 * Split out of queries.ts (god-module remediation) - same logic, new home.
 */
import { EndpointTelemetry } from '@/types/telemetry';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';

// ─── ENDPOINT PROBE TELEMETRY (Pro, APT_PROBE) ─────────────────────

/**
 * Persists a single endpoint probe telemetry record.
 */
export async function saveEndpointTelemetry(record: EndpointTelemetry): Promise<void> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO endpoint_telemetry
        (model_id, provider, endpoint_url, checked_at, online, http_status, p95_latency_ms, avg_latency_ms,
         tokens_per_sec, rate_limited, rate_limited_count, retry_after_sec, sample_count, is_free, free_tier_active, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        record.model_id,
        record.provider,
        record.endpoint_url || null,
        record.checked_at,
        record.online,
        record.http_status,
        record.p95_latency_ms,
        record.avg_latency_ms,
        record.tokens_per_sec,
        record.rate_limited,
        record.rate_limited_count,
        record.retry_after_sec,
        record.sample_count,
        record.is_free,
        record.free_tier_active,
        record.error || null,
      ]
    );
  } else {
    const state = getLocalState();
    if (!state.endpoint_telemetry) state.endpoint_telemetry = [];
    state.endpoint_telemetry.push({
      id: state.endpoint_telemetry.length + 1,
      model_id: record.model_id,
      provider: record.provider,
      endpoint_url: record.endpoint_url || null,
      checked_at: record.checked_at,
      online: Boolean(record.online),
      http_status: record.http_status,
      p95_latency_ms: record.p95_latency_ms !== null && record.p95_latency_ms !== undefined ? Number(record.p95_latency_ms) : null,
      avg_latency_ms: record.avg_latency_ms !== null && record.avg_latency_ms !== undefined ? Number(record.avg_latency_ms) : null,
      tokens_per_sec: record.tokens_per_sec !== null && record.tokens_per_sec !== undefined ? Number(record.tokens_per_sec) : null,
      rate_limited: Boolean(record.rate_limited),
      rate_limited_count: Number(record.rate_limited_count) || 0,
      retry_after_sec: record.retry_after_sec,
      sample_count: Number(record.sample_count) || 0,
      is_free: Boolean(record.is_free),
      free_tier_active: record.free_tier_active,
      error: record.error || null,
    });
    saveLocalState(state);
  }
}

export interface EndpointTelemetryQuery {
  modelId?: string;
  provider?: string;
  limit?: number;
  sinceMs?: number;
}

/**
 * Retrieves recent endpoint telemetry, newest first.
 */
export async function getRecentEndpointTelemetry(
  opts: EndpointTelemetryQuery = {}
): Promise<EndpointTelemetry[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 50)));

  if (isPostgres()) {
    const pool = getPgPool();
    const where: string[] = [];
    const params: any[] = [];
    if (opts.modelId) {
      params.push(opts.modelId);
      where.push(`model_id = $${params.length}`);
    }
    if (opts.provider) {
      params.push(opts.provider);
      where.push(`provider = $${params.length}`);
    }
    if (opts.sinceMs) {
      params.push(new Date(Date.now() - opts.sinceMs).toISOString());
      where.push(`checked_at >= $${params.length}`);
    }
    params.push(limit);
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const res = await pool.query(
      `SELECT * FROM endpoint_telemetry ${whereSql} ORDER BY checked_at DESC LIMIT $${params.length}`,
      params
    );
    return res.rows.map((r: any) => ({
      id: Number(r.id),
      model_id: r.model_id,
      provider: r.provider,
      endpoint_url: r.endpoint_url,
      checked_at: r.checked_at,
      online: Boolean(r.online),
      http_status: r.http_status,
      p95_latency_ms: r.p95_latency_ms !== null ? Number(r.p95_latency_ms) : null,
      avg_latency_ms: r.avg_latency_ms !== null ? Number(r.avg_latency_ms) : null,
      tokens_per_sec: r.tokens_per_sec !== null ? Number(r.tokens_per_sec) : null,
      rate_limited: Boolean(r.rate_limited),
      rate_limited_count: Number(r.rate_limited_count),
      retry_after_sec: r.retry_after_sec,
      sample_count: Number(r.sample_count),
      is_free: Boolean(r.is_free),
      free_tier_active: r.free_tier_active,
      error: r.error,
    }));
  } else {
    const state = getLocalState();
    const cutoff = opts.sinceMs ? new Date(Date.now() - opts.sinceMs).getTime() : null;
    const rows = (state.endpoint_telemetry || [])
      .filter((r: any) => !opts.modelId || r.model_id === opts.modelId)
      .filter((r: any) => !opts.provider || r.provider === opts.provider)
      .filter((r: any) => (cutoff === null ? true : new Date(r.checked_at).getTime() >= cutoff))
      .sort((a: any, b: any) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime())
      .slice(0, limit);
    return rows.map((r: any) => ({
      ...r,
      online: Boolean(r.online),
      rate_limited: Boolean(r.rate_limited),
      is_free: Boolean(r.is_free),
    }));
  }
}

// ─── BUDGET GOVERNANCE (Enterprise, GOVERNANCE) ──────────────────
