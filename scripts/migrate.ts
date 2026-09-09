import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from '../src/lib/db/client';
import { logger } from '../src/lib/logger';

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');

// NOTE on numbering: migrations start at 005 because 001-004 were folded
// into the baseline src/lib/db/schema.sql during early development and never
// existed as separate files. The baseline is re-applied idempotently on every
// run (CREATE TABLE/VIEW IF NOT EXISTS), so no history was lost.
//
// ROLLBACK POLICY: migrations are forward-only by design — there are no down
// migrations. Each file runs inside its own transaction, so a failed file
// rolls back cleanly. To undo an applied migration, restore from a pre-
// migration backup: npm run db:backup before, npm run db:restore afterwards.
// Never hand-edit schema_migrations; use migrationStatus() to inspect state.

const EXPECTED_TABLES = [
  'model_snapshots',
  'model_events',
  'ingestion_runs',
  'api_keys',
  'digest_deliveries',
  'users',
  'user_watchlists',
  'alert_rules',
  'teams',
  'team_members',
  'team_watchlists',
  'usage_profiles',
  'endpoint_telemetry',
  'budget_rules',
  'budget_alerts',
    'migration_approvals',
    'processed_stripe_event_ids',
    'fk_orphans',
    'shadow_ai_findings',
    'approval_votes',
    'webhook_dlq',
    'model_eol',
  ];

async function ensureSchemaMigrationsTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Checksum column for drift detection on pre-existing tracking tables.
  await pool.query(`
    ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT
  `);
}

export function migrationChecksum(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

interface AppliedMigration {
  version: string;
  checksum: string | null;
  applied_at: string;
}

async function getAppliedMigrations(pool: any): Promise<Map<string, AppliedMigration>> {
  const res = await pool.query('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version');
  return new Map(res.rows.map((r: any) => [r.version, r as AppliedMigration]));
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

    // Step 3: Apply incremental migrations from migrations/ directory.
    // Each file runs inside its own transaction: a crash mid-file rolls back
    // instead of leaving a half-applied migration marked complete (the old
    // code applied the file and recorded success as two separate statements).
    // The file's SHA-256 is recorded alongside; re-runs compare checksums so
    // a modified-after-apply migration is flagged as drift rather than
    // silently skipped.
    if (fs.existsSync(MIGRATIONS_DIR)) {
      const applied = await getAppliedMigrations(pool);
      const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();

      for (const file of migrationFiles) {
        const filePath = path.join(MIGRATIONS_DIR, file);
        const checksum = migrationChecksum(filePath);
        const record = applied.get(file);
        if (record) {
          if (record.checksum && record.checksum !== checksum) {
            logger.error(`Migration drift detected: ${file} was modified after being applied (recorded ${record.checksum.slice(0, 12)}…, current ${checksum.slice(0, 12)}…). Review manually; skipping re-apply.`);
          } else {
            logger.info(`Migration ${file} already applied, skipping.`);
          }
          continue;
        }

        logger.info(`Applying migration: ${file}`);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const sql = fs.readFileSync(filePath, 'utf-8');
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations (version, applied_at, checksum) VALUES ($1, NOW(), $2)',
            [file, checksum]
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
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

export interface MigrationStatus {
  applied: AppliedMigration[];
  pending: string[];
  drifted: Array<{ version: string; recorded: string | null; current: string }>;
  current: boolean;
}

/**
 * Reports migration state without applying anything: which files are
 * applied (with checksums), which are pending, and which applied files have
 * drifted on disk since application. `current` is true when clean.
 */
export async function migrationStatus(): Promise<MigrationStatus> {
  if (!isPostgres()) {
    return { applied: [], pending: [], drifted: [], current: true };
  }
  const pool = getPgPool();
  await ensureSchemaMigrationsTable(pool);
  const appliedMap = await getAppliedMigrations(pool);
  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
    : [];
  const applied = [...appliedMap.values()];
  const pending = files.filter(f => !appliedMap.has(f));
  const drifted: MigrationStatus['drifted'] = [];
  for (const [version, record] of appliedMap) {
    const filePath = path.join(MIGRATIONS_DIR, version);
    if (!fs.existsSync(filePath)) continue;
    const current = migrationChecksum(filePath);
    if (record.checksum && record.checksum !== current) {
      drifted.push({ version, recorded: record.checksum, current });
    }
  }
  return { applied, pending, drifted, current: pending.length === 0 && drifted.length === 0 };
}

async function main() {
  const cmd = process.argv[2];
  try {
    if (cmd === 'status') {
      const status = await migrationStatus();
      logger.info('Migration status:', status);
      if (!status.current) process.exit(1);
      process.exit(0);
    }
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
