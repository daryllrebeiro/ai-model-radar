import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isPostgres, getPgPool, saveLocalState } from '../src/lib/db/client';
import { logger } from '../src/lib/logger';

/**
 * Restores database from a verified backup dump file
 */
export async function restoreDatabase(backupFilePath: string, expectedChecksum?: string): Promise<{ success: boolean; restoredTables: Record<string, number> }> {
  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file not found at: ${backupFilePath}`);
  }

  const raw = fs.readFileSync(backupFilePath, 'utf-8');

  // Verify SHA-256 Checksum if provided
  if (expectedChecksum) {
    const computed = crypto.createHash('sha256').update(raw).digest('hex');
    if (computed !== expectedChecksum) {
      throw new Error(`Integrity verification failed! Expected SHA-256 ${expectedChecksum}, got ${computed}`);
    }
  }

  const dump = JSON.parse(raw);
  const restoredTables: Record<string, number> = {};

  if (isPostgres()) {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [table, rows] of Object.entries(dump)) {
        if (Array.isArray(rows) && rows.length > 0) {
          // Truncate table before restoring
          await client.query(`TRUNCATE TABLE ${table} CASCADE`);
          const columns = Object.keys(rows[0]);
          for (const row of rows) {
            const values = columns.map((col) => {
              const val = row[col];
              return typeof val === 'object' && val !== null ? JSON.stringify(val) : val;
            });
            const placeholders = values.map((_, idx) => `$${idx + 1}`).join(', ');
            await client.query(
              `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
              values
            );
          }
          restoredTables[table] = rows.length;
        }
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
  if (!fileArg) {
    console.error('Usage: tsx scripts/restore-db.ts <path-to-backup.json> [checksum]');
    process.exit(1);
  }
  const checksumArg = process.argv[3];
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
