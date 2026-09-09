/**
 * User identity + lifecycle: user rows, tier writes, key revocation,
 * backfill. Split out of queries.ts (god-module remediation, first cut) —
 * same logic, new home. queries.ts re-exports everything, so no caller
 * changes.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { normalizeTier } from '../feature-flags';

  /**
   * Revokes ALL active API keys owned by an email. Called on subscription
   * cancellation so a stale paid-tier key cannot replay the revoked tier
   * back via monotonic upgrade (tier-persistence attack). Returns count.
   */
  export async function revokeUserApiKeys(email: string): Promise<number> {
    const normalized = email.trim().toLowerCase();
    const now = new Date().toISOString();
    if (isPostgres()) {
      const pool = getPgPool();
      const res = await pool.query(
        `UPDATE api_keys SET revoked_at = $1 WHERE owner_email = $2 AND revoked_at IS NULL`,
        [now, normalized]
      );
      return res.rowCount || 0;
    }
    const state = getLocalState();
    let n = 0;
    for (const k of state.api_keys || []) {
      if (k.owner_email === normalized && !k.revoked_at) {
        k.revoked_at = now;
        n++;
      }
    }
    if (n > 0) saveLocalState(state);
    return n;
  }

  /**
   * Clears revocation for an owner's keys (repurchase / upgrade path).
   * Only clears keys revoked without an explicit per-key reason — all
   * bulk revocations from cancellation qualify.
   */
  export async function restoreUserApiKeys(email: string): Promise<number> {
    const normalized = email.trim().toLowerCase();
    if (isPostgres()) {
      const pool = getPgPool();
      const res = await pool.query(
        `UPDATE api_keys SET revoked_at = NULL WHERE owner_email = $1 AND revoked_at IS NOT NULL`,
        [normalized]
      );
      return res.rowCount || 0;
    }
    const state = getLocalState();
    let n = 0;
    for (const k of state.api_keys || []) {
      if (k.owner_email === normalized && k.revoked_at) {
        k.revoked_at = null;
        n++;
      }
    }
    if (n > 0) saveLocalState(state);
    return n;
  }

export interface UserRecord {
  id: number;
  email: string;
  role: string;
  tier: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  sso_subject?: string | null;
  sso_issuer?: string | null;
  deprovisioned?: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Creates or retrieves a user by email
 */
export async function createOrGetUser(data: {
  email: string;
  role?: string;
  tier?: string;
  stripe_customer_id?: string;
}): Promise<UserRecord> {
  const normalizedEmail = data.email.trim().toLowerCase();
  const role = data.role || 'user';
  const tier = data.tier || 'free';

  if (isPostgres()) {
    const pool = getPgPool();
    const existing = await pool.query(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [normalizedEmail]);
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }
    // Atomic insert: concurrent first-seen deliveries (e.g. Stripe webhook
    // retries) must not 500 on unique-violation. ON CONFLICT returns the
    // winner's row either way.
    const inserted = await pool.query(
      `INSERT INTO users (email, role, tier, stripe_customer_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [normalizedEmail, role, tier, data.stripe_customer_id || null]
    );
    return inserted.rows[0];
  } else {
    const state = getLocalState();
    if (!state.users) state.users = [];
    const found = state.users.find((u: any) => u.email === normalizedEmail);
    if (found) return found;

    const newUser: UserRecord = {
      id: state.users.length + 1,
      email: normalizedEmail,
      role,
      tier,
      stripe_customer_id: data.stripe_customer_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.users.push(newUser);
    saveLocalState(state);
    return newUser;
  }
}

/**
 * Finds user by email
 */
export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [normalizedEmail]);
    return res.rows[0] || null;
  } else {
    const state = getLocalState();
    const found = (state.users || []).find((u: any) => u.email === normalizedEmail);
    return found || null;
  }
}

/**
 * Links (or re-links) an SSO identity to a user. One IdP active at a time:
 * re-linking overwrites the previous subject/issuer pair.
 */
export async function setUserSso(
  email: string,
  identity: { subject: string; issuer: string }
): Promise<UserRecord | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const subject = identity.subject.slice(0, 500);
  const issuer = identity.issuer.slice(0, 1000);
  if (!normalizedEmail || !subject || !issuer) return null;
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE users SET sso_subject = $1, sso_issuer = $2, updated_at = NOW()
       WHERE email = $3 RETURNING *`,
      [subject, issuer, normalizedEmail]
    );
    return res.rows[0] || null;
  }
  const state = getLocalState();
  const user = (state.users || []).find((u: any) => u.email === normalizedEmail);
  if (!user) return null;
  user.sso_subject = subject;
  user.sso_issuer = issuer;
  user.updated_at = new Date().toISOString();
  saveLocalState(state);
  return user;
}

/**
 * Activates or deactivates a user (SCIM lifecycle). Deactivation sets the
 * auditable deprovisioned flag AND revokes all API keys — revocation is
 * the actual enforcement (stale keys stop working immediately), the flag
 * blocks future sign-ins. Returns the user plus revoked key count.
 */
export async function setUserActive(
  email: string,
  active: boolean
): Promise<{ user: UserRecord | null; keysRevoked: number }> {
  const normalizedEmail = email.trim().toLowerCase();
  let keysRevoked = 0;
  if (!active) {
    keysRevoked = await revokeUserApiKeys(normalizedEmail);
  }
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE users SET deprovisioned = $1, updated_at = NOW()
       WHERE email = $2 RETURNING *`,
      [!active, normalizedEmail]
    );
    return { user: res.rows[0] || null, keysRevoked };
  }
  const state = getLocalState();
  const user = (state.users || []).find((u: any) => u.email === normalizedEmail);
  if (!user) return { user: null, keysRevoked };
  user.deprovisioned = !active;
  user.updated_at = new Date().toISOString();
  saveLocalState(state);
  return { user, keysRevoked };
}

/**
 * Finds user by ID
 */
export async function getUserById(id: number): Promise<UserRecord | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [id]);
    return res.rows[0] || null;
  } else {
    const state = getLocalState();
    const found = (state.users || []).find((u: any) => u.id === id);
    return found || null;
  }
}

/**
 * Updates user subscription tier and Stripe reference
 */
export async function updateUserTier(
  emailOrCustomerId: string,
  tier: string,
  stripeSubscriptionId?: string
): Promise<UserRecord | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE users 
       SET tier = $1, stripe_subscription_id = COALESCE($2, stripe_subscription_id), updated_at = NOW()
       WHERE email = $3 OR stripe_customer_id = $3
       RETURNING *`,
      [tier, stripeSubscriptionId || null, emailOrCustomerId]
    );
    return res.rows[0] || null;
  } else {
    const state = getLocalState();
    const user = (state.users || []).find(
      (u: any) => u.email === emailOrCustomerId || u.stripe_customer_id === emailOrCustomerId
    );
    if (user) {
      user.tier = tier;
      if (stripeSubscriptionId) user.stripe_subscription_id = stripeSubscriptionId;
      user.updated_at = new Date().toISOString();
      saveLocalState(state);
      return user;
    }
    return null;
  }
}

/**
 * Stripe webhook delivery idempotency, split into check + mark so the event
 * is recorded only AFTER its effects commit. Marking before applying (the old
 * shape) turned any handler failure into a swallowed payment: the retry would
 * report {duplicate:true} with the tier never applied.
 * Both steps are individually atomic (unique PK); concurrent duplicates race
 * on the mark, and tier writes are idempotent sets, so losers are harmless.
 */
export async function isStripeEventProcessed(eventId: string): Promise<boolean> {
  if (!eventId) return false;
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT event_id FROM processed_stripe_event_ids WHERE event_id = $1 LIMIT 1`,
      [eventId]
    );
    return res.rows.length > 0;
  }
  const state = getLocalState();
  return ((state.processed_stripe_event_ids as any[]) || []).some((r: any) => r.event_id === eventId);
}

export async function markStripeEventProcessed(eventId: string, eventType?: string): Promise<boolean> {
  if (!eventId) return false;
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO processed_stripe_event_ids (event_id, event_type, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, eventType || null]
    );
    return res.rows.length > 0;
  }
  const state = getLocalState();
  if (!state.processed_stripe_event_ids) state.processed_stripe_event_ids = [];
  const seen = (state.processed_stripe_event_ids as any[]).some((r: any) => r.event_id === eventId);
  if (seen) return false;
  (state.processed_stripe_event_ids as any[]).push({
    event_id: eventId,
    event_type: eventType || null,
    created_at: new Date().toISOString(),
  });
  saveLocalState(state);
  return true;
}

/**
 * Lists all users (used by admin tooling and the tier-normalization backfill).
 */
export async function getAllUsers(limit = 5000): Promise<UserRecord[]> {
  const max = Math.min(50000, Math.max(1, Math.floor(limit)));
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM users ORDER BY id LIMIT $1`, [max]);
    return res.rows;
  }
  const state = getLocalState();
  return [...(state.users || [])].slice(0, max);
}

/**
 * One-time backfill: rewrites every user row carrying a non-canonical tier
 * ('production', 'developer', case variants, ...) to the canonical
 * free/pro/enterprise vocabulary. Rows already canonical are untouched.
 * Safe to re-run (idempotent).
 */
export async function normalizeAllUserTiers(): Promise<{ checked: number; updated: string[] }> {
  const users = await getAllUsers();
  const updated: string[] = [];
  for (const u of users) {
    const canonical = normalizeTier(u.tier);
    if (u.tier !== canonical) {
      await updateUserTier(u.email, canonical);
      updated.push(`${u.email}: ${u.tier} -> ${canonical}`);
    }
  }
  return { checked: users.length, updated };
}
