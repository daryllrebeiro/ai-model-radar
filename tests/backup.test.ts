import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createDatabaseBackup } from '../scripts/backup-db';
import { restoreDatabase } from '../scripts/restore-db';
import { triggerEscalationAlert } from '../src/lib/alerts/escalation';
import {
  createOrGetUser,
  createTeam,
  createBudgetRule,
  recordBudgetAlert,
  getBudgetRulesForTeam,
} from '../src/lib/db/queries';

describe('Phase P9: Automated Database Backup, Restore & Escalation Alerts', () => {
  const testOutputDir = path.join(process.cwd(), 'backups-test');

  beforeEach(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it('1. Creates database backup snapshot and computes matching SHA-256 manifest', { timeout: 15000 }, async () => {
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

  it('2. Successfully validates and restores database from verified backup dump', { timeout: 30000 }, async () => {
    const manifest = await createDatabaseBackup(testOutputDir);
    const backupFilePath = path.join(testOutputDir, manifest.filename);

    const restoreResult = await restoreDatabase(backupFilePath, manifest.checksum);
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.restoredTables).toBeDefined();

    // Rejects tampered dump with wrong checksum
    await expect(
      restoreDatabase(backupFilePath, '0000000000000000000000000000000000000000000000000000000000000000')
    ).rejects.toThrowError(/Integrity verification failed/);

    // Rejects restore without checksum (mandatory)
    await expect(
      restoreDatabase(backupFilePath, '')
    ).rejects.toThrowError(/Checksum verification is mandatory/);
  });

  it('3. Formats and triggers paging escalation alerts for production incidents', { timeout: 10000 }, async () => {
    const res = await triggerEscalationAlert({
      severity: 'SEV-1',
      source: 'ingestion_monitor',
      message: '3 consecutive ingestion runs failed for GitHub API',
      details: { consecutiveFailures: 3, lastStatus: 403 },
      timestamp: new Date().toISOString(),
    });

    expect(res.success).toBe(true);
  });

  it('4. Backup/restore round-trips FK-linked rows (user -> team -> team rule -> alert)', { timeout: 30000 }, async () => {
    // Regression: restore used to replay tables in dump key order with
    // per-table TRUNCATE ... CASCADE, so a dump containing team-scoped
    // budget_rules failed on budget_rules_team_id_fkey (parents wiped or
    // inserted after children). Seed the full FK chain first.
    const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
    const owner = `backup.fk.${stamp}@test.dev`;
    await createOrGetUser({ email: owner });
    const team = await createTeam(`Backup FK Team ${stamp}`, owner);
    const rule = await createBudgetRule({
      name: `Backup FK rule ${stamp}`,
      scope: 'team',
      team_id: team.id!,
      owner_email: owner,
      monthly_budget_usd: 250,
    });
    await recordBudgetAlert({
      rule_id: rule.id!,
      projected_monthly_usd: 300,
      budget_usd: 250,
      pct_used: 1.2,
      alert_type: 'over_budget',
      message: 'fk regression probe',
    });

    const manifest = await createDatabaseBackup(testOutputDir);
    const restoreResult = await restoreDatabase(
      path.join(testOutputDir, manifest.filename),
      manifest.checksum
    );
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.restoredTables['teams']).toBeGreaterThanOrEqual(1);
    expect(restoreResult.restoredTables['budget_rules']).toBeGreaterThanOrEqual(1);

    // FK chain survives: team rule still resolves via its team.
    const byTeam = await getBudgetRulesForTeam(team.id!);
    expect(byTeam.some((r) => r.id === rule.id)).toBe(true);

    // Sequences advanced past restored ids: fresh inserts don't collide.
    const after = await createTeam(`Backup FK Team 2 ${stamp}`, owner);
    expect(after.id).toBeGreaterThan(team.id!);
  });
});
