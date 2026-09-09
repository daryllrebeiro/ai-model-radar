/**
 * Usage profiles for the advisor/recommendation engine: upsert plus
 * lookup by email (legacy) or user id.
 * Split out of queries.ts (god-module remediation) - same logic, new home.
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { getUserByEmail } from './users';

export interface UsageProfile {
  email: string;
  user_id?: number | null;
  monthly_prompt_tokens: number;
  monthly_comp_tokens: number;
  cache_hit_ratio: number;
  batch_discount: number;
  primary_model_id: string;
  updated_at: string;
}

export interface UsageProfileInput {
  email: string;
  user_id?: number;
  monthly_prompt_tokens: number;
  monthly_comp_tokens: number;
  cache_hit_ratio?: number;
  batch_discount?: number;
  primary_model_id: string;
}

/**
 * Creates or updates a user's workload usage profile (upsert by user_id).
 * Falls back to email if user_id not provided.
 */
export async function upsertUsageProfile(profile: UsageProfileInput): Promise<UsageProfile> {
  const cacheHit = Math.min(1, Math.max(0, profile.cache_hit_ratio ?? 0));
  const batch = Math.min(1, Math.max(0, profile.batch_discount ?? 0));
  // Normalize once so stored emails always match users.email exactly —
  // unnormalized writes recreate the case/whitespace mismatch class that
  // migration 009 had to heal.
  const normalizedEmail = profile.email.trim().toLowerCase();
  // Resolve user_id from email if not provided
  let userId = profile.user_id;
  if (!userId) {
    const user = await getUserByEmail(normalizedEmail);
    userId = user?.id; // undefined if user not found
  }

  if (isPostgres()) {
    const pool = getPgPool();
    if (userId) {
      // Primary path: upsert by user_id
      const res = await pool.query(
        `INSERT INTO usage_profiles (email, user_id, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount, primary_model_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           email = EXCLUDED.email,
           monthly_prompt_tokens = EXCLUDED.monthly_prompt_tokens,
           monthly_comp_tokens = EXCLUDED.monthly_comp_tokens,
           cache_hit_ratio = EXCLUDED.cache_hit_ratio,
           batch_discount = EXCLUDED.batch_discount,
           primary_model_id = EXCLUDED.primary_model_id,
           updated_at = NOW()
         RETURNING email, user_id, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount, primary_model_id, updated_at`,
         [normalizedEmail, userId, Math.floor(profile.monthly_prompt_tokens), Math.floor(profile.monthly_comp_tokens), cacheHit, batch, profile.primary_model_id]
      );
      const r = res.rows[0];
      return {
        email: r.email,
        user_id: r.user_id,
        monthly_prompt_tokens: Number(r.monthly_prompt_tokens),
        monthly_comp_tokens: Number(r.monthly_comp_tokens),
        cache_hit_ratio: Number(r.cache_hit_ratio),
        batch_discount: Number(r.batch_discount),
        primary_model_id: r.primary_model_id,
        updated_at: r.updated_at,
      };
    } else {
      // Fallback: upsert by email (for legacy/unknown users)
      const res = await pool.query(
        `INSERT INTO usage_profiles (email, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount, primary_model_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (email) DO UPDATE SET
           monthly_prompt_tokens = EXCLUDED.monthly_prompt_tokens,
           monthly_comp_tokens = EXCLUDED.monthly_comp_tokens,
           cache_hit_ratio = EXCLUDED.cache_hit_ratio,
           batch_discount = EXCLUDED.batch_discount,
           primary_model_id = EXCLUDED.primary_model_id,
           updated_at = NOW()
         RETURNING email, user_id, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount, primary_model_id, updated_at`,
        [normalizedEmail, Math.floor(profile.monthly_prompt_tokens), Math.floor(profile.monthly_comp_tokens), cacheHit, batch, profile.primary_model_id]
      );
      const r = res.rows[0];
      return {
        email: r.email,
        user_id: r.user_id,
        monthly_prompt_tokens: Number(r.monthly_prompt_tokens),
        monthly_comp_tokens: Number(r.monthly_comp_tokens),
        cache_hit_ratio: Number(r.cache_hit_ratio),
        batch_discount: Number(r.batch_discount),
        primary_model_id: r.primary_model_id,
        updated_at: r.updated_at,
      };
    }
  } else {
    const state = getLocalState();
    if (!state.usage_profiles) state.usage_profiles = [];
    // Resolve user_id for local backend
    let userId = profile.user_id;
    if (!userId) {
      const user = (state.users || []).find((u: any) => u.email === normalizedEmail);
      userId = user?.id || null;
    }
    const existingIdx = state.usage_profiles.findIndex((p: any) => (userId ? p.user_id === userId : p.email === normalizedEmail));
    const record = {
      email: normalizedEmail,
      user_id: userId,
      monthly_prompt_tokens: Math.floor(profile.monthly_prompt_tokens),
      monthly_comp_tokens: Math.floor(profile.monthly_comp_tokens),
      cache_hit_ratio: cacheHit,
      batch_discount: batch,
      primary_model_id: profile.primary_model_id,
      updated_at: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      state.usage_profiles[existingIdx] = { ...state.usage_profiles[existingIdx], ...record };
    } else {
      state.usage_profiles.push({ id: state.usage_profiles.length + 1, ...record });
    }
    saveLocalState(state);
    return record;
  }
}

/**
 * Loads a user's usage profile by email, if one exists.
 * @deprecated Use getUsageProfileByUserId for new code (email is not a stable key).
 */
export async function getUsageProfileByEmail(email: string): Promise<UsageProfile | null> {
  const normalized = email.trim().toLowerCase();
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT email, user_id, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount, primary_model_id, updated_at
       FROM usage_profiles WHERE email = $1 LIMIT 1`,
      [normalized]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      email: r.email,
      user_id: r.user_id,
      monthly_prompt_tokens: Number(r.monthly_prompt_tokens),
      monthly_comp_tokens: Number(r.monthly_comp_tokens),
      cache_hit_ratio: Number(r.cache_hit_ratio),
      batch_discount: Number(r.batch_discount),
      primary_model_id: r.primary_model_id,
      updated_at: r.updated_at,
    };
  } else {
    const state = getLocalState();
    const match = (state.usage_profiles || []).find((p: any) => p.email === normalized);
    if (!match) return null;
    return {
      email: match.email,
      user_id: match.user_id,
      monthly_prompt_tokens: Number(match.monthly_prompt_tokens),
      monthly_comp_tokens: Number(match.monthly_comp_tokens),
      cache_hit_ratio: Number(match.cache_hit_ratio),
      batch_discount: Number(match.batch_discount),
      primary_model_id: match.primary_model_id,
      updated_at: match.updated_at,
    };
  }
}

/**
 * Loads a user's usage profile by user_id (preferred, stable key).
 */
export async function getUsageProfileByUserId(userId: number): Promise<UsageProfile | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT email, user_id, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount, primary_model_id, updated_at
       FROM usage_profiles WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      email: r.email,
      user_id: r.user_id,
      monthly_prompt_tokens: Number(r.monthly_prompt_tokens),
      monthly_comp_tokens: Number(r.monthly_comp_tokens),
      cache_hit_ratio: Number(r.cache_hit_ratio),
      batch_discount: Number(r.batch_discount),
      primary_model_id: r.primary_model_id,
      updated_at: r.updated_at,
    };
  } else {
    const state = getLocalState();
    const match = (state.usage_profiles || []).find((p: any) => p.user_id === userId);
    if (!match) return null;
    return {
      email: match.email,
      user_id: match.user_id,
      monthly_prompt_tokens: Number(match.monthly_prompt_tokens),
      monthly_comp_tokens: Number(match.monthly_comp_tokens),
      cache_hit_ratio: Number(match.cache_hit_ratio),
      batch_discount: Number(match.batch_discount),
      primary_model_id: match.primary_model_id,
      updated_at: match.updated_at,
    };
  }
}
