import crypto from 'crypto';
import { findApiKeyByHash, updateApiKeyLastUsed } from './db/queries';

export type ApiKeyTier = 'free' | 'developer' | 'production';

export interface ApiKeyRecord {
  id?: number;
  key_hash: string;
  key_prefix: string;
  owner_email: string;
  tier: ApiKeyTier;
  created_at: string;
  last_used_at?: string;
  revoked_at?: string;
}

export const TIER_LIMITS: Record<ApiKeyTier | 'anonymous', { limit: number; windowMs: number }> = {
  anonymous: { limit: 60, windowMs: 60 * 1000 },
  free: { limit: 60, windowMs: 60 * 1000 },
  developer: { limit: 300, windowMs: 60 * 1000 },
  production: { limit: 1200, windowMs: 60 * 1000 },
};

/**
 * Computes deterministic SHA-256 hash of a plaintext API key
 */
export function hashApiKey(plaintextKey: string): string {
  return crypto.createHash('sha256').update(plaintextKey.trim()).digest('hex');
}

/**
 * Generates a secure random API key with standard prefix (e.g. amr_live_...)
 */
export function generateApiKey(
  ownerEmail: string,
  tier: ApiKeyTier = 'free'
): { plaintextKey: string; keyRecord: ApiKeyRecord } {
  const entropy = crypto.randomBytes(24).toString('hex');
  const plaintextKey = `amr_live_${entropy}`;
  const key_prefix = plaintextKey.substring(0, 14); // e.g. "amr_live_a1b2c3"
  const key_hash = hashApiKey(plaintextKey);

  const keyRecord: ApiKeyRecord = {
    key_hash,
    key_prefix,
    owner_email: ownerEmail.toLowerCase().trim(),
    tier,
    created_at: new Date().toISOString(),
  };

  return { plaintextKey, keyRecord };
}

/**
 * Verifies an incoming API key string against the database
 */
export async function verifyApiKey(
  plaintextKey?: string | null
): Promise<{ valid: boolean; record?: ApiKeyRecord; tier: ApiKeyTier | 'anonymous' }> {
  if (!plaintextKey || !plaintextKey.startsWith('amr_live_')) {
    return { valid: false, tier: 'anonymous' };
  }

  const hash = hashApiKey(plaintextKey);
  const record = await findApiKeyByHash(hash);

  if (!record || record.revoked_at) {
    return { valid: false, tier: 'anonymous' };
  }

  // Update last used timestamp in background
  updateApiKeyLastUsed(hash).catch(() => {});

  return {
    valid: true,
    record,
    tier: record.tier,
  };
}
