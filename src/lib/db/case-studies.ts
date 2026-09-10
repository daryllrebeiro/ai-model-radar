/**
 * R7 persistence: opt-in case studies with a moderation queue.
 * - Submissions land as 'pending' (never public on write).
 * - Only 'approved' rows are publicly listed.
 * - Owner takedown and moderation removal flip to 'removed' (row kept for
 *   audit, never listed). Consent is per-submission and recorded.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';

export type CaseStudyStatus = 'pending' | 'approved' | 'rejected' | 'removed';

export interface CaseStudyRecord {
  id: number;
  user_id: number | null;
  owner_email: string;
  team_name: string;
  from_model_id: string;
  to_model_id: string;
  savings_usd_per_month: number;
  period_label: string;
  story: string;
  usage_import_id: number | null;
  consent_confirmed: boolean;
  status: CaseStudyStatus;
  reviewed_at: string | null;
  created_at: string;
}

function toRecord(r: any): CaseStudyRecord {
  return {
    id: Number(r.id),
    user_id: r.user_id !== null && r.user_id !== undefined ? Number(r.user_id) : null,
    owner_email: r.owner_email,
    team_name: r.team_name || '',
    from_model_id: r.from_model_id,
    to_model_id: r.to_model_id,
    savings_usd_per_month: Number(r.savings_usd_per_month || 0),
    period_label: r.period_label || '',
    story: r.story || '',
    usage_import_id: r.usage_import_id !== null && r.usage_import_id !== undefined ? Number(r.usage_import_id) : null,
    consent_confirmed: Boolean(r.consent_confirmed),
    status: r.status,
    reviewed_at: r.reviewed_at || null,
    created_at: r.created_at,
  };
}

const PUBLIC_COLUMNS = `id, team_name, from_model_id, to_model_id, savings_usd_per_month,
  period_label, story, created_at`;

export async function createCaseStudy(input: {
  userId: number;
  ownerEmail: string;
  teamName?: string;
  fromModelId: string;
  toModelId: string;
  savingsUsdPerMonth: number;
  periodLabel?: string;
  story?: string;
  usageImportId?: number | null;
}): Promise<CaseStudyRecord> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO case_studies (user_id, owner_email, team_name, from_model_id, to_model_id,
        savings_usd_per_month, period_label, story, usage_import_id, consent_confirmed, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,'pending') RETURNING *`,
      [
        input.userId,
        input.ownerEmail,
        (input.teamName || '').slice(0, 120),
        input.fromModelId.slice(0, 200),
        input.toModelId.slice(0, 200),
        input.savingsUsdPerMonth,
        (input.periodLabel || '').slice(0, 60),
        (input.story || '').slice(0, 5000),
        input.usageImportId || null,
      ]
    );
    return toRecord(res.rows[0]);
  }
  const state = getLocalState();
  const row = {
    id: state.case_studies.length + 1,
    user_id: input.userId,
    owner_email: input.ownerEmail,
    team_name: (input.teamName || '').slice(0, 120),
    from_model_id: input.fromModelId.slice(0, 200),
    to_model_id: input.toModelId.slice(0, 200),
    savings_usd_per_month: input.savingsUsdPerMonth,
    period_label: (input.periodLabel || '').slice(0, 60),
    story: (input.story || '').slice(0, 5000),
    usage_import_id: input.usageImportId || null,
    consent_confirmed: true,
    status: 'pending' as CaseStudyStatus,
    reviewed_at: null,
    created_at: new Date().toISOString(),
  };
  state.case_studies.push(row);
  saveLocalState(state);
  return toRecord(row);
}

/** Public leaderboard: approved only, owner emails never exposed. */
export async function listApprovedCaseStudies(limit = 50): Promise<Omit<CaseStudyRecord, 'owner_email' | 'user_id' | 'usage_import_id'>[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM case_studies
       WHERE status = 'approved' AND consent_confirmed = TRUE
       ORDER BY savings_usd_per_month DESC, created_at DESC LIMIT $1`,
      [safeLimit]
    );
    return res.rows.map((r: any) => ({
      id: Number(r.id),
      team_name: r.team_name || '',
      from_model_id: r.from_model_id,
      to_model_id: r.to_model_id,
      savings_usd_per_month: Number(r.savings_usd_per_month || 0),
      period_label: r.period_label || '',
      story: r.story || '',
      status: 'approved' as CaseStudyStatus,
      consent_confirmed: true,
      reviewed_at: null,
      created_at: r.created_at,
    }));
  }
  const state = getLocalState();
  return state.case_studies
    .filter((r: any) => r.status === 'approved' && r.consent_confirmed === true)
    .sort((a: any, b: any) => Number(b.savings_usd_per_month || 0) - Number(a.savings_usd_per_month || 0))
    .slice(0, safeLimit)
    .map((r: any) => {
      const full = toRecord(r);
      const { owner_email, user_id, usage_import_id, ...pub } = full;
      void owner_email; void user_id; void usage_import_id;
      return pub;
    });
}

/** Owner's own submissions (all statuses) for manage/takedown. */
export async function listOwnCaseStudies(userId: number): Promise<CaseStudyRecord[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM case_studies WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
    return res.rows.map(toRecord);
  }
  const state = getLocalState();
  return state.case_studies.filter((r: any) => Number(r.user_id) === Number(userId)).map(toRecord);
}

/** Owner takedown: pending/approved → removed. */
export async function takedownCaseStudy(userId: number, id: number): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE case_studies SET status = 'removed', reviewed_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status IN ('pending','approved')`,
      [id, userId]
    );
    return (res.rowCount || 0) > 0;
  }
  const state = getLocalState();
  const found = state.case_studies.find(
    (r: any) => Number(r.id) === Number(id) && Number(r.user_id) === Number(userId) &&
      (r.status === 'pending' || r.status === 'approved')
  );
  if (!found) return false;
  found.status = 'removed';
  found.reviewed_at = new Date().toISOString();
  saveLocalState(state);
  return true;
}

/** Moderation queue (pending) — reviewed via ADMIN_SECRET-gated endpoints. */
export async function listPendingCaseStudies(limit = 50): Promise<CaseStudyRecord[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT * FROM case_studies WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1`,
      [safeLimit]
    );
    return res.rows.map(toRecord);
  }
  const state = getLocalState();
  return state.case_studies.filter((r: any) => r.status === 'pending').slice(0, safeLimit).map(toRecord);
}

export async function moderateCaseStudy(
  id: number,
  decision: 'approved' | 'rejected' | 'removed'
): Promise<CaseStudyRecord | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE case_studies SET status = $1, reviewed_at = NOW() WHERE id = $2 RETURNING *`,
      [decision, id]
    );
    if (res.rows.length === 0) return null;
    return toRecord(res.rows[0]);
  }
  const state = getLocalState();
  const found = state.case_studies.find((r: any) => Number(r.id) === Number(id));
  if (!found) return null;
  found.status = decision;
  found.reviewed_at = new Date().toISOString();
  saveLocalState(state);
  return toRecord(found);
}
