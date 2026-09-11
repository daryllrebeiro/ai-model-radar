/**
 * Budget rules: personal/team spend guardrails.
 * Split out of db/governance.ts (P0 god-module remediation, first cut) —
 * same logic, new home. db/governance.ts re-exports everything, so no
 * caller changes.
 */
import { BudgetRule, BudgetRuleScope } from '@/types/governance';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from '../client';
import { getUserByEmail } from '../users';

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
