/**
 * P3 team invites v2: HMAC-signed, expiring invite tokens — no new table.
 * An admin mints a token for (team, email); the invitee redeems it with a
 * matching session. All authority checks (admin-ness, email match) happen
 * in the routes; this module is pure token mint/verify.
 */
import crypto from 'crypto';
import { secretsEqual } from './secrets';

export interface TeamInvitePayload {
  teamId: number;
  email: string;
  role: 'member' | 'admin';
  exp: number;
  /** Per-token nonce: binds the HMAC to one ledger row for single-use. */
  nonce: string;
}

export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

function inviteSecret(env = process.env): string {
  const secret = env.TEAM_INVITE_SECRET || env.AUTH_SECRET || '';
  if (!secret) {
    throw new Error('No invite signing secret configured (TEAM_INVITE_SECRET or AUTH_SECRET).');
  }
  return secret;
}

function b64urlEncode(raw: string | Buffer): string {
  const b = typeof raw === 'string' ? Buffer.from(raw, 'utf-8') : raw;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Mints an invite token. Role is capped by the route (admin grants need owner). */
export function createInviteToken(
  input: { teamId: number; email: string; role?: 'member' | 'admin'; ttlMs?: number },
  env = process.env,
  nowMs = Date.now()
): string {
  if (!Number.isInteger(input.teamId) || input.teamId <= 0) {
    throw new Error('teamId must be a positive integer');
  }
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('invite email must be valid');
  }
  const payload: TeamInvitePayload = {
    teamId: input.teamId,
    email,
    role: input.role === 'admin' ? 'admin' : 'member',
    exp: nowMs + (input.ttlMs ?? INVITE_TTL_MS),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = b64urlEncode(crypto.createHmac('sha256', inviteSecret(env)).update(body).digest());
  return `${body}.${sig}`;
}

/** Verifies signature + expiry. Returns null for anything invalid/expired. */
export function verifyInviteToken(
  token: string,
  env = process.env,
  nowMs = Date.now()
): TeamInvitePayload | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  let expected: string;
  try {
    expected = b64urlEncode(crypto.createHmac('sha256', inviteSecret(env)).update(body).digest());
  } catch {
    return null;
  }
  // Project-standard constant-time compare (Edge-safe manual XOR).
  if (!secretsEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf-8')) as TeamInvitePayload;
    if (!Number.isInteger(payload.teamId) || payload.teamId <= 0) return null;
    if (typeof payload.email !== 'string' || !payload.email.includes('@')) return null;
    if (payload.role !== 'member' && payload.role !== 'admin') return null;
    if (typeof payload.exp !== 'number' || payload.exp <= nowMs) return null;
    if (typeof payload.nonce !== 'string' || payload.nonce.length < 16) return null;
    return { ...payload, email: payload.email.toLowerCase() };
  } catch {
    return null;
  }
}
