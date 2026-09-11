/**
 * Migration approvals with quorum voting (016_approval_quorum): M-of-N
 * ballots on migration switches. castApprovalVote is atomic per backend:
 * Postgres locks the approval row inside a transaction so two concurrent
 * deciding votes cannot both "win"; the local backend is single-writer
 * and synchronous.
 * Split out of db/governance.ts (P0 god-module remediation, first cut) —
 * same logic, new home. db/governance.ts re-exports everything, so no
 * caller changes.
 */
import { MigrationApproval, ApprovalVote, ApprovalVoteDecision } from '@/types/governance';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from '../client';
import { getUserByEmail } from '../users';
import { tallyVotes } from '../../quorum';

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
