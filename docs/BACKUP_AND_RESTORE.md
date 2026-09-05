# AI Model Radar — Database Backup, Restore & Disaster Recovery Runbook

## 1. Disaster Recovery Objectives
- **Recovery Point Objective (RPO)**: $\le 1\text{ hour}$ of data loss. Backups execute daily on schedule, and WAL / transactional logs replicate continuously on managed PostgreSQL.
- **Recovery Time Objective (RTO)**: $\le 15\text{ minutes}$ to restore full database schema and verified snapshot data.

---

## 2. Backup Execution
Backups are orchestrated via GitHub Actions workflow (`.github/workflows/backup.yml`) every day at 02:00 UTC, and can also be triggered on-demand via CLI:

```bash
# Manual snapshot creation
npm run db:backup
```

### Artifact Outputs (`backups/`)
1. `backup-YYYY-MM-DDTHH-mm-ss.json`: Full serialized JSON dump of `model_snapshots`, `model_events`, `ingestion_runs`, `api_keys`, `users`, `user_watchlists`, `alert_rules`, `digest_deliveries`, and `schema_migrations`.
2. `manifest-YYYY-MM-DDTHH-mm-ss.json`: Metadata manifest recording row counts, timestamp, database engine, and SHA-256 integrity checksum.

---

## 3. Restore Protocol & Integrity Verification

To restore a database dump into an active environment:

```bash
# Execute verified restore
npm run db:restore backups/backup-2026-08-25T12-00-00.json <expected_sha256_checksum>
```

### Step-by-Step Recovery Procedure
1. **Isolate Ingestion**: Stop ingestion poll jobs or pause GitHub Actions cron schedules to avoid writes during restoration.
2. **Verify Dump Checksum**: Compare computed SHA-256 of the backup file against the manifest before applying.
3. **Execute Restore**: Run `npm run db:restore <dump-file> <expected_sha256>` inside the target environment. The SHA-256 checksum argument is **mandatory** — restore will abort if omitted or mismatched.
4. **Validate Integrity**:
   - Query `/api/admin/health` with `Authorization: Bearer <ADMIN_SECRET>` header (not a query parameter) to verify total active model count.
   - Run integration tests: `npm test`.
5. **Resume Traffic**: Re-enable cron polling schedules.
