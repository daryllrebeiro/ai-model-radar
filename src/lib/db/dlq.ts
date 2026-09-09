/**
 * Webhook dead-letter queue: durable terminal-failure rows with atomic
 * claim (UPDATE ... RETURNING), resolve, and requeue.
 * Split out of queries.ts (god-module remediation) - same logic, new home.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';

export type DlqStatus = 'queued' | 'retrying' | 'dead' | 'delivered';

/** Persistent dead-letter row for terminally failed webhooks (017_webhook_dlq). */
export interface DlqDelivery {
  id?: number;
  delivery_id: string;
  rule_id?: string | null;
  destination_url: string;
  payload: string;
  attempts: number;
  max_attempts: number;
  next_retry_at?: string;
  status: DlqStatus;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ─── WEBHOOK DEAD-LETTER QUEUE (017_webhook_dlq) ────────────────────
// Terminal webhook failures park here when the sender opts in. claimDlqDue
// is a single atomic UPDATE ... RETURNING: concurrent workers never
// double-deliver the same row.

export const DLQ_MAX_PAYLOAD_CHARS = 100_000;

function mapDlqRows(rows: any[]): DlqDelivery[] {
  return rows.map((r: any) => ({
    id: Number(r.id),
    delivery_id: r.delivery_id,
    rule_id: r.rule_id ?? null,
    destination_url: r.destination_url,
    payload: r.payload,
    attempts: Number(r.attempts),
    max_attempts: Number(r.max_attempts),
    next_retry_at: r.next_retry_at,
    status: r.status as DlqStatus,
    last_error: r.last_error ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export function dlqBackoffMs(attempts: number): number {
  const exp = Math.min(10, Math.max(0, Math.floor(attempts)));
  return Math.min(3_600_000, 60_000 * 2 ** exp);
}

export async function enqueueDlqDelivery(input: {
  delivery_id: string;
  rule_id?: string | null;
  destination_url: string;
  payload: string;
  attempts?: number;
  max_attempts?: number;
  last_error?: string | null;
  /** Override for scheduled redrive/import flows; defaults to backoff from now. */
  next_retry_at?: string;
}): Promise<DlqDelivery> {
  const deliveryId = input.delivery_id.trim().slice(0, 200);
  if (!deliveryId) throw new Error('delivery_id is required');
  if (input.payload.length > DLQ_MAX_PAYLOAD_CHARS) {
    throw new Error(`payload exceeds DLQ cap of ${DLQ_MAX_PAYLOAD_CHARS} chars`);
  }
  const maxAttempts = Math.min(20, Math.max(1, Math.floor(input.max_attempts ?? 5)));
  const attempts = Math.min(maxAttempts, Math.max(0, Math.floor(input.attempts ?? 0)));
  const status: DlqStatus = attempts >= maxAttempts ? 'dead' : 'queued';
  const nextRetry = input.next_retry_at && !Number.isNaN(new Date(input.next_retry_at).getTime())
    ? new Date(input.next_retry_at).toISOString()
    : new Date(Date.now() + dlqBackoffMs(attempts)).toISOString();

  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO webhook_dlq
        (delivery_id, rule_id, destination_url, payload, attempts, max_attempts, next_retry_at, status, last_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (delivery_id) DO UPDATE SET
         attempts = EXCLUDED.attempts,
         last_error = EXCLUDED.last_error,
         next_retry_at = EXCLUDED.next_retry_at,
         status = CASE WHEN webhook_dlq.status = 'delivered' THEN 'delivered' ELSE EXCLUDED.status END,
         updated_at = NOW()
       RETURNING *`,
      [
        deliveryId,
        input.rule_id ?? null,
        input.destination_url,
        input.payload,
        attempts,
        maxAttempts,
        nextRetry,
        status,
        input.last_error ?? null,
      ]
    );
    return mapDlqRows(res.rows)[0];
  } else {
    const state = getLocalState();
    if (!state.webhook_dlq) state.webhook_dlq = [];
    const now = new Date().toISOString();
    const existing = (state.webhook_dlq as any[]).find((d: any) => d.delivery_id === deliveryId);
    if (existing) {
      if (existing.status !== 'delivered') {
        existing.attempts = attempts;
        existing.last_error = input.last_error ?? null;
        existing.next_retry_at = nextRetry;
        existing.status = status;
        existing.updated_at = now;
      }
      saveLocalState(state);
      return { ...existing };
    }
    const record = {
      id: state.webhook_dlq.length + 1,
      delivery_id: deliveryId,
      rule_id: input.rule_id ?? null,
      destination_url: input.destination_url,
      payload: input.payload,
      attempts,
      max_attempts: maxAttempts,
      next_retry_at: nextRetry,
      status,
      last_error: input.last_error ?? null,
      created_at: now,
      updated_at: now,
    };
    state.webhook_dlq.push(record);
    saveLocalState(state);
    return { ...record };
  }
}

export async function getDlqDeliveries(opts: {
  status?: DlqStatus;
  limit?: number;
} = {}): Promise<DlqDelivery[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 50)));
  if (isPostgres()) {
    const pool = getPgPool();
    const where = opts.status ? `WHERE status = $1` : '';
    const params = opts.status ? [opts.status, limit] : [limit];
    const res = await pool.query(
      `SELECT * FROM webhook_dlq ${where} ORDER BY next_retry_at ASC, id ASC LIMIT $${params.length}`,
      params
    );
    return mapDlqRows(res.rows);
  } else {
    const state = getLocalState();
    return ((state.webhook_dlq || []) as any[])
      .filter((d: any) => !opts.status || d.status === opts.status)
      .sort((a: any, b: any) =>
        new Date(a.next_retry_at).getTime() - new Date(b.next_retry_at).getTime() || Number(a.id) - Number(b.id)
      )
      .slice(0, limit)
      .map((d: any) => ({ ...d }));
  }
}

export async function getDlqDelivery(id: number): Promise<DlqDelivery | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM webhook_dlq WHERE id = $1 LIMIT 1`, [id]);
    if (res.rows.length === 0) return null;
    return mapDlqRows(res.rows)[0];
  } else {
    const state = getLocalState();
    const row = ((state.webhook_dlq || []) as any[]).find((d: any) => Number(d.id) === id);
    return row ? { ...row } : null;
  }
}

/**
 * Atomically claims up to `limit` due rows for redelivery. A row is due
 * when next_retry_at has passed and it is either never-claimed ('queued')
 * or its claim lease expired ('retrying' with updated_at older than
 * leaseMs — crash recovery for workers that die mid-round). Claimed rows
 * flip to 'retrying' with a fresh updated_at so a second worker's claim
 * skips them: single-flight within the lease window.
 */
export async function claimDlqDue(limit = 10, leaseMs = 300_000): Promise<DlqDelivery[]> {
  const n = Math.min(50, Math.max(1, Math.floor(limit)));
  const lease = Math.min(3_600_000, Math.max(10_000, Math.floor(leaseMs)));
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE webhook_dlq
       SET status = 'retrying', updated_at = NOW()
       WHERE id IN (
         SELECT id FROM webhook_dlq
         WHERE next_retry_at <= NOW()
           AND (status = 'queued'
                OR (status = 'retrying' AND updated_at <= NOW() - ($2 || ' milliseconds')::interval))
         ORDER BY next_retry_at ASC, id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [n, String(lease)]
    );
    return mapDlqRows(res.rows);
  } else {
    const state = getLocalState();
    const now = Date.now();
    const due = ((state.webhook_dlq || []) as any[])
      .filter((d: any) =>
        new Date(d.next_retry_at).getTime() <= now &&
        (d.status === 'queued' ||
          (d.status === 'retrying' && new Date(d.updated_at).getTime() <= now - lease))
      )
      .sort((a: any, b: any) =>
        new Date(a.next_retry_at).getTime() - new Date(b.next_retry_at).getTime() || Number(a.id) - Number(b.id)
      )
      .slice(0, n);
    for (const d of due) {
      d.status = 'retrying';
      d.updated_at = new Date().toISOString();
    }
    if (due.length > 0) saveLocalState(state);
    return due.map((d: any) => ({ ...d }));
  }
}

export async function resolveDlqDelivery(
  id: number,
  outcome: { delivered: boolean; last_error?: string | null; attempts?: number }
): Promise<DlqDelivery | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  if (isPostgres()) {
    const pool = getPgPool();
    if (outcome.delivered) {
      const res = await pool.query(
        `UPDATE webhook_dlq
         SET status = 'delivered', last_error = NULL, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id]
      );
      if (res.rows.length === 0) return null;
      return mapDlqRows(res.rows)[0];
    }
    // Requeue with backoff, or park as dead past max_attempts. attempts
    // counts redelivery rounds (inline retries inside one round don't count).
    const current = await pool.query(`SELECT * FROM webhook_dlq WHERE id = $1 LIMIT 1`, [id]);
    if (current.rows.length === 0) return null;
    const row = current.rows[0];
    const attempts = outcome.attempts ?? Number(row.attempts) + 1;
    const dead = attempts >= Number(row.max_attempts);
    const res = await pool.query(
      `UPDATE webhook_dlq
       SET attempts = $2,
           status = $3,
           last_error = $4,
           next_retry_at = $5,
           updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        id,
        attempts,
        dead ? 'dead' : 'retrying',
        outcome.last_error ?? row.last_error,
        new Date(Date.now() + dlqBackoffMs(attempts)).toISOString(),
      ]
    );
    return mapDlqRows(res.rows)[0];
  } else {
    const state = getLocalState();
    const row = ((state.webhook_dlq || []) as any[]).find((d: any) => Number(d.id) === id);
    if (!row) return null;
    if (outcome.delivered) {
      row.status = 'delivered';
      row.last_error = null;
    } else {
      const attempts = outcome.attempts ?? Number(row.attempts) + 1;
      row.attempts = attempts;
      row.status = attempts >= Number(row.max_attempts) ? 'dead' : 'retrying';
      row.last_error = outcome.last_error ?? row.last_error;
      row.next_retry_at = new Date(Date.now() + dlqBackoffMs(attempts)).toISOString();
    }
    row.updated_at = new Date().toISOString();
    saveLocalState(state);
    return { ...row };
  }
}

/**
 * Requeues a dead (or retrying) row for immediate pickup. Delivered rows
 * are terminal and cannot be requeued.
 */
export async function requeueDlqDelivery(id: number): Promise<DlqDelivery | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE webhook_dlq
       SET status = 'queued', next_retry_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status != 'delivered'
       RETURNING *`,
      [id]
    );
    if (res.rows.length === 0) return null;
    return mapDlqRows(res.rows)[0];
  } else {
    const state = getLocalState();
    const row = ((state.webhook_dlq || []) as any[]).find((d: any) => Number(d.id) === id);
    if (!row || row.status === 'delivered') return null;
    row.status = 'queued';
    row.next_retry_at = new Date().toISOString();
    row.updated_at = new Date().toISOString();
    saveLocalState(state);
    return { ...row };
  }
}

// ─── BYO EVAL HARNESS (020_eval_runs) ─────────────────────────────────
// User-submitted benchmark runs, one row per run. Scores JSON is validated
// by src/lib/evals.ts before insert; aggregation is client-side (portable).
