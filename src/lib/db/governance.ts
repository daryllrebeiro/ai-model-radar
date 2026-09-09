/**
 * Budget governance: budget rules/alerts, shadow-AI findings, migration
 * approvals with quorum voting. Row mappers travel with their domain.
 * Split out of queries.ts (god-module remediation) - same logic, new home.
 */
import { BudgetRule, BudgetRuleScope, BudgetAlertRecord, MigrationApproval, ApprovalVote, ApprovalVoteDecision, ShadowAiRecord, ShadowFindingStatus } from '@/types/governance';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { getUserByEmail } from './users';
import { tallyVotes } from '../quorum';

export interface BudgetRuleInput {
  name: string;
  scope: BudgetRuleScope;
  team_id?: number | null;
  owner_email: string;
  monthly_budget_usd: number;
  alert_threshold_pct?: number;
  approval_required?: boolean;
  hard_cap?: boolean;
  notify_email?: string | null;
  active?: boolean;
}

function mapBudgetRuleRows(rows: any[]): BudgetRule[] {
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    scope: r.scope,
    team_id: r.team_id !== null && r.team_id !== undefined ? Number(r.team_id) : null,
    owner_email: r.owner_email,
    owner_user_id: r.owner_user_id !== null && r.owner_user_id !== undefined ? Number(r.owner_user_id) : null,
    monthly_budget_usd: Number(r.monthly_budget_usd),
    alert_threshold_pct: Number(r.alert_threshold_pct),
    approval_required: Boolean(r.approval_required),
    hard_cap: Boolean(r.hard_cap ?? false),
    notify_email: r.notify_email || null,
    active: Boolean(r.active),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

function mapBudgetRuleRow(r: any): BudgetRule {
  return mapBudgetRuleRows([r])[0];
}

export async function createBudgetRule(input: BudgetRuleInput): Promise<BudgetRule> {
  const threshold = Math.min(1, Math.max(0, input.alert_threshold_pct ?? 0.8));
  // Normalize once so stored emails always match users.email exactly.
  const normalizedOwnerEmail = input.owner_email.trim().toLowerCase();
  // Resolve owner_user_id from owner_email
  let ownerUserId: number | null = null;
  if (normalizedOwnerEmail) {
    const user = await getUserByEmail(normalizedOwnerEmail);
    ownerUserId = user?.id || null;
  }

  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO budget_rules
        (name, scope, team_id, owner_email, owner_user_id, monthly_budget_usd, alert_threshold_pct, approval_required, hard_cap, notify_email, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.name,
        input.scope,
        input.team_id ?? null,
        normalizedOwnerEmail,
        ownerUserId,
        Math.floor(input.monthly_budget_usd * 100) / 100,
        threshold,
        Boolean(input.approval_required),
        Boolean(input.hard_cap),
        input.notify_email || null,
        input.active !== false,
      ]
    );
    return mapBudgetRuleRows(res.rows)[0];
  } else {
    const state = getLocalState();
    if (!state.budget_rules) state.budget_rules = [];
    const record = {
      id: state.budget_rules.length + 1,
      name: input.name,
      scope: input.scope,
      team_id: input.team_id ?? null,
      owner_email: normalizedOwnerEmail,
      owner_user_id: ownerUserId,
      monthly_budget_usd: Math.floor(input.monthly_budget_usd * 100) / 100,
      alert_threshold_pct: threshold,
      approval_required: Boolean(input.approval_required),
      hard_cap: Boolean(input.hard_cap),
      notify_email: input.notify_email || null,
      active: input.active !== false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.budget_rules.push(record);
    saveLocalState(state);
    return { ...record };
  }
}

export async function getBudgetRule(id: number): Promise<BudgetRule | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM budget_rules WHERE id = $1 LIMIT 1`, [id]);
    if (res.rows.length === 0) return null;
    return mapBudgetRuleRows(res.rows)[0];
  } else {
    const state = getLocalState();
    return (state.budget_rules || []).find((r: any) => Number(r.id) === id) || null;
  }
}

/**
 * Rules the given user can see: their own personal rules plus rules of every
 * team they belong to. Uses owner_user_id as primary key (stable), with
 * owner_email as fallback for rows not yet migrated.
 */
export async function getBudgetRulesForUser(email: string, limit = 500): Promise<BudgetRule[]> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await getUserByEmail(normalizedEmail);
  const userId = user?.id || null;
  const max = Math.min(5000, Math.max(1, Math.floor(limit)));

  if (isPostgres()) {
    const pool = getPgPool();
    let res;
    if (userId) {
      // Primary path: use stable user_id FK
      res = await pool.query(
        `SELECT * FROM budget_rules
         WHERE owner_user_id = $1
            OR team_id IN (SELECT team_id FROM team_members WHERE member_email = $2)
         ORDER BY active DESC, id DESC
         LIMIT $3`,
        [userId, normalizedEmail, max]
      );
    } else {
      // Fallback: user not in DB yet, use email
      res = await pool.query(
        `SELECT * FROM budget_rules
         WHERE owner_email = $1
            OR team_id IN (SELECT team_id FROM team_members WHERE member_email = $1)
         ORDER BY active DESC, id DESC
         LIMIT $2`,
        [normalizedEmail, max]
      );
    }
    return mapBudgetRuleRows(res.rows);
  } else {
    const state = getLocalState();
    const teamIds = new Set(
      (state.team_members || [])
        .filter((m: any) => m.member_email === normalizedEmail)
        .map((m: any) => Number(m.team_id))
    );
    return (state.budget_rules || [])
      .filter((r: any) =>
        (userId ? r.owner_user_id === userId : r.owner_email === normalizedEmail) ||
        teamIds.has(Number(r.team_id))
      )
      .map(mapBudgetRuleRow)
      .sort((a: any, b: any) => Number(b.id) - Number(a.id))
      .slice(0, max);
  }
}

export async function getBudgetRulesForTeam(teamId: number): Promise<BudgetRule[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT * FROM budget_rules WHERE team_id = $1 ORDER BY active DESC, id DESC`,
      [teamId]
    );
    return mapBudgetRuleRows(res.rows);
  } else {
    const state = getLocalState();
    return (state.budget_rules || [])
      .filter((r: any) => Number(r.team_id) === teamId)
      .map(mapBudgetRuleRow);
  }
}

export async function getAllBudgetRules(limit = 200): Promise<BudgetRule[]> {
  const max = Math.min(500, Math.max(1, Math.floor(limit)));
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT * FROM budget_rules ORDER BY active DESC, id DESC LIMIT $1`,
      [max]
    );
    return mapBudgetRuleRows(res.rows);
  } else {
    const state = getLocalState();
    return (state.budget_rules || [])
      .sort((a: any, b: any) => Number(b.id) - Number(a.id))
      .slice(0, max)
      .map(mapBudgetRuleRow);
  }
}

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

// ─── SHADOW-AI DISCOVERY FEED (015_shadow_ai_findings) ─────────────
// Persistent per-scope findings for models outside the tracked catalog.
// Upserts preserve first_seen; acknowledged/dismissed rows are never
// re-opened by the runner — status changes are explicit via
// setShadowFindingStatus.

function mapShadowRows(rows: any[]): ShadowAiRecord[] {
  return rows.map((r: any) => ({
    id: Number(r.id),
    model_id: r.model_id,
    scope: r.scope,
    team_id: r.team_id !== null && r.team_id !== undefined ? Number(r.team_id) : null,
    owner_email: r.owner_email,
    owner_user_id: r.owner_user_id !== null && r.owner_user_id !== undefined ? Number(r.owner_user_id) : null,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    estimated_monthly_usd: Number(r.estimated_monthly_usd),
    reason: r.reason,
    status: r.status as ShadowFindingStatus,
    created_at: r.created_at,
  }));
}

function shadowKeyMatch(a: any, scope: string, teamId: number | null, ownerEmail: string): boolean {
  if (scope === 'team') {
    return a.scope === 'team' && Number(a.team_id) === Number(teamId);
  }
  return a.scope === 'personal' && String(a.owner_email).toLowerCase() === ownerEmail;
}

export async function upsertShadowFinding(input: {
  model_id: string;
  scope: BudgetRuleScope;
  team_id?: number | null;
  owner_email: string;
  estimated_monthly_usd: number;
  reason: string;
}): Promise<{ record: ShadowAiRecord; created: boolean }> {
  const modelId = input.model_id.trim();
  if (!modelId) throw new Error('model_id must be a non-empty string');
  const scope: BudgetRuleScope = input.scope === 'team' ? 'team' : 'personal';
  const teamId = scope === 'team' ? (input.team_id ?? null) : null;
  if (scope === 'team' && (teamId === null || !Number.isInteger(teamId) || teamId <= 0)) {
    throw new Error('team_id must be a positive integer for team findings');
  }
  const ownerEmail = input.owner_email.trim().toLowerCase();
  const spend = Math.max(0, Math.round(Number(input.estimated_monthly_usd || 0) * 100) / 100);
  const reason = input.reason.slice(0, 2000);

  if (isPostgres()) {
    const pool = getPgPool();
    const user = ownerEmail ? await getUserByEmail(ownerEmail) : null;
    const ownerUserId = user?.id || null;
    // Partial unique indexes (ux_shadow_personal / ux_shadow_team) enforce
    // one row per scope key; the upsert refreshes last_seen + estimate but
    // never touches first_seen, status, or created_at. The arbiter must
    // match the row's scope — a team insert would raise on the personal
    // arbiter instead of conflicting, so route explicitly.
    const conflictTarget = scope === 'team'
      ? `(model_id, team_id) WHERE scope = 'team'`
      : `(model_id, owner_email) WHERE scope = 'personal'`;
    const res = await pool.query(
      `INSERT INTO shadow_ai_findings
        (model_id, scope, team_id, owner_email, owner_user_id, estimated_monthly_usd, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ${conflictTarget}
       DO UPDATE SET last_seen = NOW(), estimated_monthly_usd = EXCLUDED.estimated_monthly_usd,
                     reason = EXCLUDED.reason
       RETURNING *, (xmax = 0) AS is_new`,
      [modelId, scope, teamId, ownerEmail, ownerUserId, spend, reason]
    );
    const row = mapShadowRows(res.rows)[0];
    return { record: row, created: res.rows[0]?.is_new === true };
  } else {
    const state = getLocalState();
    if (!state.shadow_ai_findings) state.shadow_ai_findings = [];
    const now = new Date().toISOString();
    const existing = (state.shadow_ai_findings as any[]).find((a: any) =>
      a.model_id === modelId && shadowKeyMatch(a, scope, teamId, ownerEmail)
    );
    if (existing) {
      existing.last_seen = now;
      existing.estimated_monthly_usd = spend;
      existing.reason = reason;
      saveLocalState(state);
      return { record: { ...existing }, created: false };
    }
    const record = {
      id: state.shadow_ai_findings.length + 1,
      model_id: modelId,
      scope,
      team_id: teamId,
      owner_email: ownerEmail,
      owner_user_id: null,
      first_seen: now,
      last_seen: now,
      estimated_monthly_usd: spend,
      reason,
      status: 'open' as ShadowFindingStatus,
      created_at: now,
    };
    state.shadow_ai_findings.push(record);
    saveLocalState(state);
    return { record: { ...record }, created: true };
  }
}

export async function getShadowFindings(opts: {
  email?: string;
  teamId?: number;
  status?: ShadowFindingStatus;
  limit?: number;
} = {}): Promise<ShadowAiRecord[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 100)));
  if (isPostgres()) {
    const pool = getPgPool();
    const where: string[] = [];
    const params: any[] = [];
    if (opts.email) {
      params.push(opts.email.trim().toLowerCase());
      where.push(`(owner_email = $${params.length} OR team_id IN (SELECT team_id FROM team_members WHERE member_email = $${params.length}))`);
    }
    if (opts.teamId !== undefined) {
      params.push(opts.teamId);
      where.push(`team_id = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const res = await pool.query(
      `SELECT * FROM shadow_ai_findings ${whereSql} ORDER BY last_seen DESC LIMIT $${params.length}`,
      params
    );
    return mapShadowRows(res.rows);
  } else {
    const state = getLocalState();
    const email = opts.email ? opts.email.trim().toLowerCase() : null;
    const teamIds = new Set(
      ((state.team_members || []) as any[])
        .filter((m: any) => email && m.member_email === email)
        .map((m: any) => Number(m.team_id))
    );
    return ((state.shadow_ai_findings || []) as any[])
      .filter((a: any) => {
        if (email && !(a.owner_email === email || (a.scope === 'team' && teamIds.has(Number(a.team_id))))) return false;
        if (opts.teamId !== undefined && Number(a.team_id) !== opts.teamId) return false;
        if (opts.status && a.status !== opts.status) return false;
        return true;
      })
      .sort((a: any, b: any) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime())
      .slice(0, limit)
      .map((a: any) => ({ ...a }));
  }
}

export async function setShadowFindingStatus(
  id: number,
  status: ShadowFindingStatus
): Promise<ShadowAiRecord | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  if (status !== 'open' && status !== 'acknowledged' && status !== 'dismissed') return null;
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE shadow_ai_findings SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (res.rows.length === 0) return null;
    return mapShadowRows(res.rows)[0];
  } else {
    const state = getLocalState();
    const row = ((state.shadow_ai_findings || []) as any[]).find((a: any) => Number(a.id) === id);
    if (!row) return null;
    row.status = status;
    saveLocalState(state);
    return { ...row };
  }
}

export async function createMigrationApproval(input: {
  team_id?: number | null;
  rule_id?: number | null;
  from_model_id: string;
  to_model_id: string;
  monthly_savings_usd: number;
  requested_by: string;
  quorum_required?: number;
}): Promise<MigrationApproval> {
  if (isPostgres()) {
    const pool = getPgPool();
    const quorum = Math.min(10, Math.max(1, Math.floor(input.quorum_required ?? 1)));
    const res = await pool.query(
      `INSERT INTO migration_approvals
        (team_id, rule_id, from_model_id, to_model_id, monthly_savings_usd, status, requested_by, quorum_required)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
       RETURNING *`,
      [
        input.team_id ?? null,
        input.rule_id ?? null,
        input.from_model_id,
        input.to_model_id,
        input.monthly_savings_usd,
        input.requested_by,
        quorum,
      ]
    );
    const r = res.rows[0];
    return {
      id: Number(r.id),
      team_id: r.team_id !== null ? Number(r.team_id) : null,
      rule_id: r.rule_id !== null ? Number(r.rule_id) : null,
      from_model_id: r.from_model_id,
      to_model_id: r.to_model_id,
      monthly_savings_usd: Number(r.monthly_savings_usd),
      status: r.status,
      requested_by: r.requested_by,
      reviewed_by: r.reviewed_by,
      decision_at: r.decision_at,
      quorum_required: Number(r.quorum_required ?? 1),
      created_at: r.created_at,
    };
  } else {
    const state = getLocalState();
    if (!state.migration_approvals) state.migration_approvals = [];
    const record = {
      id: state.migration_approvals.length + 1,
      team_id: input.team_id ?? null,
      rule_id: input.rule_id ?? null,
      from_model_id: input.from_model_id,
      to_model_id: input.to_model_id,
      monthly_savings_usd: input.monthly_savings_usd,
      status: 'pending' as const,
      requested_by: input.requested_by,
      reviewed_by: null,
      decision_at: null,
      quorum_required: Math.min(10, Math.max(1, Math.floor(input.quorum_required ?? 1))),
      created_at: new Date().toISOString(),
    };
    state.migration_approvals.push(record);
    saveLocalState(state);
    return { ...record };
  }
}

export async function getMigrationApprovals(opts: {
  teamId?: number;
  status?: string;
  ruleIds?: number[];
  limit?: number;
} = {}): Promise<MigrationApproval[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 50)));
  if (isPostgres()) {
    const pool = getPgPool();
    const where: string[] = [];
    const params: any[] = [];
    if (opts.teamId !== undefined && opts.teamId !== null) {
      params.push(opts.teamId);
      where.push(`team_id = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`status = $${params.length}`);
    }
    if (opts.ruleIds && opts.ruleIds.length > 0) {
      params.push(opts.ruleIds);
      where.push(`rule_id = ANY($${params.length}::int[])`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const res = await pool.query(
      `SELECT * FROM migration_approvals ${whereSql} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return res.rows.map((r: any) => ({
      id: Number(r.id),
      team_id: r.team_id !== null ? Number(r.team_id) : null,
      rule_id: r.rule_id !== null ? Number(r.rule_id) : null,
      from_model_id: r.from_model_id,
      to_model_id: r.to_model_id,
      monthly_savings_usd: Number(r.monthly_savings_usd),
      status: r.status,
      requested_by: r.requested_by,
      reviewed_by: r.reviewed_by,
      decision_at: r.decision_at,
      quorum_required: Number(r.quorum_required ?? 1),
      created_at: r.created_at,
    }));
  } else {
    const state = getLocalState();
    return (state.migration_approvals || [])
      .filter((a: any) => opts.teamId === undefined || opts.teamId === null || Number(a.team_id) === opts.teamId)
      .filter((a: any) => !opts.status || a.status === opts.status)
      .filter((a: any) => !opts.ruleIds || opts.ruleIds.length === 0 || opts.ruleIds.includes(Number(a.rule_id)))
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit)
      .map((a: any) => ({ ...a }));
  }
}

export async function decideMigrationApproval(
  id: number,
  decision: 'approved' | 'rejected',
  reviewedBy: string
): Promise<MigrationApproval | null> {
  if (isPostgres()) {
      const pool = getPgPool();
      // Optimistic guard: only pending rows transition. Concurrent
      // approve/reject races resolve to exactly one winner; losers get null.
      const res = await pool.query(
        `UPDATE migration_approvals
         SET status = $2, reviewed_by = $3, decision_at = NOW()
         WHERE id = $1 AND status = 'pending'
         RETURNING *`,
        [id, decision, reviewedBy]
      );
      if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: Number(r.id),
      team_id: r.team_id !== null ? Number(r.team_id) : null,
      rule_id: r.rule_id !== null ? Number(r.rule_id) : null,
      from_model_id: r.from_model_id,
      to_model_id: r.to_model_id,
      monthly_savings_usd: Number(r.monthly_savings_usd),
      status: r.status,
      requested_by: r.requested_by,
      reviewed_by: r.reviewed_by,
      decision_at: r.decision_at,
      quorum_required: Number(r.quorum_required ?? 1),
      created_at: r.created_at,
    };
  } else {
      const state = getLocalState();
      const match = (state.migration_approvals || []).find((a: any) => Number(a.id) === id);
      if (!match || match.status !== 'pending') return null;
      match.status = decision;
      match.reviewed_by = reviewedBy;
      match.decision_at = new Date().toISOString();
      saveLocalState(state);
      return { ...match };
  }
}

// ─── QUORUM VOTING (016_approval_quorum) ────────────────────────────
// M-of-N ballots on migration approvals. castApprovalVote is atomic per
// backend: Postgres locks the approval row inside a transaction so two
// concurrent deciding votes cannot both "win"; the local backend is
// single-writer and synchronous.

function mapApprovalVoteRows(rows: any[]): ApprovalVote[] {
  return rows.map((r: any) => ({
    id: Number(r.id),
    approval_id: Number(r.approval_id),
    voter_email: r.voter_email,
    voter_user_id: r.voter_user_id !== null && r.voter_user_id !== undefined ? Number(r.voter_user_id) : null,
    decision: r.decision as ApprovalVoteDecision,
    created_at: r.created_at,
  }));
}

function mapApprovalRow(r: any): MigrationApproval {
  return {
    id: Number(r.id),
    team_id: r.team_id !== null && r.team_id !== undefined ? Number(r.team_id) : null,
    rule_id: r.rule_id !== null && r.rule_id !== undefined ? Number(r.rule_id) : null,
    from_model_id: r.from_model_id,
    to_model_id: r.to_model_id,
    monthly_savings_usd: Number(r.monthly_savings_usd),
    status: r.status,
    requested_by: r.requested_by,
    reviewed_by: r.reviewed_by ?? null,
    decision_at: r.decision_at ?? null,
    quorum_required: Number(r.quorum_required ?? 1),
    created_at: r.created_at,
  };
}

export async function getApprovalVotes(approvalId: number): Promise<ApprovalVote[]> {
  if (!Number.isInteger(approvalId) || approvalId <= 0) return [];
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT * FROM approval_votes WHERE approval_id = $1 ORDER BY created_at ASC, id ASC`,
      [approvalId]
    );
    return mapApprovalVoteRows(res.rows);
  } else {
    const state = getLocalState();
    return ((state.approval_votes || []) as any[])
      .filter((v: any) => Number(v.approval_id) === approvalId)
      .sort((a: any, b: any) => Number(a.id) - Number(b.id))
      .map((v: any) => ({ ...v }));
  }
}

export type CastVoteOutcome =
  | 'recorded'
  | 'decided-approved'
  | 'decided-rejected'
  | 'duplicate'
  | 'closed'
  | 'not-found';

export async function castApprovalVote(
  approvalId: number,
  voterEmail: string,
  decision: ApprovalVoteDecision
): Promise<{ outcome: CastVoteOutcome; vote: ApprovalVote | null; approval: MigrationApproval | null }> {
  if (!Number.isInteger(approvalId) || approvalId <= 0) {
    return { outcome: 'not-found', vote: null, approval: null };
  }
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new Error('decision must be "approved" or "rejected"');
  }
  const email = voterEmail.trim().toLowerCase();
  if (!email) throw new Error('voter email is required');

  if (isPostgres()) {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT * FROM migration_approvals WHERE id = $1 FOR UPDATE`,
        [approvalId]
      );
      if (locked.rows.length === 0) {
        await client.query('ROLLBACK');
        return { outcome: 'not-found', vote: null, approval: null };
      }
      const approval = mapApprovalRow(locked.rows[0]);
      if (approval.status !== 'pending') {
        await client.query('ROLLBACK');
        return { outcome: 'closed', vote: null, approval };
      }
      const user = await getUserByEmail(email);
      const inserted = await client.query(
        `INSERT INTO approval_votes (approval_id, voter_email, voter_user_id, decision)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (approval_id, voter_email) DO NOTHING
         RETURNING *`,
        [approvalId, email, user?.id || null, decision]
      );
      if (inserted.rows.length === 0) {
        await client.query('ROLLBACK');
        return { outcome: 'duplicate', vote: null, approval };
      }
      const vote = mapApprovalVoteRows(inserted.rows)[0];
      const tally = await client.query(
        `SELECT decision FROM approval_votes WHERE approval_id = $1`,
        [approvalId]
      );
      const outcome = tallyVotes(
        tally.rows.map((r: any) => r.decision as ApprovalVoteDecision),
        approval.quorum_required
      );
      if (outcome === 'pending') {
        await client.query('COMMIT');
        return { outcome: 'recorded', vote, approval };
      }
      const finalized = await client.query(
        `UPDATE migration_approvals
         SET status = $2, reviewed_by = $3, decision_at = NOW()
         WHERE id = $1 RETURNING *`,
        [approvalId, outcome, email]
      );
      await client.query('COMMIT');
      return {
        outcome: outcome === 'approved' ? 'decided-approved' : 'decided-rejected',
        vote,
        approval: mapApprovalRow(finalized.rows[0]),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    const state = getLocalState();
    if (!state.approval_votes) state.approval_votes = [];
    const match = (state.migration_approvals || []).find((a: any) => Number(a.id) === approvalId);
    if (!match) return { outcome: 'not-found', vote: null, approval: null };
    if (match.status !== 'pending') {
      return { outcome: 'closed', vote: null, approval: { ...match } };
    }
    const dup = (state.approval_votes as any[]).some(
      (v: any) => Number(v.approval_id) === approvalId && String(v.voter_email).toLowerCase() === email
    );
    if (dup) {
      return { outcome: 'duplicate', vote: null, approval: { ...match } };
    }
    const now = new Date().toISOString();
    const voteRecord = {
      id: state.approval_votes.length + 1,
      approval_id: approvalId,
      voter_email: email,
      voter_user_id: null,
      decision,
      created_at: now,
    };
    (state.approval_votes as any[]).push(voteRecord);
    const decisions = (state.approval_votes as any[])
      .filter((v: any) => Number(v.approval_id) === approvalId)
      .map((v: any) => v.decision as ApprovalVoteDecision);
    const outcome = tallyVotes(decisions, Number(match.quorum_required ?? 1));
    if (outcome !== 'pending') {
      match.status = outcome;
      match.reviewed_by = email;
      match.decision_at = now;
    }
    saveLocalState(state);
    return {
      outcome: outcome === 'pending' ? 'recorded' : outcome === 'approved' ? 'decided-approved' : 'decided-rejected',
      vote: { ...voteRecord },
      approval: { ...match },
    };
  }
}
