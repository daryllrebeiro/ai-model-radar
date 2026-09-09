/**
 * Per-user watchlists plus GDPR export/delete: all reads and writes
 * scoped to a user id; email callers resolve via users.ts first.
 * Split out of queries.ts (god-module remediation) - same logic, new home.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { getUserByEmail } from './users';
import type { UserRecord } from './users';

export async function getUserWatchlist(userId: number): Promise<string[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT model_id FROM user_watchlists WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return res.rows.map((r: any) => r.model_id);
  } else {
    const state = getLocalState();
    return (state.user_watchlists || [])
      .filter((w: any) => w.user_id === userId)
      .map((w: any) => w.model_id);
  }
}

/**
 * Retrieves watchlist items for a given user by email address
 */
export async function getUserWatchlistByEmail(email: string): Promise<string[]> {
  const user = await getUserByEmail(email);
  if (!user || !user.id) return [];
  return getUserWatchlist(user.id);
}

/**
 * Pins a model to user watchlist
 */
export async function addToWatchlist(userId: number, modelId: string): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO user_watchlists (user_id, model_id, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, model_id) DO NOTHING`,
      [userId, modelId]
    );
    return true;
  } else {
    const state = getLocalState();
    if (!state.user_watchlists) state.user_watchlists = [];
    const exists = state.user_watchlists.some(
      (w: any) => w.user_id === userId && w.model_id === modelId
    );
    if (!exists) {
      state.user_watchlists.push({
        id: state.user_watchlists.length + 1,
        user_id: userId,
        model_id: modelId,
        created_at: new Date().toISOString(),
      });
      saveLocalState(state);
    }
    return true;
  }
}

/**
 * Removes a model from user watchlist
 */
export async function removeFromWatchlist(userId: number, modelId: string): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `DELETE FROM user_watchlists WHERE user_id = $1 AND model_id = $2`,
      [userId, modelId]
    );
    return true;
  } else {
    const state = getLocalState();
    if (state.user_watchlists) {
      state.user_watchlists = state.user_watchlists.filter(
        (w: any) => !(w.user_id === userId && w.model_id === modelId)
      );
      saveLocalState(state);
    }
    return true;
  }
}

export interface UserExportData {
  profile: UserRecord;
  apiKeys: Array<{ key_prefix: string; tier: string; created_at: string; last_used_at?: string }>;
  alertRules: any[];
  watchlist: string[];
  exportedAt: string;
}

/**
 * Compiles a full GDPR data portability export package for a user
 */
export async function exportUserData(userId: number): Promise<UserExportData | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const userRes = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
    if (userRes.rows.length === 0) return null;
    const user = userRes.rows[0];

    // Independent reads: run keys lookup and watchlist retrieval concurrently.
    const [keysRes, watchlist] = await Promise.all([
      pool.query(
        `SELECT key_prefix, tier, created_at, last_used_at FROM api_keys WHERE owner_email = $1`,
        [user.email]
      ),
      getUserWatchlist(userId),
    ]);

    return {
      profile: user,
      apiKeys: keysRes.rows,
      alertRules: [],
      watchlist,
      exportedAt: new Date().toISOString(),
    };
  } else {
    const state = getLocalState();
    const user = (state.users || []).find((u: any) => u.id === userId);
    if (!user) return null;

    const apiKeys = (state.api_keys || [])
      .filter((k: any) => k.owner_email === user.email)
      .map((k: any) => ({
        key_prefix: k.key_prefix,
        tier: k.tier,
        created_at: k.created_at,
        last_used_at: k.last_used_at,
      }));

    const watchlist = await getUserWatchlist(userId);

    return {
      profile: user,
      apiKeys,
      alertRules: [],
      watchlist,
      exportedAt: new Date().toISOString(),
    };
  }
}

/**
 * Permanently deletes a user account and purges associated data
 */
export async function deleteUserAccount(userId: number): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    const userRes = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
    if (userRes.rows.length === 0) return false;
    const email = userRes.rows[0].email;

    // Delete api keys and user record (watchlists cascade on delete)
    await pool.query(`DELETE FROM api_keys WHERE owner_email = $1`, [email]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    return true;
  } else {
    const state = getLocalState();
    const userIdx = (state.users || []).findIndex((u: any) => u.id === userId);
    if (userIdx === -1) return false;
    const email = state.users[userIdx].email;

    state.users.splice(userIdx, 1);
    if (state.api_keys) {
      state.api_keys = state.api_keys.filter((k: any) => k.owner_email !== email);
    }
    if (state.user_watchlists) {
      state.user_watchlists = state.user_watchlists.filter((w: any) => w.user_id !== userId);
    }
    if (state.teams) {
      const ownedTeamIds = new Set(
        (state.teams as any[])
          .filter((t: any) => t.owner_email === email)
          .map((t: any) => t.id)
      );
      (state.teams as any[]) = (state.teams as any[]).filter((t: any) => t.owner_email !== email);
      if (state.team_watchlists) {
        (state as any).team_watchlists = (state as any).team_watchlists.filter(
          (w: any) => !ownedTeamIds.has(w.team_id)
        );
      }
      if (state.team_members) {
        (state as any).team_members = (state as any).team_members.filter(
          (m: any) => m.member_email !== email && !ownedTeamIds.has(m.team_id)
        );
      }
    }
    saveLocalState(state);
    return true;
  }
}

// ─── TEAM WORKSPACES (Enterprise) ───────────────────────────────────────
