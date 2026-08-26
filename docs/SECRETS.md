# AI Model Radar — Production Secrets & Security Inventory

This document maintains the complete inventory of operational secrets, third-party API credentials, encryption keys, and rotation procedures.

---

## 1. Secrets Inventory Matrix

| Environment Variable | Category | Required In Prod | Purpose | Scope / Least Privilege | Rotation Cadence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Infrastructure | **YES** | Primary PostgreSQL connection pool string (Neon/RDS/Supabase). | Full read/write access to model snapshots, events, user accounts, and audit tables. | 90 Days |
| `UPSTASH_REDIS_REST_URL` | Infrastructure | **YES** | Serverless Upstash Redis HTTP REST endpoint. | Rate limiter keys and sliding window counters. | 180 Days |
| `UPSTASH_REDIS_REST_TOKEN` | Infrastructure | **YES** | Bearer authentication token for Upstash Redis. | Rate limiting pipeline commands (`INCR`, `EXPIRE`). | 180 Days |
| `GITHUB_TOKEN` | Ingestion | Optional (Recommended) | GitHub Personal Access Token or Fine-Grained Token. | Read-only public repository access (`public_repo`). Expands rate limit from 60/hr to 5,000/hr. | 90 Days |
| `ADMIN_SECRET` | Security & Observability | **YES** | Master secret protecting `/admin/health` internal dashboard and API. | Read-only pipeline observability and audit log inspection. | 90 Days |
| `CRON_SECRET` | Infrastructure | **YES** | Shared secret authorizing `/api/cron/*` endpoints (polling, pruning, digests). | Triggering automated background cron tasks. | 90 Days |
| `STRIPE_SECRET_KEY` | Billing | Optional (For Live Subscriptions) | Stripe Secret Key (`sk_live_...`). | Creating checkout sessions, customer portal sessions, and retrieving subscription statuses. | 180 Days |
| `STRIPE_WEBHOOK_SECRET` | Billing | Optional (For Live Subscriptions) | Stripe Webhook signing secret (`whsec_...`). | Cryptographic HMAC-SHA256 signature verification for subscription webhooks. | 180 Days |
| `RESEND_API_KEY` | Email Notifications | Optional (For Live Email) | Resend REST API Key (`re_...`). | Sending daily/weekly intelligence digests and alert notifications. | 180 Days |
| `UNSUBSCRIBE_SECRET` | Security & Privacy | **YES** | HMAC signing key for generating one-click unsubscribe links. | Generating and verifying constant-time HMAC-SHA256 email tokens. | 1 Year |

---

## 2. Emergency Secret Rotation Procedures

### Rotating `DATABASE_URL`
1. Provision new credentials in Postgres host (Neon/RDS/Supabase).
2. Update deployment environment variables in Vercel / Cloudflare / Railway.
3. Deploy new release or trigger zero-downtime configuration reload.
4. Verify DB health at `/api/admin/health` using `ADMIN_SECRET`.
5. Revoke old credentials in database host.

### Rotating `UPSTASH_REDIS_REST_TOKEN`
1. Generate secondary read-write token in Upstash Console.
2. Update `UPSTASH_REDIS_REST_TOKEN` in platform environment settings.
3. Verify rate limiting tests with `npm test`.
4. Delete primary compromised token in Upstash Console.

### Rotating `ADMIN_SECRET` or `CRON_SECRET`
1. Generate fresh 256-bit cryptographically secure token:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Update environment variable in hosting dashboard and GitHub Actions secret settings.
3. Update cron job runners with the new Bearer Authorization header.

---

## 3. Security Boundary Guarantees
- **No Secret Leaks in Git**: All `.env*` files are strictly git-ignored via `.gitignore`.
- **Fail-Loud Runtime**: Startup hook (`src/instrumentation.ts`) and `validateEnv()` immediately halt application boot in production if required variables are omitted.
- **Fail-Closed Abuse Protection**: If Redis is unconfigured or unreachable in production, public API routes fail closed with HTTP 429 rather than exposing backend resources.
