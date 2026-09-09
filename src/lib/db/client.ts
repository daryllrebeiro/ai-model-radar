import { Pool } from 'pg';
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
        ? { rejectUnauthorized: process.env.PGSSL_ALLOW_SELF_SIGNED !== 'true' }
        : false,
      max: 10,
      idleTimeoutMillis: 30000,
      // A wedged connection must fail instead of wedging its holder: 5s to
      // acquire, 15s per statement. Without these, one stuck query can pin a
      // serverless instance until the platform kills it.
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
    });
    // Idle-client errors (e.g. DB restart) otherwise crash the process
    // silently via unhandled 'error' events — log them loudly instead.
    pgPool.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'Postgres pool idle-client error',
        context: { service: 'ai-model-radar', error: err.message },
      }));
    });
  }
  return pgPool;
}

/**
 * Drains the Postgres pool, waiting briefly for in-flight queries.
 * Wired to SIGTERM/SIGINT in instrumentation.ts so deploys and local runs
 * release connections instead of leaving them to idle-timeout on the server.
 * Safe to call when the pool was never created (no-op).
 */
export async function closePool(): Promise<void> {
  if (!pgPool) return;
  const pool = pgPool;
  pgPool = null;
  try {
    await pool.end();
  } catch {
    // Shutting down: nothing useful to do with the error.
  }
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
  alert_rules: Array<any>;
  teams: Array<any>;
  team_members: Array<any>;
  team_watchlists: Array<any>;
  usage_profiles: Array<any>;
  endpoint_telemetry: Array<any>;
  budget_rules: Array<any>;
  budget_alerts: Array<any>;
  migration_approvals: Array<any>;
  processed_stripe_event_ids: Array<any>;
  fk_orphans: Array<any>;
  shadow_ai_findings: Array<any>;
  approval_votes: Array<any>;
}

const LOCAL_DB_PATH = path.join(process.cwd(), '.radar-data.json');

function emptyState(): LocalDbState {
  return {
    snapshots: [],
    events: [],
    ingestion_runs: [],
    api_keys: [],
    digest_deliveries: [],
    users: [],
    user_watchlists: [],
    alert_rules: [],
    teams: [],
    team_members: [],
    team_watchlists: [],
    usage_profiles: [],
    endpoint_telemetry: [],
    budget_rules: [],
    budget_alerts: [],
    migration_approvals: [],
    processed_stripe_event_ids: [],
    fk_orphans: [],
    shadow_ai_findings: [],
    approval_votes: [],
  };
}

function getLocalState(): LocalDbState {
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    const initial = emptyState();
    saveLocalState(initial);
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
      alert_rules: parsed.alert_rules || [],
      teams: parsed.teams || [],
      team_members: parsed.team_members || [],
      team_watchlists: parsed.team_watchlists || [],
      usage_profiles: parsed.usage_profiles || [],
      endpoint_telemetry: parsed.endpoint_telemetry || [],
      budget_rules: parsed.budget_rules || [],
      budget_alerts: parsed.budget_alerts || [],
      migration_approvals: parsed.migration_approvals || [],
      processed_stripe_event_ids: parsed.processed_stripe_event_ids || [],
      fk_orphans: parsed.fk_orphans || [],
      shadow_ai_findings: parsed.shadow_ai_findings || [],
      approval_votes: parsed.approval_votes || [],
    };
  } catch {
    return emptyState();
  }
}

function saveLocalState(state: LocalDbState) {
  // Atomic replace: write to a temp file in the same directory, then rename
  // over the target. rename() is atomic on the same volume (POSIX), so a crash
  // mid-write can never leave a truncated/corrupt .radar-data.json — the
  // previous direct writeFileSync could. The local backend is single-writer
  // (dev-only); read-modify-write cycles are synchronous and never yield
  // between getLocalState() and saveLocalState(), so no interleaving occurs.
  // Windows: renameSync fails with EPERM when the destination exists, so fall
  // back to copy+unlink (not crash-atomic, but keeps single-writer correctness
  // and never throws under concurrent use).
  const tmpPath = `${LOCAL_DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  if (process.platform === 'win32') {
    // renameSync fails with EPERM on Windows when the destination exists,
    // so copy+unlink instead (not crash-atomic, but keeps single-writer
    // correctness and never throws under concurrent use).
    fs.copyFileSync(tmpPath, LOCAL_DB_PATH);
    fs.unlinkSync(tmpPath);
  } else {
    fs.renameSync(tmpPath, LOCAL_DB_PATH);
  }
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

  // 4. Fallback: fail loudly. The local adapter only simulates the statement
  // shapes above; returning [] for anything else produces silent wrong
  // answers that diverge from Postgres. Any new query shape must add an
  // explicit local branch (or go through queries.ts, which has full
  // per-function local adapters).
  throw new Error(
    `Unsupported statement in local backend: ${sql.slice(0, 120)}`
  );
}

export { getLocalState, saveLocalState };

