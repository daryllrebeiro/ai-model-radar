/**
 * Audit follow-up: single-use invite ledger. The HMAC token proves mint
 * authority; this table proves non-consumption. Redemption is an atomic
 * claim (UPDATE ... WHERE consumed_at IS NULL + not expired) — replays,
 * expired, and unknown tokens share one rejection, no oracle.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import crypto from 'crypto';

export interface TeamInviteRecord {
  id: number;
  team_id: number;
  email: string;
  role: 'member' | 'admin';
  created_by_email: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function toRecord(r: any): TeamInviteRecord {
  return {
    id: Number(r.id),
    team_id: Number(r.team_id),
    email: r.email,
    role: r.role === 'admin' ? 'admin' : 'member',
    created_by_email: r.created_by_email,
    expires_at: r.expires_at,
    consumed_at: r.consumed_at || null,
    created_at: r.created_at,
  };
}

export async function createTeamInvite(input: {
  teamId: number;
  email: string;
  role: 'member' | 'admin';
  tokenHash: string;
  createdByEmail: string;
  expiresAt: string;
}): Promise<TeamInviteRecord> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO team_invites (team_id, email, role, token_hash, created_by_email, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.teamId, input.email, input.role, input.tokenHash, input.createdByEmail, input.expiresAt]
    );
    return toRecord(res.rows[0]);
  }
  const state = getLocalState();
  const row = {
    id: state.team_invites.length + 1,
    team_id: input.teamId,
    email: input.email,
    role: input.role,
    token_hash: input.tokenHash,
    created_by_email: input.createdByEmail,
    expires_at: input.expiresAt,
    consumed_at: null,
    created_at: new Date().toISOString(),
  };
  state.team_invites.push(row);
  saveLocalState(state);
  return toRecord(row);
}

/**
 * Atomically claims an invite: exactly one concurrent claim can win.
 * Returns the invite row on success, null when unknown/consumed/expired
 * (deliberately indistinguishable).
 */
export async function claimTeamInvite(tokenHash: string, nowIso?: string): Promise<TeamInviteRecord | null> {
  const now = nowIso || new Date().toISOString();
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE team_invites SET consumed_at = $1
       WHERE token_hash = $2 AND consumed_at IS NULL AND expires_at > $1
       RETURNING *`,
      [now, tokenHash]
    );
    if (res.rows.length === 0) return null;
    return toRecord(res.rows[0]);
  }
  const state = getLocalState();
  const found = state.team_invites.find(
    (r: any) => r.token_hash === tokenHash && !r.consumed_at && String(r.expires_at) > now
  );
  if (!found) return null;
  found.consumed_at = now;
  saveLocalState(state);
  return toRecord(found);
}
