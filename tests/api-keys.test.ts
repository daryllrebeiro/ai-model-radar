import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  TIER_LIMITS,
} from '../src/lib/api-keys';
import { createApiKey, revokeApiKey } from '../src/lib/db/queries';

describe('Phase P2: Real API Key System & Tier Quotas', () => {
  it('1. Generates standard format API key with key prefix and SHA-256 hash', () => {
    const { plaintextKey, keyRecord } = generateApiKey('dev@example.com', 'developer');

    expect(plaintextKey).toMatch(/^amr_live_[a-f0-9]{48}$/);
    expect(keyRecord.key_prefix).toBe(plaintextKey.substring(0, 14));
    expect(keyRecord.key_hash).toBe(hashApiKey(plaintextKey));
    expect(keyRecord.tier).toBe('developer');
    expect(keyRecord.owner_email).toBe('dev@example.com');
  });

  it('2. Verifies valid registered API key and extracts tier quota', async () => {
    const { plaintextKey, keyRecord } = generateApiKey('enterprise@acme.com', 'production');
    await createApiKey(keyRecord);

    const verification = await verifyApiKey(plaintextKey);
    expect(verification.valid).toBe(true);
    expect(verification.tier).toBe('production');
    expect(verification.record?.owner_email).toBe('enterprise@acme.com');
    expect(TIER_LIMITS[verification.tier].limit).toBe(1200);
  });

  it('3. Rejects invalid or revoked API keys', async () => {
    const { plaintextKey, keyRecord } = generateApiKey('revoked@example.com', 'free');
    await createApiKey(keyRecord);
    await revokeApiKey(keyRecord.key_hash);

    const verification = await verifyApiKey(plaintextKey);
    expect(verification.valid).toBe(false);
    expect(verification.tier).toBe('anonymous');

    // Invalid format
    const randomCheck = await verifyApiKey('invalid-token-123');
    expect(randomCheck.valid).toBe(false);
  });
});
