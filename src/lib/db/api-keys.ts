/**
 * API key rows: issuance record, hash lookup, last-used touch, revocation.
 * Split out of queries.ts (god-module remediation) - same logic, new home.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';

/**
 * Saves a new API key record
 */
export async function createApiKey(key: {
  key_hash: string;
  key_prefix: string;
  owner_email: string;
  tier: string;
  created_at: string;
}): Promise<void> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO api_keys (key_hash, key_prefix, owner_email, tier, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [key.key_hash, key.key_prefix, key.owner_email, key.tier, key.created_at]
    );
  } else {
    const state = getLocalState();
    if (!state.api_keys) state.api_keys = [];
    state.api_keys.push({ ...key, id: state.api_keys.length + 1 });
    saveLocalState(state);
  }
}

/**
 * Looks up an API key record by its SHA-256 hash
 */
export async function findApiKeyByHash(keyHash: string): Promise<any | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM api_keys WHERE key_hash = $1 LIMIT 1`, [keyHash]);
    return res.rows[0] || null;
  } else {
    const state = getLocalState();
    const key = (state.api_keys || []).find((k: any) => k.key_hash === keyHash);
    return key || null;
  }
}

/**
 * Updates the last_used_at timestamp for a given API key
 */
export async function updateApiKeyLastUsed(keyHash: string): Promise<void> {
  const now = new Date().toISOString();
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(`UPDATE api_keys SET last_used_at = $1 WHERE key_hash = $2`, [now, keyHash]);
  } else {
    const state = getLocalState();
    const key = (state.api_keys || []).find((k: any) => k.key_hash === keyHash);
    if (key) {
      key.last_used_at = now;
      saveLocalState(state);
    }
  }
}

/**
 * Revokes an API key
 */
  export async function revokeApiKey(keyHash: string): Promise<void> {
    const now = new Date().toISOString();
    if (isPostgres()) {
      const pool = getPgPool();
      await pool.query(`UPDATE api_keys SET revoked_at = $1 WHERE key_hash = $2`, [now, keyHash]);
    } else {
      const state = getLocalState();
      const key = (state.api_keys || []).find((k: any) => k.key_hash === keyHash);
      if (key) {
        key.revoked_at = now;
        saveLocalState(state);
      }
    }
  }
