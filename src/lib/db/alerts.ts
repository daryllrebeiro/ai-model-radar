/**
 * Alerts and digest delivery: alert rules, rule status writes, digest
 * audit log, recent-events helper.
 * Split out of queries.ts (god-module remediation) - same logic, new home.
 */
import { ModelEvent } from '@/types/events';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { getEvents } from './events';

export interface DigestDeliveryRecord {
    id?: number;
    rule_id?: string;
    destination_url: string;
    payload_preview?: string;
    http_status?: number;
    attempts: number;
    delivered_at: string;
    success: boolean;
    error_message?: string;
  }

/**
 * Records a webhook delivery attempt in the audit log
 */
export async function recordDigestDelivery(delivery: DigestDeliveryRecord): Promise<void> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO digest_deliveries (rule_id, destination_url, payload_preview, http_status, attempts, delivered_at, success, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        delivery.rule_id || null,
        delivery.destination_url,
        delivery.payload_preview || null,
        delivery.http_status || null,
        delivery.attempts,
        delivery.delivered_at,
        delivery.success,
        delivery.error_message || null,
      ]
    );
  } else {
    const state = getLocalState();
    if (!state.digest_deliveries) state.digest_deliveries = [];
    state.digest_deliveries.unshift({ ...delivery, id: state.digest_deliveries.length + 1 });
    saveLocalState(state);
  }
}

/**
 * Retrieves the latest webhook delivery audit records
 */
export async function getRecentDigestDeliveries(limit = 20): Promise<DigestDeliveryRecord[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT * FROM digest_deliveries ORDER BY delivered_at DESC LIMIT $1`,
      [limit]
    );
    return res.rows.map((row: any) => ({
      id: Number(row.id),
      rule_id: row.rule_id,
      destination_url: row.destination_url,
      payload_preview: row.payload_preview,
      http_status: row.http_status !== null ? Number(row.http_status) : undefined,
      attempts: Number(row.attempts),
      delivered_at: row.delivered_at,
      success: Boolean(row.success),
      error_message: row.error_message,
    }));
  } else {
    const state = getLocalState();
    return (state.digest_deliveries || []).slice(0, limit);
  }
}

export interface AlertRuleRecord {
  id?: string | number;
  type: 'email' | 'webhook';
  destination: string;
  active: boolean;
  min_price_drop_pct?: number;
  created_at?: string;
}

/**
 * Retrieves recent model change events
 */
export async function getRecentEvents(limit = 25): Promise<ModelEvent[]> {
  const result = await getEvents({ limit });
  return result.events;
}

/**
 * Retrieves all active notification alert rules
 */
export async function getActiveAlertRules(): Promise<AlertRuleRecord[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT id, type, destination, active, min_price_drop_pct, created_at 
       FROM alert_rules 
       WHERE active = true`
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      destination: r.destination,
      active: Boolean(r.active),
      min_price_drop_pct: r.min_price_drop_pct ? Number(r.min_price_drop_pct) : undefined,
      created_at: r.created_at,
    }));
  } else {
    const state = getLocalState();
    return ((state as any).alert_rules || [])
      .filter((r: any) => r.active !== false)
      .map((r: any) => ({
        id: r.id || r.destination,
        type: r.type || (r.destination?.includes('@') ? 'email' : 'webhook'),
        destination: r.destination,
        active: r.active !== false,
      }));
  }
}

  /**
   * Activates or deactivates an alert rule by numeric id. Prefer this over
   * destination matching: the old dual-key form (id OR destination) lets any
   * future id-from-client caller disable rules by destination string.
   */
  export async function updateAlertRuleStatusById(ruleId: string | number, active: boolean): Promise<void> {
    if (isPostgres()) {
      const pool = getPgPool();
      await pool.query(`UPDATE alert_rules SET active = $1 WHERE id = $2`, [active, ruleId]);
    } else {
      const state = getLocalState();
      if ((state as any).alert_rules) {
        const rule = (state as any).alert_rules.find((r: any) => Number(r.id) === Number(ruleId));
        if (rule) {
          rule.active = active;
          saveLocalState(state);
        }
      }
    }
  }

  /**
   * @deprecated Use updateAlertRuleStatusById. Retained for backwards
   * compatibility; do not use with client-supplied identifiers.
   */
  export async function updateAlertRuleStatus(ruleId: string | number, active: boolean): Promise<void> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(`UPDATE alert_rules SET active = $1 WHERE id = $2 OR destination = $2::text`, [
      active,
      ruleId,
    ]);
  } else {
    const state = getLocalState();
    if ((state as any).alert_rules) {
      const rule = (state as any).alert_rules.find(
        (r: any) => r.id === ruleId || r.destination === ruleId
      );
      if (rule) {
        rule.active = active;
        saveLocalState(state);
      }
    }
  }
}
