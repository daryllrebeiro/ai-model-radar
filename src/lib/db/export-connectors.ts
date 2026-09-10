/**
 * R8 persistence: user-scoped export connectors. Secrets are write-only:
 * stored for delivery, NEVER returned by any read path (see toPublic()).
 */
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import type { ExportConnectorType } from '../export-connectors';
import { encryptSecret, decryptSecret } from '../secret-store';

export interface ExportConnectorRecord {
  id: number;
  user_id: number | null;
  owner_email: string;
  name: string;
  type: ExportConnectorType;
  destination_url: string;
  has_secret: boolean;
  active: boolean;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
}

export interface ExportConnectorStored extends ExportConnectorRecord {
  secret: string | null;
}

function toPublic(r: any): ExportConnectorRecord {
  return {
    id: Number(r.id),
    user_id: r.user_id !== null && r.user_id !== undefined ? Number(r.user_id) : null,
    owner_email: r.owner_email,
    name: r.name,
    type: r.type,
    destination_url: r.destination_url || '',
    has_secret: Boolean(r.secret),
    active: Boolean(r.active),
    last_run_at: r.last_run_at || null,
    last_status: r.last_status || null,
    created_at: r.created_at,
  };
}

function toStored(r: any): ExportConnectorStored {
  return { ...toPublic(r), secret: r.secret || null };
}

export async function createExportConnector(input: {
  userId: number;
  ownerEmail: string;
  name: string;
  type: ExportConnectorType;
  destinationUrl?: string;
  secret?: string;
}): Promise<ExportConnectorRecord> {
  // Encrypt-at-rest: throws when EXPORT_CONNECTOR_KEY is unset (fail-closed —
  // the route converts this to a 400 rather than persisting plaintext).
  const storedSecret = input.secret ? encryptSecret(input.secret) : null;
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `INSERT INTO export_connectors (user_id, owner_email, name, type, destination_url, secret)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.userId, input.ownerEmail, input.name.slice(0, 120), input.type, (input.destinationUrl || '').slice(0, 2000), storedSecret]
    );
    return toPublic(res.rows[0]);
  }
  const state = getLocalState();
  const row = {
    id: state.export_connectors.length + 1,
    user_id: input.userId,
    owner_email: input.ownerEmail,
    name: input.name.slice(0, 120),
    type: input.type,
    destination_url: (input.destinationUrl || '').slice(0, 2000),
    secret: storedSecret,
    active: true,
    last_run_at: null,
    last_status: null,
    created_at: new Date().toISOString(),
  };
  state.export_connectors.push(row);
  saveLocalState(state);
  return toPublic(row);
}

export async function listExportConnectors(userId: number): Promise<ExportConnectorRecord[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM export_connectors WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
    return res.rows.map(toPublic);
  }
  const state = getLocalState();
  return state.export_connectors.filter((r: any) => Number(r.user_id) === Number(userId)).map(toPublic);
}

/**
 * Internal: full row WITH decrypted secret, for delivery only. Never exposed
 * via API reads. Legacy plaintext rows throw (rotate required) rather than
 * silently decrypting the wrong thing.
 */
export async function getExportConnectorForRun(userId: number, id: number): Promise<ExportConnectorStored | null> {
  const Redacted = (r: any) => ({ ...toStored(r), secret: null });
  const withSecret = (r: any): ExportConnectorStored => ({ ...toStored(r), secret: decryptSecret(r.secret) });
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM export_connectors WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (res.rows.length === 0) return null;
    try {
      return withSecret(res.rows[0]);
    } catch {
      return Redacted(res.rows[0]);
    }
  }
  const state = getLocalState();
  const found = state.export_connectors.find((r: any) => Number(r.id) === Number(id) && Number(r.user_id) === Number(userId));
  if (!found) return null;
  try {
    return withSecret(found);
  } catch {
    return Redacted(found);
  }
}

export async function markConnectorRun(
  id: number,
  status: string
): Promise<void> {
  const now = new Date().toISOString();
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(`UPDATE export_connectors SET last_run_at = $1, last_status = $2 WHERE id = $3`, [now, status.slice(0, 20), id]);
    return;
  }
  const state = getLocalState();
  const found = state.export_connectors.find((r: any) => Number(r.id) === Number(id));
  if (found) {
    found.last_run_at = now;
    found.last_status = status.slice(0, 20);
    saveLocalState(state);
  }
}

export async function deleteExportConnector(userId: number, id: number): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`DELETE FROM export_connectors WHERE id = $1 AND user_id = $2`, [id, userId]);
    return (res.rowCount || 0) > 0;
  }
  const state = getLocalState();
  const before = state.export_connectors.length;
  state.export_connectors = state.export_connectors.filter(
    (r: any) => !(Number(r.id) === Number(id) && Number(r.user_id) === Number(userId))
  );
  if (state.export_connectors.length !== before) {
    saveLocalState(state);
    return true;
  }
  return false;
}
