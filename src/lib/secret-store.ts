/**
 * R8 credential storage: third-party connector tokens encrypted at rest
 * (AES-256-GCM) — never plaintext.
 *
 * Key management:
 * - `EXPORT_CONNECTOR_KEYS` env var: comma-separated `keyId:hex` pairs
 *   Example: "v2:abc123...,v1:def456..."
 * - Keys are SHA-256'd to 32 bytes automatically
 * - New envelopes use v2 format: `enc:v2:<keyId>:<iv>:<ct>:<tag>`
 * - Legacy v1 format supported for decryption: `enc:v1:<iv>:<ct>:<tag>`
 * - Rotation: add new key to env, run re-encrypt script, drop old key
 */

import crypto from 'crypto';

const PREFIX_V1 = 'enc:v1:';
const PREFIX_V2 = 'enc:v2:';

export interface KeyEntry {
  keyId: string;
  keyBytes: Buffer;
}

/** Parse EXPORT_CONNECTOR_KEYS="keyId:hex,keyId:hex" into ordered key list. */
export function parseKeyring(env = process.env): KeyEntry[] {
  const raw = env.EXPORT_CONNECTOR_KEYS || '';
  if (!raw) {
    throw new Error('EXPORT_CONNECTOR_KEYS is not configured — refusing secret storage.');
  }
  return raw.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [keyId, hex] = pair.split(':');
      if (!keyId || !hex || hex.length !== 64) {
        throw new Error(`Invalid key pair "${pair}" — expected "keyId:64-hex-chars"`);
      }
      return { keyId, keyBytes: Buffer.from(hex, 'hex') };
    });
}

export function isSecretStorageConfigured(env = process.env): boolean {
  return Boolean(env.EXPORT_CONNECTOR_KEYS);
}

/** Encrypt with the FIRST (newest) key in the ring. */
export function encryptSecret(plaintext: string, env = process.env): string {
  const keys = parseKeyring(env);
  const { keyId, keyBytes: key } = keys[0];
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX_V2}${keyId}:${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

/**
 * Decrypt a secret, trying each configured key in order.
 * Supports both v1 (legacy single-key) and v2 (key-ring) formats.
 */
export function decryptSecret(stored: string | null, env = process.env): string | null {
  if (!stored) return null;
  if (!stored.startsWith('enc:')) {
    throw new Error('Stored secret is not encrypted (legacy row) — rotate the connector.');
  }

  const keys = parseKeyring(env);

  // v2 format: enc:v2:keyId:iv:ct:tag
  if (stored.startsWith(PREFIX_V2)) {
    const [keyId, ivB64, ctB64, tagB64] = stored.slice(PREFIX_V2.length).split(':');
    if (!keyId || !ivB64 || !ctB64 || !tagB64) {
      throw new Error('Malformed v2 encrypted secret.');
    }
    const keyEntry = keys.find((k) => k.keyId === keyId);
    if (!keyEntry) {
      throw new Error(`No key configured for keyId "${keyId}" — cannot decrypt.`);
    }
    return decryptWithKey(keyEntry.keyBytes, ivB64, ctB64, tagB64);
  }

  // v1 format (legacy): enc:v1:iv:ct:tag — try each key (backward compat)
  if (stored.startsWith(PREFIX_V1)) {
    const [ivB64, ctB64, tagB64] = stored.slice(PREFIX_V1.length).split(':');
    if (!ivB64 || !ctB64 || !tagB64) {
      throw new Error('Malformed v1 encrypted secret.');
    }
    for (const keyEntry of keys) {
      try {
        return decryptWithKey(keyEntry.keyBytes, ivB64, ctB64, tagB64);
      } catch {
        // try next key
      }
    }
    throw new Error('No configured key can decrypt this v1 secret — key rotated?');
  }

  throw new Error('Unknown secret format.');
}

function decryptWithKey(key: Buffer, ivB64: string, ctB64: string, tagB64: string): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf-8');
}

/**
 * Re-encrypt all secrets in the database using the current key ring.
 * Returns { reencrypted: number, failed: string[] }.
 */
export async function reencryptAllSecrets(
  getAll: () => Promise<Array<{ id: number; secret: string }>>,
  updateOne: (id: number, newSecret: string) => Promise<void>,
  env = process.env
): Promise<{ reencrypted: number; failed: string[] }> {
  const rows = await getAll();
  const failed: string[] = [];
  let reencrypted = 0;

  for (const row of rows) {
    if (!row.secret) continue;
    if (!row.secret.startsWith('enc:')) {
      failed.push(`id=${row.id}: not encrypted`);
      continue;
    }
    try {
      const plaintext = decryptSecret(row.secret, env);
      if (plaintext === null) {
        failed.push(`id=${row.id}: decrypt returned null`);
        continue;
      }
      const reencryptedSecret = encryptSecret(plaintext, env);
      await updateOne(row.id, reencryptedSecret);
      reencrypted++;
    } catch (err) {
      failed.push(`id=${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { reencrypted, failed };
}

export function isEncryptedSecret(stored: string | null): boolean {
  return Boolean(stored && stored.startsWith('enc:'));
}