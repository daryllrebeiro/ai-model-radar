/**
 * R5 persistence: per-user usage imports. Scoped strictly to the uploading
 * user (user_id); reads/writes never cross users. No aggregation queries
 * exist here by design — this data must never feed leaderboards (R7)
 * without separate explicit consent.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import type { UsageImportRow } from '../usage-import';

export interface UsageImportRecord {
  id: number;
  user_id: number | null;
  owner_email: string;
  source: string;
  filename: string;
  period_start: string | null;
  period_end: string | null;
  row_count: number;
  total_spend_usd: number;
  rows: UsageImportRow[];
  created_at: string;
}

function toRecord(r: any): UsageImportRecord {
  return {
    id: Number(r.id),
    user_id: r.user_id !== null && r.user_id !== undefined ? Number(r.user_id) : null,
    owner_email: r.owner_email,
    source: r.source || 'csv',
    filename: r.filename || '',
    period_start: r.period_start || null,
    period_end: r.period_end || null,
    row_count: Number(r.row_count || 0),
    total_spend_usd: Number(r.total_spend_usd || 0),
    rows: typeof r.rows_json === 'string' ? JSON.parse(r.rows_json) : r.rows_json || [],
    created_at: r.created_at,
  };
}

export async function createUsageImport(input: {
  userId: number;
  ownerEmail: string;
  source?: string;
  filename?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  rows: UsageImportRow[];
  totalSpendUsd: number;
}): Promise<UsageImportRecord> {
  const rowsJson = JSON.stringify(input.rows);
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO usage_imports (user_id, owner_email, source, filename, period_start, period_end, row_count, total_spend_usd, rows_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        input.userId,
        input.ownerEmail,
        input.source || 'csv',
        (input.filename || '').slice(0, 255),
        input.periodStart || null,
        input.periodEnd || null,
        input.rows.length,
        input.totalSpendUsd,
        rowsJson,
      ]
    );
    return toRecord(res.rows[0]);
  }
  const state = getLocalState();
  const row = {
    id: state.usage_imports.length + 1,
    user_id: input.userId,
    owner_email: input.ownerEmail,
    source: input.source || 'csv',
    filename: (input.filename || '').slice(0, 255),
    period_start: input.periodStart || null,
    period_end: input.periodEnd || null,
    row_count: input.rows.length,
    total_spend_usd: input.totalSpendUsd,
    rows_json: input.rows,
    created_at: new Date().toISOString(),
  };
  state.usage_imports.push(row);
  saveLocalState(state);
  return toRecord(row);
}

export async function listUsageImports(userId: number): Promise<UsageImportRecord[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT id, user_id, owner_email, source, filename, period_start, period_end, row_count, total_spend_usd, created_at
       FROM usage_imports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );
    return res.rows.map((r: any) => ({ ...toRecord({ ...r, rows_json: [] }), rows: [] }));
  }
  const state = getLocalState();
  return state.usage_imports
    .filter((r: any) => Number(r.user_id) === Number(userId))
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50)
    .map((r: any) => ({ ...toRecord(r), rows: [] }));
}

export async function getUsageImport(userId: number, id: number): Promise<UsageImportRecord | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM usage_imports WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (res.rows.length === 0) return null;
    return toRecord(res.rows[0]);
  }
  const state = getLocalState();
  const found = state.usage_imports.find((r: any) => Number(r.id) === Number(id) && Number(r.user_id) === Number(userId));
  return found ? toRecord(found) : null;
}

export async function deleteUsageImport(userId: number, id: number): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`DELETE FROM usage_imports WHERE id = $1 AND user_id = $2`, [id, userId]);
    return (res.rowCount || 0) > 0;
  }
  const state = getLocalState();
  const before = state.usage_imports.length;
  state.usage_imports = state.usage_imports.filter(
    (r: any) => !(Number(r.id) === Number(id) && Number(r.user_id) === Number(userId))
  );
  if (state.usage_imports.length !== before) {
    saveLocalState(state);
    return true;
  }
  return false;
}
