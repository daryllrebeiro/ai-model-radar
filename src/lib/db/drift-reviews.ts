/**
 * Drift review queue (P3): human decision surface for S4 candidates.
 * Only candidate_for_review diffs are stored, WITH full before/after text.
 * Status transitions pending -> confirmed/dismissed happen by reviewer
 * action only — there is intentionally no code path that auto-confirms.
 */
import { DriftDiff } from '@/types/active-probe';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';

export type DriftReviewStatus = 'pending' | 'confirmed' | 'dismissed';

export interface DriftReview {
  id?: number;
  cycle_id: string;
  model_id: string;
  prompt_id: string;
  prompt_version: number;
  prev_output: string;
  curr_output: string;
  diff_lines: string[];
  changed_lines: number;
  status: DriftReviewStatus;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at?: string;
}

/** Persists candidate diffs from a cycle. Non-candidates are never stored. */
export async function recordDriftCandidates(cycleId: string, diffs: DriftDiff[]): Promise<number> {
  const candidates = diffs.filter((d) => d.candidate_for_review);
  if (candidates.length === 0) return 0;
  if (isPostgres()) {
    const pool = getPgPool();
    for (const d of candidates) {
      await pool.query(
        `INSERT INTO drift_reviews
          (cycle_id, model_id, prompt_id, prompt_version, prev_output, curr_output, diff_lines, changed_lines, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
         ON CONFLICT (cycle_id, model_id, prompt_id) DO NOTHING`,
        [cycleId, d.model_id, d.prompt_id, d.current.prompt_version, d.previous.output, d.current.output, JSON.stringify(d.diff_lines), d.changed_lines]
      );
    }
  } else {
    const state = getLocalState();
    if (!state.drift_reviews) state.drift_reviews = [];
    for (const d of candidates) {
      const exists = state.drift_reviews.some(
        (r: any) => r.cycle_id === cycleId && r.model_id === d.model_id && r.prompt_id === d.prompt_id
      );
      if (exists) continue;
      state.drift_reviews.push({
        id: state.drift_reviews.length + 1,
        cycle_id: cycleId,
        model_id: d.model_id,
        prompt_id: d.prompt_id,
        prompt_version: d.current.prompt_version,
        prev_output: d.previous.output,
        curr_output: d.current.output,
        diff_lines: d.diff_lines,
        changed_lines: d.changed_lines,
        status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        created_at: new Date().toISOString(),
      });
    }
    saveLocalState(state);
  }
  return candidates.length;
}

export async function listDriftReviews(status?: DriftReviewStatus, limit = 50): Promise<DriftReview[]> {
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  if (isPostgres()) {
    const pool = getPgPool();
    const res = status
      ? await pool.query(`SELECT * FROM drift_reviews WHERE status = $1 ORDER BY created_at DESC LIMIT $2`, [status, safeLimit])
      : await pool.query(`SELECT * FROM drift_reviews ORDER BY created_at DESC LIMIT $1`, [safeLimit]);
    return res.rows.map((r: any) => ({
      ...r,
      diff_lines: typeof r.diff_lines === 'string' ? JSON.parse(r.diff_lines) : r.diff_lines,
    }));
  }
  const state = getLocalState();
  return (state.drift_reviews || [])
    .filter((r: any) => !status || r.status === status)
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, safeLimit);
}

/** Reviewer action. Only pending rows transition; anything else is a 409. */
export async function decideDriftReview(id: number, decision: 'confirmed' | 'dismissed', reviewer: string): Promise<boolean> {
  if (!reviewer || reviewer.trim().length === 0) throw new Error('Reviewer identity is required.');
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE drift_reviews SET status = $1, reviewed_by = $2, reviewed_at = NOW()
        WHERE id = $3 AND status = 'pending'`,
      [decision, reviewer, id]
    );
    return (res.rowCount || 0) > 0;
  }
  const state = getLocalState();
  const row = (state.drift_reviews || []).find((r: any) => r.id === id);
  if (!row || row.status !== 'pending') return false;
  row.status = decision;
  row.reviewed_by = reviewer;
  row.reviewed_at = new Date().toISOString();
  saveLocalState(state);
  return true;
}
