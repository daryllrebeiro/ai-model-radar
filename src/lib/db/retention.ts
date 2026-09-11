/**
 * P0 retention enforcement: batched hard deletes behind the windows in
 * lib/retention.ts. Aggregate-then-delete: the cron caller snapshots
 * reliability/counts BEFORE invoking these, so history survives as metrics.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { RETENTION_BATCH_CAP } from '../retention';

async function pruneLocal(key: 'routing_attempts' | 'usage_imports' | 'probe_spend_ledger', cutoffIso: string): Promise<{ deleted: number; capped: boolean }> {
  const state = getLocalState();
  const cutoff = new Date(cutoffIso).getTime();
  const rows = state[key] as any[];
  const fresh = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff);
  const deleted = Math.min(rows.length - fresh.length, RETENTION_BATCH_CAP);
  // Cap: delete oldest-first up to the cap, keep the rest for next tick.
  const victims = new Set(
    rows
      .filter((r) => new Date(r.created_at).getTime() < cutoff)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(0, RETENTION_BATCH_CAP)
      .map((r) => r.id)
  );
  state[key] = rows.filter((r) => !victims.has(r.id)) as any;
  saveLocalState(state);
  return { deleted, capped: rows.length - fresh.length > RETENTION_BATCH_CAP };
}

export async function pruneRoutingAttempts(cutoffIso: string): Promise<{ deleted: number; capped: boolean }> {
  if (isPostgres()) {
    const pool = getPgPool();
    // Batch via ctid: single statement, bounded write, no long lock.
    const res = await pool.query(
      `DELETE FROM routing_attempts WHERE ctid IN (
         SELECT ctid FROM routing_attempts WHERE created_at < $1 ORDER BY created_at ASC LIMIT $2
       )`,
      [cutoffIso, RETENTION_BATCH_CAP]
    );
    const deleted = res.rowCount || 0;
    const remaining = await pool.query(`SELECT COUNT(*) AS n FROM routing_attempts WHERE created_at < $1`, [cutoffIso]);
    return { deleted, capped: Number(remaining.rows[0].n) > 0 };
  }
  return pruneLocal('routing_attempts', cutoffIso);
}

export async function pruneUsageImports(cutoffIso: string): Promise<{ deleted: number; capped: boolean }> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `DELETE FROM usage_imports WHERE ctid IN (
         SELECT ctid FROM usage_imports WHERE created_at < $1 ORDER BY created_at ASC LIMIT $2
       )`,
      [cutoffIso, RETENTION_BATCH_CAP]
    );
    const deleted = res.rowCount || 0;
    const remaining = await pool.query(`SELECT COUNT(*) AS n FROM usage_imports WHERE created_at < $1`, [cutoffIso]);
    return { deleted, capped: Number(remaining.rows[0].n) > 0 };
  }
  return pruneLocal('usage_imports', cutoffIso);
}

/**
 * P2-5 — ledger retention: raw rows older than the window (default 90d) are
 * pruned batched-oldest-first. Rollups survive by construction: budget
 * alerts read aggregates via getProbeSpendSince, so deleting raw rows never
 * destroys history — same aggregate-then-delete contract as routing attempts.
 * Org-scan results and deprecation announcements need no TTL: the former is
 * never persisted server-side, the latter IS the history.
 */
export async function pruneProbeSpendLedger(cutoffIso: string): Promise<{ deleted: number; capped: boolean }> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `DELETE FROM probe_spend_ledger WHERE ctid IN (
         SELECT ctid FROM probe_spend_ledger WHERE created_at < $1 ORDER BY created_at ASC LIMIT $2
       )`,
      [cutoffIso, RETENTION_BATCH_CAP]
    );
    const deleted = res.rowCount || 0;
    const remaining = await pool.query(`SELECT COUNT(*) AS n FROM probe_spend_ledger WHERE created_at < $1`, [cutoffIso]);
    return { deleted, capped: Number(remaining.rows[0].n) > 0 };
  }
  return pruneLocal('probe_spend_ledger', cutoffIso);
}
