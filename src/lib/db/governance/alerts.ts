/**
 * Budget alert emissions log.
 * Split out of db/governance.ts (P0 god-module remediation, first cut) —
 * same logic, new home. db/governance.ts re-exports everything, so no
 * caller changes.
 */
import { BudgetAlertRecord } from '@/types/governance';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from '../client';

export async function recordBudgetAlert(alert: BudgetAlertRecord): Promise<BudgetAlertRecord> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO budget_alerts
        (rule_id, model_family, projected_monthly_usd, budget_usd, pct_used, alert_type, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        alert.rule_id ?? null,
        alert.model_family ?? null,
        alert.projected_monthly_usd,
        alert.budget_usd,
        alert.pct_used,
        alert.alert_type,
        alert.message,
      ]
    );
    const r = res.rows[0];
    return {
      id: Number(r.id),
      rule_id: r.rule_id !== null ? Number(r.rule_id) : undefined,
      model_family: r.model_family,
      projected_monthly_usd: Number(r.projected_monthly_usd),
      budget_usd: Number(r.budget_usd),
      pct_used: Number(r.pct_used),
      alert_type: r.alert_type,
      message: r.message,
      acknowledged: Boolean(r.acknowledged),
      created_at: r.created_at,
    };
  } else {
    const state = getLocalState();
    if (!state.budget_alerts) state.budget_alerts = [];
    const record = {
      id: state.budget_alerts.length + 1,
      rule_id: alert.rule_id ?? undefined,
      model_family: alert.model_family ?? null,
      projected_monthly_usd: alert.projected_monthly_usd,
      budget_usd: alert.budget_usd,
      pct_used: alert.pct_used,
      alert_type: alert.alert_type,
      message: alert.message,
      acknowledged: Boolean(alert.acknowledged),
      created_at: new Date().toISOString(),
    };
    state.budget_alerts.push(record);
    saveLocalState(state);
    return { ...record };
  }
}

export async function getBudgetAlerts(opts: {
  ruleIds?: number[];
  limit?: number;
  sinceHours?: number;
} = {}): Promise<BudgetAlertRecord[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 50)));
  if (isPostgres()) {
    const pool = getPgPool();
    const where: string[] = [];
    const params: any[] = [];
    if (opts.ruleIds && opts.ruleIds.length > 0) {
      params.push(opts.ruleIds);
      where.push(`rule_id = ANY($${params.length}::int[])`);
    }
    if (opts.sinceHours && opts.sinceHours > 0) {
      params.push(new Date(Date.now() - opts.sinceHours * 3600_000).toISOString());
      where.push(`created_at >= $${params.length}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const res = await pool.query(
      `SELECT * FROM budget_alerts ${whereSql} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return res.rows.map((r: any) => ({
      id: Number(r.id),
      rule_id: r.rule_id !== null ? Number(r.rule_id) : undefined,
      model_family: r.model_family,
      projected_monthly_usd: Number(r.projected_monthly_usd),
      budget_usd: Number(r.budget_usd),
      pct_used: Number(r.pct_used),
      alert_type: r.alert_type,
      message: r.message,
      acknowledged: Boolean(r.acknowledged),
      created_at: r.created_at,
    }));
  } else {
    const state = getLocalState();
    const since = opts.sinceHours && opts.sinceHours > 0
      ? Date.now() - opts.sinceHours * 3600_000
      : 0;
    return (state.budget_alerts || [])
      .filter((a: any) => !opts.ruleIds || opts.ruleIds.length === 0 || opts.ruleIds.includes(Number(a.rule_id)))
      .filter((a: any) => new Date(a.created_at).getTime() >= since)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit)
      .map((a: any) => ({
        ...a,
        rule_id: a.rule_id !== null && a.rule_id !== undefined ? Number(a.rule_id) : undefined,
      }));
  }
}
