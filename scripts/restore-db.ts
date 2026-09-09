import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isPostgres, getPgPool, saveLocalState } from '../src/lib/db/client';
import { bulkInsert } from '../src/lib/db/queries';
import { logger } from '../src/lib/logger';

// Canonical restore order: FK parents before children, independent of the
// key order inside the dump file. Must mirror the backup table order —
// inserting a child (budget_rules) before its parent (teams) violates FK
// constraints, and interleaved per-table TRUNCATE ... CASCADE wipes
// already-restored parent rows out from under later child inserts.
const RESTORE_ORDER = [
    'users',
    'teams',
    'user_watchlists',
    'usage_profiles',
    'team_members',
    'team_watchlists',
    'budget_rules',
    'budget_alerts',
    'shadow_ai_findings',
    'migration_approvals',
    'approval_votes',
    'webhook_dlq',
    'model_snapshots',
    'model_events',
    'ingestion_runs',
    'api_keys',
    'digest_deliveries',
    'alert_rules',
    'endpoint_telemetry',
    'processed_stripe_event_ids',
    'fk_orphans',
  ];

// Tables with SERIAL/BIGSERIAL primary keys whose sequences must be
// advanced past the restored ids, otherwise the next app INSERT reuses an
// existing id and fails on duplicate primary key.
const SERIAL_TABLES = new Set([
    'users',
    'teams',
    'user_watchlists',
    'usage_profiles',
    'team_members',
    'team_watchlists',
    'budget_rules',
    'budget_alerts',
      'shadow_ai_findings',
      'migration_approvals',
      'approval_votes',
      'webhook_dlq',
      'model_snapshots',
      'model_events',
      'ingestion_runs',
      'api_keys',
      'digest_deliveries',
      'alert_rules',
      'endpoint_telemetry',
      'fk_orphans',
    ]);

const VALID_TABLES = new Set([
  ...RESTORE_ORDER,
  // Local file state keys (used by backup-db.ts in local mode)
  'snapshots',
  'events',
]);

/**
 * Restores database from a verified backup dump file.
 * Checksum verification is mandatory — refuses to restore without a valid checksum.
 */
export async function restoreDatabase(backupFilePath: string, expectedChecksum: string): Promise<{ success: boolean; restoredTables: Record<string, number> }> {
  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file not found at: ${backupFilePath}`);
  }

  if (!expectedChecksum) {
    throw new Error('Checksum verification is mandatory. Provide a valid SHA-256 checksum to restore.');
  }

  const raw = fs.readFileSync(backupFilePath, 'utf-8');

  // Verify SHA-256 Checksum
  const computed = crypto.createHash('sha256').update(raw).digest('hex');
  if (computed !== expectedChecksum) {
    throw new Error(`Integrity verification failed! Expected SHA-256 ${expectedChecksum}, got ${computed}`);
  }

  const dump = JSON.parse(raw);
  // Typed view for the Postgres branch (table name -> row objects).
  const pgDump: Record<string, Array<Record<string, unknown>>> = dump;

  // Validate all table names against allowlist
  for (const table of Object.keys(dump)) {
    if (!VALID_TABLES.has(table)) {
      throw new Error(`Unknown table "${table}" in backup file. Restore rejected for safety.`);
    }
  }

  // Validate column names up front, for BOTH backends: dump keys are
  // untrusted input, and a hostile key must fail here — never reach SQL in
  // the Postgres branch nor silently persist in the local branch.
  for (const [table, rows] of Object.entries(pgDump)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const first = rows[0];
    if (typeof first !== 'object' || first === null) continue;
    for (const col of Object.keys(first)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(col)) {
        throw new Error(`Unsafe column name "${col}" in table "${table}". Restore rejected for safety.`);
      }
    }
  }

  const restoredTables: Record<string, number> = {};

  if (isPostgres()) {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Replay in canonical parent-first order, never in dump key order.
      const tablesWithRows = RESTORE_ORDER.filter(
        (t) => Array.isArray(pgDump[t]) && pgDump[t].length > 0
      );
      // Truncate every table key present in the dump up front in a single
      // statement — Postgres only permits truncating an FK-referenced table
      // when all referencing tables are truncated alongside it, so the list
      // must include empty tables too (their FKs still block the truncate).
      // No CASCADE: every table in the list is emptied, so no restored row
      // can be wiped mid-run. Untouched: schema_migrations (never dumped).
      const tablesToTruncate = RESTORE_ORDER.filter((t) =>
        Object.prototype.hasOwnProperty.call(dump, t)
      );
      if (tablesToTruncate.length > 0) {
        await client.query(`TRUNCATE TABLE ${tablesToTruncate.join(', ')}`);
      }
      for (const table of tablesWithRows) {
        const rows = pgDump[table];
        // Columns pre-validated above (bare identifiers only). Chunked
        // multi-row replay shared with the poll write path — one round trip
        // per 1,000 rows instead of one per row.
        const columns = Object.keys(rows[0]);
        await bulkInsert(
          client,
          table,
          columns,
          rows.map((row: any) =>
            columns.map((col) => {
              const val = row[col];
              return typeof val === 'object' && val !== null ? JSON.stringify(val) : val;
            })
          )
        );
        // Advance the SERIAL sequence past the restored ids so subsequent
        // app INSERTs don't collide with restored primary keys.
        if (SERIAL_TABLES.has(table)) {
          await client.query(
            `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`,
            [table]
          );
        }
        restoredTables[table] = rows.length;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // Restore local file storage
    saveLocalState(dump);
    for (const [key, val] of Object.entries(dump)) {
      if (Array.isArray(val)) {
        restoredTables[key] = val.length;
      }
    }
  }

  logger.info(`Database restored successfully from: ${path.basename(backupFilePath)}`);
  return { success: true, restoredTables };
}

if (require.main === module) {
  const fileArg = process.argv[2];
  const checksumArg = process.argv[3];
  if (!fileArg || !checksumArg) {
    console.error('Usage: tsx scripts/restore-db.ts <path-to-backup.json> <sha256-checksum>');
    console.error('Checksum verification is mandatory for restore safety.');
    process.exit(1);
  }
  restoreDatabase(fileArg, checksumArg)
    .then((res) => {
      console.log('✅ Database restore completed:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Restore failed:', err);
      process.exit(1);
    });
}
