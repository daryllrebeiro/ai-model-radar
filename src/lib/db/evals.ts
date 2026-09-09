/**
 * BYO eval harness: user-submitted benchmark runs and leaderboard reads.
 * Split out of queries.ts (god-module remediation) - same logic, new home.
 */
import { BudgetRuleScope } from '@/types/governance';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { getUserByEmail } from './users';

// ─── BYO EVAL HARNESS (020_eval_runs) ─────────────────────────────────
// User-submitted benchmark runs, one row per run. Scores JSON is validated
// by src/lib/evals.ts before insert; aggregation is client-side (portable).

export interface EvalRunRecord {
  id?: number;
  suite: string;
  model_id: string;
  scope: BudgetRuleScope;
  team_id?: number | null;
  owner_email: string;
  owner_user_id?: number | null;
  scores: Record<string, number>;
  samples: number;
  notes?: string | null;
  created_at?: string;
}

function mapEvalRows(rows: any[]): EvalRunRecord[] {
  return rows.map((r: any) => {
    let scores: Record<string, number> = {};
    try {
      const parsed = typeof r.scores === 'string' ? JSON.parse(r.scores) : r.scores;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) scores = parsed;
    } catch {
      scores = {};
    }
    return {
      id: Number(r.id),
      suite: r.suite,
      model_id: r.model_id,
      scope: r.scope,
      team_id: r.team_id !== null && r.team_id !== undefined ? Number(r.team_id) : null,
      owner_email: r.owner_email,
      owner_user_id: r.owner_user_id !== null && r.owner_user_id !== undefined ? Number(r.owner_user_id) : null,
      scores,
      samples: Number(r.samples),
      notes: r.notes ?? null,
      created_at: r.created_at,
    };
  });
}

export async function submitEvalRun(input: {
  suite: string;
  model_id: string;
  scope: BudgetRuleScope;
  team_id?: number | null;
  owner_email: string;
  scores: Record<string, number>;
  samples?: number;
  notes?: string | null;
}): Promise<EvalRunRecord> {
  const scope: BudgetRuleScope = input.scope === 'team' ? 'team' : 'personal';
  const teamId = scope === 'team' ? (input.team_id ?? null) : null;
  if (scope === 'team' && (teamId === null || !Number.isInteger(teamId) || teamId <= 0)) {
    throw new Error('team_id must be a positive integer for team eval runs');
  }
  const samples = Math.min(100_000, Math.max(1, Math.floor(input.samples ?? 1)));
  const notes = (input.notes || '').slice(0, 4000);
  const ownerEmail = input.owner_email.trim().toLowerCase();
  const scoresJson = JSON.stringify(input.scores);

  if (isPostgres()) {
    const pool = getPgPool();
    const user = ownerEmail ? await getUserByEmail(ownerEmail) : null;
    const res = await pool.query(
      `INSERT INTO eval_runs
        (suite, model_id, scope, team_id, owner_email, owner_user_id, scores, samples, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.suite,
        input.model_id,
        scope,
        teamId,
        ownerEmail,
        user?.id || null,
        scoresJson,
        samples,
        notes,
      ]
    );
    return mapEvalRows(res.rows)[0];
  } else {
    const state = getLocalState();
    if (!state.eval_runs) state.eval_runs = [];
    const record = {
      id: state.eval_runs.length + 1,
      suite: input.suite,
      model_id: input.model_id,
      scope,
      team_id: teamId,
      owner_email: ownerEmail,
      owner_user_id: null,
      scores: scoresJson,
      samples,
      notes,
      created_at: new Date().toISOString(),
    };
    state.eval_runs.push(record);
    saveLocalState(state);
    return mapEvalRows([record])[0];
  }
}

export async function getEvalRuns(opts: {
  suite?: string;
  teamId?: number;
  email?: string;
  limit?: number;
} = {}): Promise<EvalRunRecord[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 100)));
  if (isPostgres()) {
    const pool = getPgPool();
    const where: string[] = [];
    const params: any[] = [];
    if (opts.suite) {
      params.push(opts.suite);
      where.push(`suite = $${params.length}`);
    }
    if (opts.teamId !== undefined) {
      params.push(opts.teamId);
      where.push(`team_id = $${params.length}`);
    }
    if (opts.email) {
      params.push(opts.email.trim().toLowerCase());
      where.push(`(owner_email = $${params.length} OR team_id IN (SELECT team_id FROM team_members WHERE member_email = $${params.length}))`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);
    const res = await pool.query(
      `SELECT * FROM eval_runs ${whereSql} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params
    );
    return mapEvalRows(res.rows);
  } else {
    const state = getLocalState();
    const email = opts.email ? opts.email.trim().toLowerCase() : null;
    const teamIds = new Set(
      ((state.team_members || []) as any[])
        .filter((m: any) => email && m.member_email === email)
        .map((m: any) => Number(m.team_id))
    );
    return ((state.eval_runs || []) as any[])
      .filter((r: any) => {
        if (opts.suite && r.suite !== opts.suite) return false;
        if (opts.teamId !== undefined && Number(r.team_id) !== opts.teamId) return false;
        if (email && !(r.owner_email === email || (r.scope === 'team' && teamIds.has(Number(r.team_id))))) return false;
        return true;
      })
      .sort((a: any, b: any) => Number(b.id) - Number(a.id))
      .slice(0, limit)
      .map((r: any) => mapEvalRows([r])[0]);
  }
}

// ─── MODEL EOL REGISTRY (018_model_eol) ─────────────────────────────
// Announced retirement dates, one row per model. Re-announcements upsert
// (model_id PK). Removal observation comes from the MODEL_REMOVED event
// stream, not this table.
