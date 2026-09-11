import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  parseKeyring,
  encryptSecret,
  decryptSecret,
  reencryptAllSecrets,
} from '../src/lib/secret-store';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('dual-key secret envelope (R8 rotation)', () => {
  it('parseKeyring validates format and returns ordered keys', () => {
    process.env.EXPORT_CONNECTOR_KEYS = 'v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const keys = parseKeyring();
    expect(keys).toHaveLength(2);
    expect(keys[0].keyId).toBe('v2');
    expect(keys[1].keyId).toBe('v1');
    expect(keys[0].keyBytes.length).toBe(32);
  });

  it('rejects malformed keyring entries', () => {
    process.env.EXPORT_CONNECTOR_KEYS = 'v2:short';
    expect(() => parseKeyring()).toThrow(/64-hex-chars/);
    process.env.EXPORT_CONNECTOR_KEYS = 'no-colon';
    expect(() => parseKeyring()).toThrow(/Invalid key pair/);
    process.env.EXPORT_CONNECTOR_KEYS = '';
    expect(() => parseKeyring()).toThrow(/not configured/);
  });

  it('encrypts with newest key (first in ring), decrypts with matching keyId', () => {
    process.env.EXPORT_CONNECTOR_KEYS = 'v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const ct = encryptSecret('secret-token-123');
    expect(ct.startsWith('enc:v2:')).toBe(true);
    expect(decryptSecret(ct)).toBe('secret-token-123');
    // Key ID embedded in envelope
    expect(ct).toMatch(/^enc:v2:v2:/);
  });

  it('v1 legacy format still decrypts (backward compat)', () => {
    // Create a v1 ciphertext manually using the old single-key method
    const key = Buffer.from('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update('legacy-secret', 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacy = `enc:v1:${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
    
    // Now with new keyring that includes the same key as v1
    process.env.EXPORT_CONNECTOR_KEYS = 'v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(decryptSecret(legacy)).toBe('legacy-secret');
  });

it('fails if no key can decrypt (rotation without re-encrypt)', () => {
    process.env.EXPORT_CONNECTOR_KEYS = 'v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const ct = encryptSecret('secret');
    process.env.EXPORT_CONNECTOR_KEYS = 'v2:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    expect(() => decryptSecret(ct)).toThrow(/cannot decrypt|No key configured|keyId|Unsupported state/);
  });

  it('reencryptAllSecrets migrates v1 to v2 format', async () => {
    process.env.EXPORT_CONNECTOR_KEYS = 'v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    // Create a v1 row
    const oldKey = Buffer.from('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', oldKey, iv);
    const ct = Buffer.concat([cipher.update('old-secret', 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacy = `enc:v1:${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
    
    const rows = [
      { id: 1, secret: legacy },
    ];
    
    const updated: any[] = [];
    const result = await reencryptAllSecrets(
      async () => rows,
      async (id, newSecret) => { updated.push({ id, secret: newSecret }); }
    );
    
    expect(result.reencrypted).toBe(1);
    expect(updated[0].secret.startsWith('enc:v2:')).toBe(true);
    // Can decrypt the re-encrypted secret
    expect(decryptSecret(updated[0].secret)).toBe('old-secret');
  });
});

