/**
 * R6 persistence: user-scoped compound rules, both backends.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import type { CompoundCondition, CompoundLogic } from '../compound-rules';

export interface CompoundRuleRecord {
  id: number;
  user_id: number | null;
  owner_email: string;
  name: string;
  logic: CompoundLogic;
  conditions: CompoundCondition[];
  channel: 'webhook' | 'email';
  destination: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function toRecord(r: any): CompoundRuleRecord {
  return {
    id: Number(r.id),
    user_id: r.user_id !== null && r.user_id !== undefined ? Number(r.user_id) : null,
    owner_email: r.owner_email,
    name: r.name,
    logic: r.logic === 'or' ? 'or' : 'and',
    conditions: typeof r.conditions === 'string' ? JSON.parse(r.conditions) : r.conditions || [],
    channel: r.channel === 'email' ? 'email' : 'webhook',
    destination: r.destination,
    active: Boolean(r.active),
    created_at: r.created_at,
    updated_at: r.updated_at || r.created_at,
  };
}

export async function createCompoundRule(input: {
  userId: number;
  ownerEmail: string;
  name: string;
  logic: CompoundLogic;
  conditions: CompoundCondition[];
  channel: 'webhook' | 'email';
  destination: string;
}): Promise<CompoundRuleRecord> {
  const condJson = JSON.stringify(input.conditions);
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO compound_rules (user_id, owner_email, name, logic, conditions, channel, destination)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.userId, input.ownerEmail, input.name.slice(0, 120), input.logic, condJson, input.channel, input.destination]
    );
    return toRecord(res.rows[0]);
  }
  const state = getLocalState();
  const row = {
    id: state.compound_rules.length + 1,
    user_id: input.userId,
    owner_email: input.ownerEmail,
    name: input.name.slice(0, 120),
    logic: input.logic,
    conditions: input.conditions,
    channel: input.channel,
    destination: input.destination,
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  state.compound_rules.push(row);
  saveLocalState(state);
  return toRecord(row);
}

export async function listCompoundRules(userId: number): Promise<CompoundRuleRecord[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM compound_rules WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
    return res.rows.map(toRecord);
  }
  const state = getLocalState();
  return state.compound_rules
    .filter((r: any) => Number(r.user_id) === Number(userId))
    .map(toRecord);
}

export async function getCompoundRule(userId: number, id: number): Promise<CompoundRuleRecord | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM compound_rules WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (res.rows.length === 0) return null;
    return toRecord(res.rows[0]);
  }
  const state = getLocalState();
  const found = state.compound_rules.find((r: any) => Number(r.id) === Number(id) && Number(r.user_id) === Number(userId));
  return found ? toRecord(found) : null;
}

export async function updateCompoundRule(
  userId: number,
  id: number,
  patch: Partial<{ name: string; active: boolean; destination: string }>
): Promise<CompoundRuleRecord | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const sets: string[] = [`updated_at = NOW()`];
    const vals: any[] = [];
    let p = 1;
    if (patch.name !== undefined) { sets.push(`name = $${p++}`); vals.push(patch.name.slice(0, 120)); }
    if (patch.active !== undefined) { sets.push(`active = $${p++}`); vals.push(patch.active); }
    if (patch.destination !== undefined) { sets.push(`destination = $${p++}`); vals.push(patch.destination); }
    if (vals.length === 0) return getCompoundRule(userId, id);
    vals.push(id, userId);
    const res = await pool.query(
      `UPDATE compound_rules SET ${sets.join(', ')} WHERE id = $${p++} AND user_id = $${p++} RETURNING *`,
      vals
    );
    if (res.rows.length === 0) return null;
    return toRecord(res.rows[0]);
  }
  const state = getLocalState();
  const found = state.compound_rules.find((r: any) => Number(r.id) === Number(id) && Number(r.user_id) === Number(userId));
  if (!found) return null;
  if (patch.name !== undefined) found.name = patch.name.slice(0, 120);
  if (patch.active !== undefined) found.active = patch.active;
  if (patch.destination !== undefined) found.destination = patch.destination;
  found.updated_at = new Date().toISOString();
  saveLocalState(state);
  return toRecord(found);
}

/**
 * Digest-cron hook: active email-channel compound rules for a batch of
 * recipient emails. Lets compound rules evaluate against the same event
 * stream as the existing digest matching, in the same tick.
 */
export async function listActiveCompoundRulesByOwnerEmails(
  emails: string[]
): Promise<CompoundRuleRecord[]> {
  if (emails.length === 0) return [];
  const lowered = emails.map((e) => e.toLowerCase());
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT * FROM compound_rules
       WHERE active = TRUE AND channel = 'email' AND LOWER(owner_email) = ANY($1)`,
      [lowered]
    );
    return res.rows.map(toRecord);
  }
  const state = getLocalState();
  return state.compound_rules
    .filter(
      (r: any) =>
        r.active !== false &&
        r.channel === 'email' &&
        lowered.includes(String(r.owner_email || '').toLowerCase())
    )
    .map(toRecord);
}

export async function deleteCompoundRule(userId: number, id: number): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`DELETE FROM compound_rules WHERE id = $1 AND user_id = $2`, [id, userId]);
    return (res.rowCount || 0) > 0;
  }
  const state = getLocalState();
  const before = state.compound_rules.length;
  state.compound_rules = state.compound_rules.filter(
    (r: any) => !(Number(r.id) === Number(id) && Number(r.user_id) === Number(userId))
  );
  if (state.compound_rules.length !== before) {
    saveLocalState(state);
    return true;
  }
  return false;
}
