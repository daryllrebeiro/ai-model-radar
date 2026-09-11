/**
 * P0 retention policy for write-per-request / write-per-upload tables.
 *
 * routing_attempts grows with proxied traffic; usage_imports rows carry
 * financial data (up to 2MB each). Neither had a retention rule — this
 * module is the single place windows are defined. Pruning is aggregate-
 * then-delete: callers snapshot reliability/counts before deleting.
 */

export const RETENTION_BATCH_CAP = 5000;

/** Raw routing-attempt window (days). Default 30. */
export function routingRetentionDays(env = process.env): number {
  const raw = Number(env.RETENTION_ROUTING_DAYS);
  if (!Number.isFinite(raw)) return 30;
  return Math.min(3650, Math.max(1, Math.floor(raw)));
}

/** Usage-import window (days). Default 365. Financial data: floor of 30. */
export function usageRetentionDays(env = process.env): number {
  const raw = Number(env.RETENTION_USAGE_DAYS);
  if (!Number.isFinite(raw)) return 365;
  return Math.min(3650, Math.max(30, Math.floor(raw)));
}

export function retentionCutoffIso(days: number, nowMs = Date.now()): string {
  return new Date(nowMs - days * 24 * 3600 * 1000).toISOString();
}

export interface RetentionResult {
  table: string;
  window_days: number;
  cutoff: string;
  deleted: number;
  capped: boolean;
}
