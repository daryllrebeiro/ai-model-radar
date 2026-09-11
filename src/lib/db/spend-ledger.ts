/**
 * Probe spend ledger (P1-1): accounting for paid active-probe cycles (S4+S5).
 *
 * One row per model per cycle. Spend alerts and the ACTIVE_PROBE_ENABLED
 * kill switch read this table — without it, overruns surface on the
 * provider invoice instead of in the product.
 * Split out per the domain-per-file convention; re-exported via queries.ts.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';

export interface ProbeSpendRecord {
  id?: number;
  cycle_id: string;
  model_id: string;
  provider: string;
  calls: number;
  errors: number;
  est_tokens: number;
  created_at?: string;
}

export interface ProbeSpendRollup {
  provider: string;
  cycles: number;
  total_calls: number;
  total_errors: number;
  total_est_tokens: number;
}

/**
 * Appends one ledger row. Pure accounting — never throws for bad math, but
 * rejects negative counts loudly (a negative call count is a caller bug,
 * not a rounding choice).
 */
export async function recordProbeSpend(record: ProbeSpendRecord): Promise<void> {
  if (!record.cycle_id || !record.model_id) {
    throw new Error('recordProbeSpend requires cycle_id and model_id.');
  }
  for (const [k, v] of [['calls', record.calls], ['errors', record.errors], ['est_tokens', record.est_tokens]] as const) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`recordProbeSpend: ${k} must be a non-negative integer (got ${v}).`);
    }
  }
  const row = {
    cycle_id: record.cycle_id,
    model_id: record.model_id,
    provider: record.provider || '',
    calls: record.calls,
    errors: record.errors,
    est_tokens: record.est_tokens,
    created_at: record.created_at || new Date().toISOString(),
  };
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO probe_spend_ledger
        (cycle_id, model_id, provider, calls, errors, est_tokens, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.cycle_id, row.model_id, row.provider, row.calls, row.errors, row.est_tokens, row.created_at]
    );
  } else {
    const state = getLocalState();
    if (!state.probe_spend_ledger) state.probe_spend_ledger = [];
    state.probe_spend_ledger.push({ id: state.probe_spend_ledger.length + 1, ...row });
    saveLocalState(state);
  }
}

/**
 * Rolls up spend per provider since an ISO timestamp (default: last 24h).
 * The nightly budget alert consumes this — not raw rows.
 */
export async function getProbeSpendSince(sinceIso?: string): Promise<ProbeSpendRollup[]> {
  const since = sinceIso || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT provider,
              COUNT(DISTINCT cycle_id)::INT AS cycles,
              COALESCE(SUM(calls), 0)::INT AS total_calls,
              COALESCE(SUM(errors), 0)::INT AS total_errors,
              COALESCE(SUM(est_tokens), 0)::INT AS total_est_tokens
         FROM probe_spend_ledger
        WHERE created_at >= $1
        GROUP BY provider
        ORDER BY total_est_tokens DESC`,
      [since]
    );
    return res.rows.map((r: any) => ({
      provider: r.provider,
      cycles: Number(r.cycles),
      total_calls: Number(r.total_calls),
      total_errors: Number(r.total_errors),
      total_est_tokens: Number(r.total_est_tokens),
    }));
  }
  const state = getLocalState();
  const sinceMs = new Date(since).getTime();
  const byProvider = new Map<string, { cycles: Set<string>; calls: number; errors: number; tokens: number }>();
  for (const r of state.probe_spend_ledger || []) {
    if (new Date(r.created_at).getTime() < sinceMs) continue;
    const agg = byProvider.get(r.provider) || { cycles: new Set<string>(), calls: 0, errors: 0, tokens: 0 };
    agg.cycles.add(r.cycle_id);
    agg.calls += Number(r.calls) || 0;
    agg.errors += Number(r.errors) || 0;
    agg.tokens += Number(r.est_tokens) || 0;
    byProvider.set(r.provider, agg);
  }
  return [...byProvider.entries()]
    .map(([provider, a]) => ({
      provider,
      cycles: a.cycles.size,
      total_calls: a.calls,
      total_errors: a.errors,
      total_est_tokens: a.tokens,
    }))
    .sort((a, b) => b.total_est_tokens - a.total_est_tokens);
}
