# AI Model Radar — Production Incident Response & Rollback Runbook

This document defines incident classification, on-call triage protocols, standard operating procedures (SOPs), and instant rollback playbooks.

---

## 1. Incident Severity Matrix

| Severity Level | Definition | Response SLA | Paging Channel |
| :--- | :--- | :--- | :--- |
| **SEV-1 (Critical)** | Core web application down, database unavailable/corrupt, or rate limiter completely rejecting valid traffic across all tiers. | $< 15\text{ mins}$ | PagerDuty + `#prod-alerts` Paging Webhook |
| **SEV-2 (Major)** | Upstream ingestion provider (OpenRouter or GitHub) rate-limited/failing for $\ge 3$ consecutive cycles, or email digest delivery failing. | $< 1\text{ hour}$ | `#prod-alerts` Slack Webhook |
| **SEV-3 (Minor)** | Non-blocking telemetry anomaly, degraded response latency on secondary routes ($> 500\text{ms}$), or single webhook destination timeout. | $< 4\text{ hours}$ | Async GitHub Issue |

---

## 2. Standard Operating Procedures (SOPs)

### SOP 1: Upstream Ingestion Failure (3+ Consecutive Runs Failed)
1. Navigate to `/admin/health?secret=<ADMIN_SECRET>`.
2. Inspect the **Diagnostics** column in the Recent Ingestion Runs table.
3. If GitHub returned `HTTP 403 (rate limit exceeded)`:
   - Check if `GITHUB_TOKEN` is configured or expired.
   - Verify token quota at `https://api.github.com/rate_limit`.
4. If OpenRouter returned `HTTP 5xx`:
   - Note upstream outage in status banner; the platform maintains the latest cached model snapshots without synthesizing synthetic fallbacks.

### SOP 2: Distributed Redis Partition / Fail-Closed Rate Limiting
1. If API requests return `HTTP 429` with `CRITICAL: Upstash Redis rate limiter error`:
   - Verify Upstash Redis dashboard status.
   - Confirm `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in platform environment variables.
   - Rotate token if compromised (see `docs/SECRETS.md`).

### SOP 3: PostgreSQL Connection Pool Saturation
1. If queries return `Error: timeout exceeded when connecting to database`:
   - Check active connection count on Neon/RDS console.
   - Confirm serverless routes use pooled connection string with `max: 10` pool limits in `src/lib/db/client.ts`.
   - Restart edge/serverless instances to drain idle client leaks.

---

## 3. Instant Deployment Rollback Playbook (Section F)

### 3.1 Zero-Downtime Application Rollback
If a newly deployed release exhibits runtime regression, memory leaks, or unhandled route crashes:
1. **Hosting Platform Rollback (Vercel / Cloudflare / Railway)**:
   - In deployment dashboard, navigate to **Deployments**.
   - Locate the previous known-good deployment SHA.
   - Click **Instant Rollback / Promote to Production**. Rollback completes in $< 10\text{ seconds}$ without rebuilding.
2. **CLI Rollback Option (Vercel CLI)**:
   ```bash
   npx vercel rollback [deployment-id-or-url]
   ```

### 3.2 Database Schema Compatibility & Rollback Protocol
All database migrations (`001_initial_schema.sql` through `005_users_and_watchlists.sql`) are **additive and backwards-compatible** with the previous application release:
- New columns are created as nullable or with default values (`DEFAULT 'free'`, `DEFAULT NOW()`).
- Previous application code continues to function if pointed at the upgraded schema.
- In catastrophic database corruption, invoke Point-In-Time recovery via `npm run db:restore <verified-snapshot> [checksum]` per `docs/BACKUP_AND_RESTORE.md`.
