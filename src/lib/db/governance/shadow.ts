/**
 * Shadow-AI discovery feed (015_shadow_ai_findings): persistent per-scope
 * findings for models outside the tracked catalog. Upserts preserve
 * first_seen; acknowledged/dismissed rows are never re-opened by the
 * runner — status changes are explicit via setShadowFindingStatus.
 * Split out of db/governance.ts (P0 god-module remediation, first cut) —
 * same logic, new home. db/governance.ts re-exports everything, so no
 * caller changes.
 */
import { BudgetRuleScope, ShadowAiRecord, ShadowFindingStatus } from '@/types/governance';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from '../client';
import { getUserByEmail } from '../users';

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
