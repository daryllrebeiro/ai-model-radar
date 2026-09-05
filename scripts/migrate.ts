import fs from 'fs';
import path from 'path';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from '../src/lib/db/client';
import { logger } from '../src/lib/logger';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');

const EXPECTED_TABLES = [
  'model_snapshots',
  'model_events',
  'ingestion_runs',
  'api_keys',
  'digest_deliveries',
  'users',
  'user_watchlists',
  'alert_rules',
];

async function ensureSchemaMigrationsTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(pool: any): Promise<Set<string>> {
  const res = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(res.rows.map((r: any) => r.version));
}

async function applySqlFile(pool: any, filePath: string): Promise<void> {
  const sql = fs.readFileSync(filePath, 'utf-8');
  await pool.query(sql);
}

export async function runMigrations(): Promise<{ success: boolean; tablesCreated: string[] }> {
  if (isPostgres()) {
    logger.info('Running database migration on PostgreSQL...');
    const pool = getPgPool();

    // Step 1: Apply baseline schema.sql (idempotent CREATE TABLE IF NOT EXISTS)
    if (fs.existsSync(SCHEMA_PATH)) {
      logger.info('Applying baseline schema.sql...');
      await applySqlFile(pool, SCHEMA_PATH);
      logger.info('Baseline schema applied successfully.');
    } else {
      throw new Error(`Schema file not found at ${SCHEMA_PATH}`);
    }

    // Step 2: Ensure schema_migrations tracking table exists
    await ensureSchemaMigrationsTable(pool);

    // Step 3: Apply incremental migrations from migrations/ directory
    if (fs.existsSync(MIGRATIONS_DIR)) {
      const applied = await getAppliedMigrations(pool);
      const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();

      for (const file of migrationFiles) {
        if (applied.has(file)) {
          logger.info(`Migration ${file} already applied, skipping.`);
          continue;
        }

        logger.info(`Applying migration: ${file}`);
        const filePath = path.join(MIGRATIONS_DIR, file);
        await applySqlFile(pool, filePath);
        await pool.query(
          'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NOW())',
          [file]
        );
        logger.info(`Migration ${file} applied successfully.`);
      }
    }

    logger.info('PostgreSQL migration complete.');
  } else {
    logger.info('Initializing local file database schema...');
    const state = getLocalState();
    if (!state.snapshots) state.snapshots = [];
    if (!state.events) state.events = [];
    if (!state.ingestion_runs) state.ingestion_runs = [];
    if (!state.api_keys) state.api_keys = [];
    if (!state.digest_deliveries) state.digest_deliveries = [];
    if (!state.users) state.users = [];
    if (!state.user_watchlists) state.user_watchlists = [];
    if (!(state as any).alert_rules) (state as any).alert_rules = [];
    saveLocalState(state);
    logger.info('Local file database initialized with all tables.');
  }

  return {
    success: true,
    tablesCreated: EXPECTED_TABLES,
  };
}

async function main() {
  try {
    const res = await runMigrations();
    logger.info('Migration complete:', res);
    process.exit(0);
  } catch (err: any) {
    logger.error('Migration failed:', { error: err.message || String(err) });
    process.exit(1);
  }
}

// Only execute directly when run as CLI script
if (require.main === module) {
  main();
}
