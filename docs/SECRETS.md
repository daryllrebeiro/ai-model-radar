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
| `SLACK_SIGNING_SECRET` | Security & Integrations | **YES if Slack bot enabled** | Slack v0 HMAC verification for `/api/bot/slash`. | Verifying Slack slash-command signatures (+5min timestamp tolerance). | 1 Year |
| `DISCORD_PUBLIC_KEY` | Security & Integrations | **YES if Discord bot enabled** | Ed25519 verification for `/api/bot/slash` Discord interactions. | Verifying Discord interaction signatures. | 1 Year (on bot re-install) |
| `EXPORT_CONNECTOR_KEY` | Security & Integrations | **YES if export connectors store tokens** | Key-encrypting key (SHA-256 → AES-256-GCM) for third-party connector tokens in `export_connectors.secret`. | Held in the deployment secret store ONLY — never in the database, backups, or logs. Readable solely by the app runtime (decrypts at delivery time). | 90 Days (see rotation below) |
| `ROUTING_UPSTREAM_KEY` | Routing Pilot (R10) | **YES if routing pilot enabled** | Bearer key for the upstream OpenAI-compatible endpoint proxied by `/api/v1/chat/completions`. | Outbound forwarding only. Without it the gateway answers 503. | 90 Days |
| `ROUTING_ENABLED` / `ROUTING_PILOT_ALLOWLIST` | Routing Pilot (R10) | Pilot control plane (not secrets, but access-critical) | Kill switch + operator allowlist (comma-separated emails) gating the routing gateway alongside per-user opt-in rows. | Changing either takes effect without a deploy being strictly required (env reload). | Review membership on every pilot change |
| `PROBE_OPENAI_KEY` | Active Probing (S4+S5) | **YES if drift/latency cycles enabled** | Dedicated generation key for canary-drift + latency cycles (OpenAI subset only). | Low-privilege, budget-capped (spend alert + hard cap at provider). Never reused for app traffic or routing. | 90 Days |
| `PROBE_ANTHROPIC_KEY` | Active Probing (S4+S5) | **YES if drift/latency cycles enabled** | Dedicated generation key for canary-drift + latency cycles (Anthropic subset only). | Low-privilege, budget-capped (spend alert + hard cap at provider). Never reused for app traffic or routing. | 90 Days |
| `ACTIVE_PROBE_BUDGET_CALLS` | Active Probing (S4+S5) | Optional (defaults to 30/run) | Hard cap override for paid generation calls per cycle. | Cycle aborts new calls past the cap; already-made calls are kept. | Review on cadence change |

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

### Instant user lockout (no server-side session revocation)
Sessions are stateless JWTs (7-day expiry, 24h rolling refresh) — there is no
server-side session kill switch. To lock out a compromised account immediately:
1. Revoke the user's API keys: `revokeUserApiKeys('<email>')` (or per-key
   `revokeApiKey(<key_hash>)`) — kills programmatic access at once.
2. Downgrade + cancel via Stripe dashboard (webhook handler revokes paid keys
   automatically on `customer.subscription.deleted`).
3. Nuclear option: rotate `AUTH_SECRET` — invalidates **all** sessions
   deployment-wide (all users re-authenticate via magic link).

### Rotating bot platform secrets
`SLACK_SIGNING_SECRET` / `DISCORD_PUBLIC_KEY` changes take effect on next
deployment (read per-request from env). After rotation, the other platform
keeps working; unset-both in production returns 503 (fail-closed).

### Rotating `EXPORT_CONNECTOR_KEY` (manual, executable as-is)
Single-key envelope (`enc:v1:`); there is no dual-key decrypt, so rotation
re-encrypts by re-registration. Old ciphertext becomes unreadable on purpose —
connector runs fail closed with an explicit "rotate the connector" signal
instead of delivering with the wrong key.
1. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Set the new value in the deployment secret store (same place as the old
   one — never in the database, backups, or chat).
3. Redeploy / reload env. Confirm the app boots (creation without a key
   would now 400, proving the new key is live: register a test connector
   with a dummy secret, then delete it).
4. For each connector with `has_secret=true`: delete and re-register it with
   its third-party token (or rotate the third-party token itself at the
   vendor, then re-register). Runs against not-yet-rotated rows fail with
   the explicit rotate signal — that is the detection mechanism.
5. Verify: `SELECT COUNT(*) FROM export_connectors WHERE secret NOT LIKE 'enc:v1:%'`
   must be 0 for rows expected to carry secrets; spot-run one connector per
   type and confirm `last_status='success'`.
6. Revoke/forget the old key value everywhere it was stored.

---

## 3. Security Boundary Guarantees
- **No Secret Leaks in Git**: All `.env*` files are strictly git-ignored via `.gitignore`.
- **Fail-Loud Runtime**: Startup hook (`src/instrumentation.ts`) and `validateEnv()` immediately halt application boot in production if required variables are omitted.
- **Fail-Closed Abuse Protection**: If Redis is unconfigured or unreachable in production, public API routes fail closed with HTTP 429 rather than exposing backend resources.
