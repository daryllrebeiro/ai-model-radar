/**
 * Model end-of-life registry: register, list, delete.
 * Split out of queries.ts (god-module remediation) - same logic, new home.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';

export interface EolRecord {
  model_id: string;
  announced_at?: string;
  eol_at: string;
  source?: string | null;
  notes?: string | null;
  created_by_email?: string | null;
  created_at?: string;
  updated_at?: string;
}

function mapEolRows(rows: any[]): EolRecord[] {
  return rows.map((r: any) => ({
    model_id: r.model_id,
    announced_at: r.announced_at,
    eol_at: r.eol_at,
    source: r.source ?? null,
    notes: r.notes ?? null,
    created_by_email: r.created_by_email ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export async function registerEol(input: {
  model_id: string;
  eol_at: string;
  announced_at?: string;
  source?: string | null;
  notes?: string | null;
  created_by_email?: string | null;
}): Promise<EolRecord> {
  const modelId = input.model_id.trim();
  if (!modelId) throw new Error('model_id is required');
  const eolMs = new Date(input.eol_at).getTime();
  if (!Number.isFinite(eolMs)) throw new Error('eol_at must be a valid date');
  const announcedMs = input.announced_at ? new Date(input.announced_at).getTime() : Date.now();
  if (!Number.isFinite(announcedMs)) throw new Error('announced_at must be a valid date');
  if (eolMs <= announcedMs) throw new Error('eol_at must be after announced_at');

  const eolIso = new Date(eolMs).toISOString();
  const announcedIso = new Date(announcedMs).toISOString();
  const source = (input.source || '').slice(0, 1000);
  const notes = (input.notes || '').slice(0, 4000);
  const byEmail = (input.created_by_email || '').trim().toLowerCase().slice(0, 255);

  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO model_eol (model_id, announced_at, eol_at, source, notes, created_by_email)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (model_id) DO UPDATE SET
         announced_at = EXCLUDED.announced_at,
         eol_at = EXCLUDED.eol_at,
         source = EXCLUDED.source,
         notes = EXCLUDED.notes,
         created_by_email = EXCLUDED.created_by_email,
         updated_at = NOW()
       RETURNING *`,
      [modelId, announcedIso, eolIso, source, notes, byEmail]
    );
    return mapEolRows(res.rows)[0];
  } else {
    const state = getLocalState();
    if (!state.model_eol) state.model_eol = [];
    const now = new Date().toISOString();
    const existing = (state.model_eol as any[]).find((r: any) => r.model_id === modelId);
    if (existing) {
      existing.announced_at = announcedIso;
      existing.eol_at = eolIso;
      existing.source = source;
      existing.notes = notes;
      existing.created_by_email = byEmail;
      existing.updated_at = now;
      saveLocalState(state);
      return { ...existing };
    }
    const record = {
      model_id: modelId,
      announced_at: announcedIso,
      eol_at: eolIso,
      source,
      notes,
      created_by_email: byEmail,
      created_at: now,
      updated_at: now,
    };
    state.model_eol.push(record);
    saveLocalState(state);
    return { ...record };
  }
}

export async function getEolRegistry(): Promise<EolRecord[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM model_eol ORDER BY eol_at ASC`);
    return mapEolRows(res.rows);
  } else {
    const state = getLocalState();
    return ((state.model_eol || []) as any[])
      .slice()
      .sort((a: any, b: any) => new Date(a.eol_at).getTime() - new Date(b.eol_at).getTime())
      .map((r: any) => ({ ...r }));
  }
}

export async function deleteEol(modelId: string): Promise<boolean> {
  const id = modelId.trim();
  if (!id) return false;
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`DELETE FROM model_eol WHERE model_id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  } else {
    const state = getLocalState();
    const before = (state.model_eol || []).length;
    state.model_eol = ((state.model_eol || []) as any[]).filter((r: any) => r.model_id !== id);
    if (state.model_eol.length === before) return false;
    saveLocalState(state);
    return true;
  }
}
