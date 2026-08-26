import { Pool, PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';

// Load environment variables if not loaded
import dotenv from 'dotenv';
dotenv.config();

let pgPool: Pool | null = null;

export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL;
}

export function isPostgres(): boolean {
  const url = getDatabaseUrl();
  return Boolean(url && (url.startsWith('postgres://') || url.startsWith('postgresql://')));
}

export function getPgPool(): Pool {
  if (!pgPool) {
    const connectionString = getDatabaseUrl();
    pgPool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' && !connectionString?.includes('localhost')
        ? { rejectUnauthorized: false }
        : false,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pgPool;
}

// Local JSON/file storage fallback for instant local dev when no Postgres instance is configured
interface LocalDbState {
  snapshots: Array<any>;
  events: Array<any>;
  ingestion_runs: Array<any>;
  api_keys: Array<any>;
  digest_deliveries: Array<any>;
  users: Array<any>;
  user_watchlists: Array<any>;
}

const LOCAL_DB_PATH = path.join(process.cwd(), '.radar-data.json');

function getLocalState(): LocalDbState {
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    const initial: LocalDbState = {
      snapshots: [],
      events: [],
      ingestion_runs: [],
      api_keys: [],
      digest_deliveries: [],
      users: [],
      user_watchlists: [],
    };
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(LOCAL_DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      snapshots: parsed.snapshots || [],
      events: parsed.events || [],
      ingestion_runs: parsed.ingestion_runs || [],
      api_keys: parsed.api_keys || [],
      digest_deliveries: parsed.digest_deliveries || [],
      users: parsed.users || [],
      user_watchlists: parsed.user_watchlists || [],
    };
  } catch {
    return {
      snapshots: [],
      events: [],
      ingestion_runs: [],
      api_keys: [],
      digest_deliveries: [],
      users: [],
      user_watchlists: [],
    };
  }
}

function saveLocalState(state: LocalDbState) {
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Universal query runner
 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const result = await pool.query(sql, params);
    return result.rows as T[];
  }

  // Local file-backed simulation for development
  return localQueryRunner<T>(sql, params);
}

/**
 * Executes database initialization DDL
 */
export async function initDb(): Promise<void> {
  if (isPostgres()) {
    const pool = getPgPool();
    const schemaPath = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(sql);
  } else {
    // Ensure local file exists
    getLocalState();
  }
}

/**
 * Simple in-memory/file SQL simulator for local offline testing
 */
function localQueryRunner<T = any>(sql: string, params: any[] = []): T[] {
  const state = getLocalState();
  const lowerSql = sql.trim().toLowerCase();

  // 1. Snapshot inserts
  if (lowerSql.startsWith('insert into model_snapshots')) {
    const [model_id, provider, name, price_prompt, price_completion, context_length, modality, is_free, raw_json, polled_at] = params;
    const newId = state.snapshots.length + 1;
    const row = {
      id: newId,
      model_id,
      provider,
      name,
      price_prompt: price_prompt !== null ? Number(price_prompt) : null,
      price_completion: price_completion !== null ? Number(price_completion) : null,
      context_length: context_length !== null ? Number(context_length) : null,
      modality: modality || 'text->text',
      is_free: Boolean(is_free),
      raw_json: typeof raw_json === 'string' ? JSON.parse(raw_json) : raw_json,
      polled_at: polled_at || new Date().toISOString(),
    };
    state.snapshots.push(row);
    saveLocalState(state);
    return [row] as unknown as T[];
  }

  // 2. Event inserts
  if (lowerSql.startsWith('insert into model_events')) {
    const [model_id, event_type, old_value, new_value, pct_change, source, detected_at] = params;
    const newId = state.events.length + 1;
    const row = {
      id: newId,
      model_id,
      event_type,
      old_value: typeof old_value === 'string' ? JSON.parse(old_value) : old_value,
      new_value: typeof new_value === 'string' ? JSON.parse(new_value) : new_value,
      pct_change: pct_change !== null && pct_change !== undefined ? Number(pct_change) : null,
      source: source || 'openrouter',
      detected_at: detected_at || new Date().toISOString(),
    };
    state.events.push(row);
    saveLocalState(state);
    return [row] as unknown as T[];
  }

  // 3. Clear/Reset helper
  if (lowerSql.includes('truncate') || lowerSql.includes('delete from model_')) {
    state.snapshots = [];
    state.events = [];
    saveLocalState(state);
    return [] as T[];
  }

  // 4. Fallback: Querying handled in queries.ts local adapter
  return [] as T[];
}

export { getLocalState, saveLocalState };
