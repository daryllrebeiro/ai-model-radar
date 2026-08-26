import fs from 'fs';
import path from 'path';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from '../src/lib/db/client';
import { logger } from '../src/lib/logger';

export async function runMigrations(): Promise<{ success: boolean; tablesCreated: string[] }> {
  const schemaPath = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found at ${schemaPath}`);
  }

  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  const expectedTables = ['model_snapshots', 'model_events', 'ingestion_runs', 'api_keys'];

  if (isPostgres()) {
    logger.info('Running database migration on PostgreSQL pool...');
    const pool = getPgPool();
    await pool.query(schemaSql);
    logger.info('PostgreSQL schema applied successfully.');
  } else {
    logger.info('Initializing local file database schema...');
    const state = getLocalState();
    if (!state.snapshots) state.snapshots = [];
    if (!state.events) state.events = [];
    if (!state.ingestion_runs) state.ingestion_runs = [];
    if (!state.api_keys) state.api_keys = [];
    saveLocalState(state);
    logger.info('Local file database initialized with all 4 tables.');
  }

  return {
    success: true,
    tablesCreated: expectedTables,
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
