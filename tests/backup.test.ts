import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createDatabaseBackup } from '../scripts/backup-db';
import { restoreDatabase } from '../scripts/restore-db';
import { triggerEscalationAlert } from '../src/lib/alerts/escalation';

describe('Phase P9: Automated Database Backup, Restore & Escalation Alerts', () => {
  const testOutputDir = path.join(process.cwd(), 'backups-test');

  beforeEach(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it('1. Creates database backup snapshot and computes matching SHA-256 manifest', async () => {
    const manifest = await createDatabaseBackup(testOutputDir);

    expect(manifest.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.filename).toContain('backup-');
    expect(fs.existsSync(path.join(testOutputDir, manifest.filename))).toBe(true);

    // Verify written file checksum matches manifest
    const raw = fs.readFileSync(path.join(testOutputDir, manifest.filename), 'utf-8');
    const crypto = await import('crypto');
    const actualChecksum = crypto.createHash('sha256').update(raw).digest('hex');
    expect(actualChecksum).toBe(manifest.checksum);
  });

  it('2. Successfully validates and restores database from verified backup dump', async () => {
    const manifest = await createDatabaseBackup(testOutputDir);
    const backupFilePath = path.join(testOutputDir, manifest.filename);

    const restoreResult = await restoreDatabase(backupFilePath, manifest.checksum);
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.restoredTables).toBeDefined();

    // Rejects tampered dump with wrong checksum
    await expect(
      restoreDatabase(backupFilePath, '0000000000000000000000000000000000000000000000000000000000000000')
    ).rejects.toThrowError(/Integrity verification failed/);
  });

  it('3. Formats and triggers paging escalation alerts for production incidents', async () => {
    const res = await triggerEscalationAlert({
      severity: 'SEV-1',
      source: 'ingestion_monitor',
      message: '3 consecutive ingestion runs failed for GitHub API',
      details: { consecutiveFailures: 3, lastStatus: 403 },
      timestamp: new Date().toISOString(),
    });

    expect(res.success).toBe(true);
  });
});
