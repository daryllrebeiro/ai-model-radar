/**
 * Metric events sink (next-steps N1): counted occurrences for S success
 * metrics (completions, votes, decisions). Writers are fire-and-forget —
 * a metric failure must never fail a user request, so recordMetric swallows
 * errors to a warn log. Reviews read SUMs via getMetricSums.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { logger } from '../logger';

/** Known event names. New surfaces add a name here (registry, not freeform). */
export const METRIC_NAMES = [
  's6.estimate.completed',
  's3.optimize.completed',
  's8.codegen.completed',
  'drift.review.decided',
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

export async function recordMetric(name: MetricName, value = 1): Promise<void> {
  try {
    if (!Number.isInteger(value)) return;
    if (isPostgres()) {
      const pool = getPgPool();
      await pool.query(`INSERT INTO metric_events (name, value) VALUES ($1, $2)`, [name, value]);
    } else {
      const state = getLocalState();
      if (!state.metric_events) state.metric_events = [];
      state.metric_events.push({
        id: state.metric_events.length + 1,
        name,
        value,
        created_at: new Date().toISOString(),
      });
      saveLocalState(state);
    }
  } catch (err: any) {
    // Fire-and-forget by design: metrics never break user flows.
    logger.warn('metric.record.failed', { name, error: err?.message || String(err) });
  }
}

export async function getMetricSums(sinceIso?: string): Promise<Record<string, number>> {
  const since = sinceIso || new Date(0).toISOString();
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT name, COALESCE(SUM(value), 0)::INT AS total
         FROM metric_events WHERE created_at >= $1 GROUP BY name`,
      [since]
    );
    return Object.fromEntries(res.rows.map((r: any) => [r.name, Number(r.total)]));
  }
  const sinceMs = new Date(since).getTime();
  const sums: Record<string, number> = {};
  for (const r of getLocalState().metric_events || []) {
    if (new Date(r.created_at).getTime() < sinceMs) continue;
    sums[r.name] = (sums[r.name] || 0) + (Number(r.value) || 0);
  }
  return sums;
}
