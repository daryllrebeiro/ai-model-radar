/**
 * R8 credential storage: third-party connector tokens are encrypted at rest
 * (AES-256-GCM) — never plaintext. Key comes from EXPORT_CONNECTOR_KEY
 * (any high-entropy string; SHA-256'd to 32 bytes). Fail-closed: no key, no
 * secret storage — callers must refuse rather than persist plaintext.
 */
import crypto from 'crypto';

const PREFIX = 'enc:v1:';

function keyBytes(env = process.env): Buffer {
  const raw = env.EXPORT_CONNECTOR_KEY || '';
  if (!raw) {
    throw new Error('EXPORT_CONNECTOR_KEY is not configured — refusing secret storage.');
  }
  return crypto.createHash('sha256').update(raw, 'utf-8').digest();
}

export function isSecretStorageConfigured(env = process.env): boolean {
  return Boolean(env.EXPORT_CONNECTOR_KEY);
}

export function encryptSecret(plaintext: string, env = process.env): string {
  const key = keyBytes(env);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

export function decryptSecret(stored: string | null, env = process.env): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) {
    // Legacy plaintext rows (pre-encryption): refuse to use — rotate required.
    throw new Error('Stored secret is not encrypted (legacy row) — rotate the connector.');
  }
  const key = keyBytes(env);
  const [ivB64, ctB64, tagB64] = stored.slice(PREFIX.length).split(':');
  if (!ivB64 || !ctB64 || !tagB64) throw new Error('Malformed encrypted secret.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf-8');
}

export function isEncryptedSecret(stored: string | null): boolean {
  return Boolean(stored && stored.startsWith(PREFIX));
}
