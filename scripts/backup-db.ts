import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isPostgres, getPgPool, getLocalState } from '../src/lib/db/client';
import { logger } from '../src/lib/logger';

export interface BackupManifest {
  timestamp: string;
  engine: 'PostgreSQL' | 'LocalFileStorage';
  checksum: string;
  tableCounts: Record<string, number>;
  filename: string;
}

/**
 * Creates a database backup dump and writes a metadata manifest
 */
export async function createDatabaseBackup(outputDir = path.join(process.cwd(), 'backups')): Promise<BackupManifest> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `backup-${timestamp}.json`;
  const backupFilePath = path.join(outputDir, backupFileName);

  let dumpData: any = {};
  const tableCounts: Record<string, number> = {};

  if (isPostgres()) {
    const pool = getPgPool();
    const tables = ['model_snapshots', 'model_events', 'ingestion_runs', 'api_keys', 'users', 'user_watchlists'];
    for (const table of tables) {
      try {
        const res = await pool.query(`SELECT * FROM ${table}`);
        dumpData[table] = res.rows;
        tableCounts[table] = res.rows.length;
      } catch {
        dumpData[table] = [];
        tableCounts[table] = 0;
      }
    }
  } else {
    const state = getLocalState();
    dumpData = state;
    for (const [key, val] of Object.entries(state)) {
      if (Array.isArray(val)) {
        tableCounts[key] = val.length;
      }
    }
  }

  const serialized = JSON.stringify(dumpData, null, 2);
  fs.writeFileSync(backupFilePath, serialized, 'utf-8');

  // Compute SHA-256 Checksum
  const checksum = crypto.createHash('sha256').update(serialized).digest('hex');

  const manifest: BackupManifest = {
    timestamp: new Date().toISOString(),
    engine: isPostgres() ? 'PostgreSQL' : 'LocalFileStorage',
    checksum,
    tableCounts,
    filename: backupFileName,
  };

  const manifestPath = path.join(outputDir, `manifest-${timestamp}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  logger.info(`Database backup created successfully: ${backupFileName} (SHA-256: ${checksum})`);
  return manifest;
}

if (require.main === module) {
  createDatabaseBackup()
    .then((manifest) => {
      console.log('✅ Backup completed:', manifest);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Backup failed:', err);
      process.exit(1);
    });
}
