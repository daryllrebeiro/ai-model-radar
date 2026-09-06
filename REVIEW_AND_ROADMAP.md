# AI Model Radar - Architectural Review & Strategic Roadmap

> Review scope: full repository (`src/`, `scripts/`, `vercel.json`, `package.json`,
> `src/lib/db/schema.sql`, all 44 test files / 257 tests). Every claim below is anchored
> to a file and line number. Grades reflect production-readiness, not effort —
> this team ships fast and the core domain modeling is genuinely good.

## 1. Executive Summary & Health Assessment

**One-paragraph verdict:** AI Model Radar is a well-factored event-sourced market-intelligence
system (Next.js 14 / TypeScript strict / Postgres with a JSON-file dev fallback) whose
domain core — append-only `model_snapshots` + derived `model_events`, plus pure deterministic
engines for forecasts, signals, recommendations, probes, governance, and Q&A — is the right
architecture for the problem. The system is demo-strong and mid-scale-safe today. It is **not**
yet scale-safe: the read path loads entire tables into Node on hot routes, bulk writes are
row-by-row, two tier vocabularies disagree in the auth layer, and there is no CI. None of this
requires a rewrite. All of it requires a disciplined 4-week hardening pass before traffic grows.

### Overall System Maturity

| Dimension | Grade | Rationale |
|---|---|---|
| Architecture | **B+** | Event-sourced core (`schema.sql:4-36`), pure testable engines (`forecast.ts`, `signals.ts`, `probe.ts`, `governance.ts`, `ask-answer.ts`), clean feature-flag taxonomy (41 flags). Dragged down by the 2,266-line `queries.ts` god module and a duplicated legacy + `v1` API surface (~48 route files). |
| Code Quality | **B** | Strict TS, zod env validation with prod fail-fast (`instrumentation.ts:4-17`), HMAC webhook signatures, hashed API keys. Offset by `as any` clusters in auth/query plumbing, 10 legacy routes bypassing the structured logger, and swallowed promise rejections on write paths. |
| Maintainability | **B−** | Excellent engine-per-file separation; poor data-access separation (16 domains in one file); dual persistence backends (Postgres + local JSON) with diverging semantics that every new table must be hand-mirrored across (`client.ts`, `restore-db.ts`, `backup-db.ts` allowlists). |
| Performance | **C+** | Correct indexes on all 16 tables; Upstash Redis REST rate limiting with prod fail-closed (`api-auth.ts:118-126`). But: `getEvents` loads the whole events table + a LATERAL subquery per row and paginates in memory (`queries.ts:176-347`); bulk inserts are N round trips inside one transaction; `DISTINCT ON` full-table scans back every "latest snapshot" read. Safe to ~10⁵ rows, cliff beyond. |
| Test Coverage | **B+** | 44 files / 257 tests, route-level + engine-level, deterministic `asOf` patterns. Zero E2E, no CI workflow, serial execution (`fileParallelism: false`), no coverage gates, and 3 test files carry accepted `tsc` drift instead of fixes. |

### Architectural Philosophy

**Core strengths (keep and extend):**
1. **Append-only event sourcing where it matters.** `model_snapshots` (immutable poll log) →
   derived `model_events` (the product) is exactly right for a price-history moat. The schema
   is disciplined: composite `(model_id, polled_at DESC)` / `(event_type, detected_at DESC)`
   indexes, FK cascades on teams/governance tables, `CHECK (monthly_budget_usd > 0)`.
2. **Pure engines, routes second.** Forecast, signals, recommendation, probe-health,
   governance, ask-answer, and briefs are side-effect-free functions with injected clocks
   (`asOf`). This is why 257 tests run in ~6s of test time. Do not regress this pattern.
3. **Defense in depth at the edges.** SHA-256-hashed API keys with prefix identification
   (`api-keys.ts:28-52`), revoked-key checks on verify, tiered rate limits (60/300/1200),
   Stripe webhook signature verification, HMAC unsubscribe tokens with `timingSafeEqual`,
   zod-validated env with production boot halt on misconfiguration.

**Fundamental structural risks:**
1. **Two databases, one contract, zero enforcement.** Every feature must hand-mirror
   Postgres DDL, `LocalDbState`, and two backup/restore allowlists. The local adapter
   already diverges semantically (in-memory filtering, id-from-array-length, `as any` casts
   at `queries.ts:1074-1412`). This tax compounds with every table.
2. **The read path doesn't push work to the database.** Filtering, sorting, latest-per-model
   reduction, and pagination happen in Node over full-table loads. Postgres is currently used
   as a dumb row store with good indexes that the hot queries barely exploit.
3. **Authorization runs on two tier vocabularies.** API keys speak `free | developer |
   production`; feature flags speak `free | pro | enterprise`; nothing maps between them
   (see §3, P0-1). Enforcement is off today (`FEATURE_ENFORCEMENT` unset), which is the only
   reason this is latent rather than live.

### Primary Bottlenecks

1. **`getEvents` full-table materialization** (`queries.ts:176-347`) — no `LIMIT`/`OFFSET`
   in SQL, a `LEFT JOIN LATERAL` against `model_snapshots` executed per event row, then
   in-memory filter/sort/paginate. Every changelog, forecast, ask, digest, and MCP call pays
   O(table) memory and latency. Combined with an unscheduled prune route, this is the
   production cliff.
2. **Write amplification on hot paths** — row-by-row `INSERT`s inside transactions
   (`insertSnapshots`, `insertEvents`), a fire-and-forget `updateApiKeyLastUsed` write on
   *every* authenticated request (`api-keys.ts:85`), and local-mode full-file
   read-modify-write per insert (`client.ts:123-125`). Hourly polls × 400 models × full
   file rewrites is the dev-mode canary for the prod write pattern.
3. **No delivery pipeline for quality** — no CI workflow, serial test files, no coverage
   gates, `tsc` drift normalized in 3 test files. Velocity risk, not just quality risk:
   the team currently verifies by running the suite manually.

---

## 2. In-Depth Engineering Review

### Design Patterns & Modularity

**Cohesion is high where it counts.** Each market-intelligence capability is one cohesive
module with a narrow interface: `forecast.ts` (266 lines), `signals.ts` (352),
`recommendation.ts` (215), `probe.ts` (336), `governance.ts` (209), `ask-answer.ts` (432),
`briefs.ts` (162). Retrieval (`mcp/tools.ts`, 381 lines) reuses these engines rather than
reimplementing math. The `IRateLimiter` interface with `InMemory` / `UpstashRedis`
implementations (`api-auth.ts:22-30`) is textbook dependency inversion and makes the rate
limit tests hermetic.

**Coupling problems, ranked:**
- `src/lib/db/queries.ts` (2,266 lines, 16 domains: snapshots, events, users, keys,
  watchlists, alerts, teams, profiles, telemetry, budgets, approvals…) is a god module.
  Blast radius of any edit is the whole data layer; parallel feature work collides here
  constantly. Split by domain with a barrel re-export — mechanical, high-ROI.
- **Duplicated API surface.** Legacy `/api/arbitrage` + `/api/v1/arbitrage`, `/api/models` +
  `/api/v1/models`, `/api/events` + `/api/v1/events`. The legacy routes carry their own
  error handling (`console.error` in 10 files) instead of `handleApiError`. Every behavior
  change ships twice or ships inconsistently.
- **Retrieval assembly duplicated between routes and MCP.** `mcpAskRadar` (`tools.ts`)
  rebuilds the snapshot/event/signal/forecast/telemetry context that
  `POST /api/v1/ask` also builds. Extract one `buildAskContext()` service consumed by both;
  same for forecast context. The next feature that needs "everything" will otherwise copy
  the block a third time.
- **Leaky dev/prod abstraction.** `isPostgres()` branches inside every query function mean
  business logic reads two implementations. Callers cannot tell which semantics they got
  (e.g., local `getEvents` joins against *first-seen* snapshot order, Postgres against
  latest-per-model LATERAL — subtly different `provider` attribution).

### Data Architecture & Persistence

**Schema design: genuinely good.** Append-only facts, derived events, audit tables
(`ingestion_runs`, `digest_deliveries`), FK `ON DELETE CASCADE` throughout teams/governance,
sensible indexes per access pattern. The `model_current` VIEW (`schema.sql:120-128`)
shows the team knows latest-per-model is the hot read.

**Query patterns: the schema's indexes are underused.**
- `getLatestSnapshotsMap` runs `SELECT DISTINCT ON (model_id) *` over the *entire history
  table* — `*` includes the `raw_json` JSONB blob per row — on every forecast/recommend/
  ask/telemetry/digest request. The existing `model_current` view is unused by code; and
  the view itself aggregates full history per read (no materialization).
- `getEvents` (detailed above) is the worst offender: unbounded `SELECT` + per-row LATERAL
  + in-memory pagination. The cursor/pagination framework (`pagination.ts`,
  `encodeCursor`/`decodeCursor`) is well built and then defeated by slicing an in-memory array.
- Bulk ingestion is N sequential round trips inside `BEGIN/COMMIT`. One hourly poll of
  ~400 models = 400+ sequential INSERTs plus 400+ event INSERTs. A single multi-row
  `INSERT ... VALUES` or `UNNEST` batch cuts this to 2 round trips.

**Migration hygiene: weakest link.** There is no versioned migration runner (no
drizzle/prisma/node-pg-migrate in `package.json`). `initDb` (`client.ts:144-154`) replays
the whole `schema.sql` with `CREATE TABLE IF NOT EXISTS` — additive-only, no `ALTER` path,
no rollback story, no migration history table. Sixteen tables were added this way without
incident, which proves the team is careful, not that the process is safe. The first
column rename or backfill will hurt.

**Local-mode integrity gaps** (dev/test only, but tests run here): ids derived from
`state.events.length + 1` (`client.ts:188`, `queries.ts:49-97`) collide after deletes;
whole-file `writeFileSync` per insert with no locking (hence `fileParallelism: false` in
`vitest.config.ts` — serialization as a correctness strategy); `updated_at` never
auto-updates anywhere (no triggers, no application writes).

**Caching strategy: absent by design, and felt.** No read cache exists; identical
"latest snapshots + 500 events" context is recomputed per request across ask/forecast/
recommend/digest/MCP. Upstash is already a dependency (rate limiting) — the natural
second use is a short-TTL market-context cache, not a new vendor.

### Error Handling & Fault Tolerance

**Good bones:** webhook delivery has retries with exponential backoff + jitter, per-attempt
`AbortController` timeouts, HMAC signing, and an audit row per delivery (`webhooks.ts:40-117`).
Probes have per-sample timeouts (`probe.ts:87-96`) and health classification with reasons.
Upstash failures fail closed in production (`api-auth.ts:118-126`) — the right call for a
rate limiter — and fail loud in dev.

**Gaps, ordered by blast radius:**
1. **Ingestion fetches have no timeouts.** `fetchOpenRouterModels` (`openrouter.ts:12-19`),
   HuggingFace (`huggingface.ts:9`), GitHub Labs (`github-labs.ts:75-78`), and the heartbeat
   ping (`runner.ts:36`) all await unbounded. `/api/cron/poll` has `maxDuration = 60`; one
   hung upstream aborts the entire hourly ingestion cycle. The codebase already owns the
   correct pattern (`probe.ts`, `webhooks.ts`) — it just wasn't applied to ingestion.
2. **Swallowed rejections on write paths.** `updateApiKeyLastUsed(hash).catch(() => {})`
   (`api-keys.ts:85`) and `recordDigestDelivery(...).catch(() => {})` (`webhooks.ts:94`)
   discard failures silently. The first hides a broken keys table behind normal-looking
   traffic; the second holes the delivery audit log.
3. **Split-brain error reporting.** Ten legacy routes `console.error` ad hoc
   (`api/arbitrage`, `api/events`, `api/deals`, `api/models*`, `api/community`,
   `api/stats`, `feed.xml`, `feed/json`) while newer code uses `logger` + `handleApiError`
   + `captureException`. No `Error` context, no correlation, and `errors.ts` is
   "Sentry-ready" with no transport wired — `captureException` formats a report and logs it.
4. **Local-mode `catch { return empty }`** (`client.ts:101`) converts corrupt state into
   silent empty results. Acceptable for dev; ensure `initDb` refuses production without
   `DATABASE_URL` (it does — `env.ts:90-92`).

### Observability & Diagnostics

**Present:** structured JSON logs with child correlation contexts (`logger.ts:20-76`,
`runId` propagation), `ingestion_runs` per-source audit rows with `partial` status support,
`digest_deliveries` per-send audit, `/api/admin/health` route, `HEARTBEAT_URL` pinged by
the poll runner. This is better than most systems at this stage.

**Missing, in priority order:**
1. **No metrics.** Zero counters/histograms/gauges: no request latency, no poll duration,
   no event-emission rate, no probe-health ratio, no digest delivery rate. Logs-only
   observability cannot alert. The heartbeat covers "poll ran," not "poll is slow/degraded."
2. **No tracing.** No OTEL; a slow `POST /api/v1/ask` (5 sequential data fetches + engines)
   cannot be attributed across snapshot/event/signal/forecast/telemetry stages. At minimum,
   stage-timing fields in the response and logs.
3. **Cron failure alerting is log-only.** Digest and probes crons log failures
   (`logger.error`) with no heartbeat, no dead-man's-switch, no delivery-rate check.
   Extend the existing heartbeat pattern to all three scheduled routes.
4. **Log volume risk.** `getSessionUser` emits a debug line per unauthenticated request
   path (`auth.ts:28`); fine at current scale, noisy under scrape traffic. Sample or gate
   behind `DEBUG`.

### Testing & Quality Assurance

**Genuinely strong foundation:** 44 files / 257 tests mixing pure-engine unit tests
(intent routing, citation validation, forecast math with injected `asOf`) and HTTP-level
route tests (401/400/200 shapes, citation-validated flags). The `asOf` determinism pattern
is exactly what enables the roadmap's hold-out calibration requirement.

**Gaps:**
- **No E2E.** No playwright/cypress dependency; nothing exercises signup → watchlist →
  alert → digest, or the `/ask` chat flow, in a browser. Route tests mock nothing at the
  HTTP layer (good) but stop at JSON shapes.
- **No CI.** No `.github/workflows`. The suite is verified by hand. Combined with manual
  `tsc`/`eslint`/`build` runs, regressions are a matter of time, not possibility.
- **Serial execution.** `fileParallelism: false` (required by the shared local JSON file)
  makes the suite take ~84s wall for ~6s of test time. Splitting the local store per file
  (env-scoped `RADAR_DATA_PATH`) recovers parallelism.
- **Normalized drift.** Three test files fail `tsc` (advanced-alerts ×8, my-stack ×3,
  redis-rate-limit ×4 — the last mutates readonly `process.env.NODE_ENV`). Accepted drift
  becomes a place to hide new drift. Fix the 15 errors; they are all small.
- **Test seam in production code.** `(globalThis as any).__SIMULATE_STRIPE_CANCEL_FAILURE`
  (`billing/stripe.ts:147`) is a global flag any caller can flip. Move to injected
  options; globals in billing paths erode auditability.
- **No coverage gates, no load tests in CI.** `docs/load-test-results/` exists as a
  directory — results without a repeatable harness decay immediately.

---

## 3. Critical Modifications & Technical Debt Remediation

| Priority | Category | Component / Module | Issue / Technical Debt | Impact If Ignored | Recommended Fix |
|---|---|---|---|---|---|
| **P0** | AuthZ correctness | `auth.ts:38-41`, `queries.ts:1123-1165`, `feature-flags.ts:72-80` | API-key tiers (`free/developer/production`) are stored verbatim into `users.tier` and never mapped to access tiers (`free/pro/enterprise`). `hasAccess` returns `false` for any unknown tier. Additionally `createOrGetUser` returns existing rows without updating tier (first-write-wins staleness). The day `FEATURE_ENFORCEMENT=true` flips, every `developer`/`production` key holder gets 403 on all gated features, and paying users created earlier as `free` stay `free`. | Billing launch is dead on arrival; support incident on cutover day | Add canonical `normalizeTier()` mapping (`developer→pro`, `production→enterprise`) applied at auth time; upgrade stored tier when the presented credential outranks it; backfill existing rows. Before/after below. |
| **P0** | Read-path scalability | `queries.ts:176-347` (`getEvents`) | Unbounded `SELECT` + per-row `LATERAL` snapshot join, full in-memory filter/sort/paginate. Memory and latency grow with the events table; prune is unscheduled so growth is unbounded. | OOM / multi-second responses on changelog, forecast, ask, digest as history accumulates; single incident away from cascading cron timeouts | Push predicates + keyset pagination into SQL; replace LATERAL with a join to a materialized current-state table. Before/after below. |
| **P1** | Write-path scalability | `queries.ts:13-107` (`insertSnapshots`, `insertEvents`) | N sequential round trips inside one transaction per poll cycle (~800+ for 400 models). | Poll duration grows linearly; risks breaching `maxDuration = 60` on `/api/cron/poll`; Postgres connection held open under `max: 10` pool. | Single multi-row `INSERT` per table (or `UNNEST`), one transaction. Before/after below. |
| **P1** | Fault tolerance | `ingestion/openrouter.ts:12`, `huggingface.ts:9`, `github-labs.ts:75`, `runner.ts:36` | No fetch timeouts on any ingestion path while the cron ceiling is 60s. | One hung upstream (OpenRouter/GitHub) silently kills the hourly cycle; dead market data with only a timeout log as evidence. | Shared `fetchWithTimeout()` helper (reuse the `webhooks.ts`/`probe.ts` pattern); per-source budgets summing under 60s. |
| **P1** | Read-path scalability | `queries.ts:112-149` (`getLatestSnapshotsMap`), `schema.sql:120-128` | `SELECT DISTINCT ON ... *` (incl. `raw_json` JSONB) over full history per request; `model_current` view exists but unused and itself unmaterialized. | Same cliff as P0-2, hit by more routes (forecast, recommend, ask, telemetry, digest, MCP). | Materialized `model_current` table refreshed transactionally at poll end (`REFRESH MATERIALIZED VIEW CONCURRENTLY`); slim column lists (exclude `raw_json` except detail routes). |
| **P1** | Data retention | `vercel.json`, `api/cron/prune/route.ts` | Prune route exists but is not scheduled; events/snapshots/telemetry grow forever. | Turns every O(table) read into a time bomb; storage cost; slower `pg_dump` backups. | Schedule weekly prune; define retention policy (e.g., snapshots 90d, raw_json 30d, telemetry 30d); enforce `PRUNE_DAYS` in code review. |
| **P1** | Dev-store integrity | `db/client.ts:123-125,159-214`, `queries.ts:47-107` | Whole-file read-modify-write per insert, no locking, ids from array length (collide after deletes), silent-empty on corrupt JSON. | Lost updates under any concurrency; id collisions corrupt test/dev data; forces serial test execution. | Per-operation write queue (or env-scoped store files per test file); monotonic id sequence persisted in-file; refuse local mode in production with a hard error instead of silent fallback. |
| **P1** | Diagnostics | 10 legacy routes (`api/arbitrage:22`, `api/events:32`, `api/deals:11`, `api/models*:21-29`, `api/community:15`, `api/stats:11`, `feed.xml:57`, `feed/json:41`) + `api-auth.ts:117` | Ad-hoc `console.error` bypasses structured logging; no correlation ids; inconsistent shape. | Incidents in legacy routes are undebuggable from logs; alerting rules can't match. | Route all through `logger` + `handleApiError` with request context (mechanical sweep, ~1 day). |
| **P1** | Reliability | `api-keys.ts:85`, `webhooks.ts:94` | Swallowed `.catch(() => {})` on `updateApiKeyLastUsed` and `recordDigestDelivery`. | Silent audit holes: broken keys table or delivery log looks healthy. | Log at debug/warn with context; add a periodic consistency check (keys with null `last_used_at` but recent traffic). |
| **P2** | Security hygiene | `lib/email/resend.ts` (`renderDigestHtml`) | Email HTML interpolates `model_name`, forecast names, brief headlines raw; model names originate from upstream provider APIs. Sanitizers exist (`sanitize.ts`) and are used for badges/RSS/unsubscribe — but not email. | Stored-XSS-via-email: a malicious upstream model name executes in the recipient's mail client. Low likelihood, real vector. | Apply `escapeHtml` to all interpolated upstream strings in email templates (mirrors `feed.xml` pattern). |
| **P2** | Security hygiene | `middleware.ts:15-16`, cron routes | `x-admin-secret` / `CRON_SECRET` compared with `===` (non-constant-time). | Timing side-channel on secret comparison. Trivial to fix with `timingSafeEqual` (already used for unsubscribe tokens). | Constant-time compare helper shared by middleware + cron routes. |
| **P2** | Modularity | `queries.ts` (whole file) | 2,266-line god module across 16 domains. | Merge conflicts, review fatigue, unbounded blast radius. | Split `queries/` by domain (`snapshots.ts`, `events.ts`, `users.ts`, …) with barrel re-export; no behavior change; enforce per-file limits in lint. |
| **P2** | Modularity | `mcp/tools.ts` vs `api/v1/*` routes | Retrieval-context assembly duplicated (ask, forecast). | Third consumer copies the block again; divergence between API and MCP answers. | Shared `buildAskContext()` / `buildForecastContext()` services (also unit-testable once). |
| **P2** | API lifecycle | `/api/*` vs `/api/v1/*` duplicates | Two surfaces, two error styles, double maintenance. | Behavior skew; security fixes applied once. | `Deprecation` + `Sunset` headers on legacy routes, 2-release removal, docs note. |
| **P2** | Throughput | `api/cron/digest/route.ts:58-105` | Sequential per-recipient awaits (watchlist → profile → render → send). | Digest wall-time grows linearly with subscribers; breaches serverless limits first. | Batch independent fetches; bounded concurrency (e.g., 5) for send; per-recipient try/catch so one failure doesn't abort the run. |
| **P2** | Test hygiene | `billing/stripe.ts:147`, 3 drift files | Global test seam in billing code; accepted `tsc` drift; `NODE_ENV` mutation. | Auditability erosion; drift camouflage. | Inject failure behavior via options param; fix the 15 type errors; freeze `process.env` handling in tests. |
| **P2** | Schema hygiene | `schema.sql` | Free-text `tier`/`role`/`status` columns without `CHECK`; `updated_at` never maintained. | Invalid states persist silently (see P0-1: `tier='production'`). | `CHECK` constraints + `updated_at` trigger; backfill + normalize existing rows. |

### Before/after: P0 tier normalization (`auth.ts`, `feature-flags.ts`)

Before — vocabularies disagree, staleness persists:
```ts
// auth.ts — key tier stored verbatim, existing users never upgraded
const user = await createOrGetUser({ email, tier: verification.tier }); // 'production' stored raw
// feature-flags.ts — unknown tier => deny everything
const userIndex = TIER_ORDER.indexOf(userTier as AccessTier); // 'production' -> -1
if (userIndex === -1) return false;                            // 403 everywhere
```

After — single canonical vocabulary, monotonic upgrades:
```ts
// feature-flags.ts
const KEY_TIER_TO_ACCESS_TIER: Record<string, AccessTier> = {
  free: 'free', developer: 'pro', production: 'enterprise',
  pro: 'pro', enterprise: 'enterprise',           // already-canonical values pass through
};
export function normalizeTier(tier: string | null | undefined): AccessTier {
  if (!tier) return 'free';
  return KEY_TIER_TO_ACCESS_TIER[tier.toLowerCase().trim()] ?? 'free'; // never -1
}
// auth.ts — upgrade stored tier when the credential outranks it
const accessTier = normalizeTier(verification.tier);
const user = await createOrGetUser({ email });
if (TIER_ORDER.indexOf(accessTier) > TIER_ORDER.indexOf(normalizeTier(user.tier))) {
  await updateUserTier(email, accessTier);        // monotonic, audited
}
// + one-time backfill: UPDATE users SET tier='enterprise' WHERE tier='production', etc.
```

### Before/after: P0 `getEvents` SQL pagination (`queries.ts:176-347`)

Before — unbounded load, per-row LATERAL, in-memory page:
```ts
const res = await pool.query(`SELECT e.*, ... FROM model_events e
  LEFT JOIN LATERAL (SELECT ... FROM model_snapshots ms
    WHERE ms.model_id = e.model_id ORDER BY polled_at DESC LIMIT 1) s ON true
  WHERE ${whereSql} ORDER BY e.detected_at DESC`);   // NO LIMIT — whole table
allEvents = res.rows.map(...);
filtered = allEvents.filter(...).sort(...);          // Node does the DB's job
const paginated = filtered.slice(offset, offset + limit);
```

After — bounded, index-respecting, keyset-stable:
```sql
-- predicates + ordering match idx_events_* indexes; keyset avoids OFFSET drift
SELECT e.id, e.model_id, e.event_type, e.pct_change, e.detected_at,
       c.name AS model_name, c.provider, c.context_length, c.modality, c.is_free
FROM model_events e
LEFT JOIN model_current_mat c ON c.model_id = e.model_id
WHERE ($1::text[] IS NULL OR e.event_type = ANY($1))
  AND ($2::timestamptz IS NULL OR e.detected_at >= $2)
  AND ((e.detected_at, e.id) < ($3, $4))             -- keyset cursor, matches ORDER BY
ORDER BY e.detected_at DESC, e.id DESC
LIMIT $5;
-- provider/search/isFree pushed down where selective; total via COUNT(*) OVER() or a
-- cached counter, not .length on the full set.
```
Note the `model_current_mat` join also eliminates the per-row LATERAL (ties to P1-5).

### Before/after: P1 bulk inserts (`queries.ts:13-107`)

Before — 800+ sequential round trips per poll inside one long transaction:
```ts
await client.query('BEGIN');
for (const s of snapshots) { await client.query(`INSERT INTO model_snapshots ...`, [...]); }
for (const e of events)    { await client.query(`INSERT INTO model_events ...`, [...]); }
await client.query('COMMIT');
```

After — 2 round trips, same atomicity:
```ts
await client.query('BEGIN');
if (snapshots.length) {
  const cols = ['model_id','provider','name','price_prompt','price_completion',
                'context_length','modality','is_free','raw_json','polled_at'];
  const { text, values } = buildMultiRowInsert('model_snapshots', cols, snapshots);
  await client.query(text, values);               // one statement; chunk at ~5k rows
}
// same for events
await client.query('COMMIT');
// buildMultiRowInsert uses positional $n placeholders or UNNEST arrays — both keep
// parameterization (no string-interpolated values, injection-safe by construction).
```

### Before/after: P1 ingestion timeouts

Before — unbounded waits under a 60s cron ceiling:
```ts
const response = await fetch(url, { headers, cache: 'no-store' }); // openrouter.ts:12
```

After — shared helper, per-source budgets:
```ts
// lib/fetch-timeout.ts
export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 15000, ...rest } = init;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...rest, signal: controller.signal, cache: 'no-store' }); }
  catch (err: any) {
    throw new Error(`fetch timeout after ${timeoutMs}ms: ${url} (${err?.name ?? 'error'})`);
  } finally { clearTimeout(id); }
}
// runner budgets: openrouter 20s + github 15s + huggingface 10s < 60s cron ceiling,
// each source failure degrades to 'partial' (ingestion_runs already supports it).
```

---

## 4. Optimization & Enhancement Recommendations

### Performance & Scalability
- **Bound every hot read.** After the `getEvents` rewrite, apply the same treatment to
  `getModelCurrentList` and telemetry history: column lists (never `SELECT *` with
  `raw_json`), SQL-side `LIMIT`, keyset cursors (already designed — wire them through).
- **Pool for serverless reality.** `max: 10` per instance (`client.ts:28`) with no
  `statement_timeout` and no `connectionTimeoutMillis`. Add both (e.g., 15s / 5s), and put
 PgBouncer/Neon-pooled connections in front before traffic grows — serverless functions
  multiply pools per instance.
- **Cache the market context.** `getLatestSnapshotsMap` + `getEvents({limit:500})` is
  recomputed identically by ask/forecast/recommend/digest/MCP within seconds of each other.
  Short-TTL (60–120s) Upstash cache on the assembled context — the vendor is already
  integrated, no new dependency. Invalidation: poll completion bumps a version key.
- **Digest fan-out.** Batch the per-recipient independent reads; cap send concurrency;
  isolate per-recipient failures. At 1k subscribers the current sequential loop is a
  guaranteed cron-timeout incident.
- **Static-leaning routes to the edge.** RSS/JSON feeds, SVG badges, and the public model
  list are highly cacheable — `Cache-Control: s-maxage` + CDN. They currently recompute per
  hit against the database.

### Developer Experience (DX) & Tooling
- **CI first, everything else second.** One workflow: `tsc --noEmit` (including tests —
  fix the drift first), `eslint` on the repo, `vitest run`, `next build`. Add Postgres
  service container and run the suite twice (local-file mode + `DATABASE_URL` mode) —
  the dual-backend drift (§2) is otherwise unverifiable.
- **Dev/prod parity.** Add `docker-compose.yml` with Postgres (+ optional Redis) so the
  default local path exercises the production backend. Keep the JSON fallback for
  zero-dependency onboarding, but make CI run Postgres mode mandatory.
- **Break up `queries.ts` now, not later.** Domain files + barrel export; zero behavior
  change; enforce a soft per-file line budget via a lint rule or PR checklist.
- **Type strictness that pays.** Enable `noUnusedLocals` + `noUncheckedIndexedAccess`
  after the drift cleanup; promote `@typescript-eslint/no-explicit-any` from warn to error
  in `src/` (keep warn in tests). The `as any` clusters mark exactly where runtime risk lives.
- **Migration runner.** Adopt a versioned runner (drizzle-kit / node-pg-migrate / even
  numbered SQL files + a `schema_migrations` table applied by `scripts/migrate.ts`)
  before the first `ALTER`. The current replay-`schema.sql` approach cannot express
  renames, backfills, or rollbacks.
- **Kill the serial-test tax.** Env-scoped store files (`RADAR_DATA_PATH=.radar-test-<worker>.json`
  via `vitest` pool options) restore `fileParallelism` and cut ~80s wall time.

### Security & Hardening Quick-Wins
- Constant-time secret comparison for `x-admin-secret` and `CRON_SECRET`
  (5-line helper, reuse `timingSafeEqual` pattern from unsubscribe tokens).
- `escapeHtml` on all upstream-derived strings in email templates.
- Distinct key prefixes per environment/purpose (`amr_test_` for test issuance;
  never `amr_live_` outside prod) — prefix confusion enables pasting test keys into prod.
- Tighten CORS when billing goes live: replace `Access-Control-Allow-Origin: *` on
  authenticated API responses with an explicit origin allowlist.
- Require `CRON_SECRET` + `ADMIN_SECRET` in production env validation (currently only
  length-checked when present, `env.ts:7-8`), matching the `AUTH_SECRET` treatment.
- Audit the fire-and-forget `last_used_at` write: batch it (e.g., update at most once per
  key per minute) to remove per-request write amplification while keeping the signal.

---

## 5. Future Engineering & Feature Roadmap

### Phase 1: Stabilization & Hardening (Short-Term: Weeks 1–4)

Goal: remove the P0s, make quality automatic, stop the growth cliff. No new user features.

| # | Work item | DoD |
|---|---|---|
| 1.1 | Tier normalization + monotonic upgrade + existing-row backfill; enforcement-on test matrix (free/pro/enterprise × session/key) | `FEATURE_ENFORCEMENT=true` green in CI; cutover runbook in `docs/` |
| 1.2 | `getEvents` SQL-side filtering/sorting/keyset pagination; drop LATERAL | p95 changelog latency measured before/after on 100k seeded events; memory flat |
| 1.3 | Multi-row bulk inserts for snapshots/events | Poll duration measured; ≤3 DB round trips for writes |
| 1.4 | `fetchWithTimeout` on all ingestion paths; per-source budgets < 60s; `partial` status exercised | Kill-upstream test: hung OpenRouter still yields partial run |
| 1.5 | Schedule prune (weekly); publish retention policy; `PRUNE_DAYS` honored | Table sizes stable week-over-week in staging |
| 1.6 | Logger sweep of 10 legacy routes; `captureException` wired to an error transport (Sentry or equivalent) | Zero `console.error` outside `logger.ts`/CLI; test alert fires end-to-end |
| 1.7 | CI workflow (tsc incl. tests, eslint, vitest in both DB modes, build) + fix 15 type errors in 3 drift files | Red main is impossible; drift files clean |
| 1.8 | Constant-time secrets, email escaping, `CRON/ADMIN_SECRET` prod-required, test key prefixes | Security checklist signed off in review |

### Phase 2: Architectural Scaling & Performance (Medium-Term: Month 2–3)

Goal: pay down structural debt, prepare for 10× data and traffic.

| # | Work item | DoD |
|---|---|---|
| 2.1 | Split `queries.ts` by domain + barrel; shared `buildAskContext()`/`buildForecastContext()` for routes + MCP | No file >400 lines in `db/`; MCP/route parity test |
| 2.2 | Materialized `model_current` refreshed transactionally at poll end; slim hot-path column lists | "Latest snapshot" reads O(models), not O(history); `raw_json` absent from hot paths |
| 2.3 | Market-context cache (Upstash, 60–120s TTL, version-key invalidation on poll) | Cache hit rate dashboarded; p95 ask/forecast latency down |
| 2.4 | Digest fan-out: batched reads, bounded send concurrency, per-recipient isolation; heartbeat on digest + probes crons | 1k-recipient digest completes in-budget in staging; dead-man alert configured |
| 2.5 | Versioned migration runner + `schema_migrations`; first migration exercised (e.g., tier `CHECK` + backfill from 1.1) | Rollback tested on staging |
| 2.6 | E2E smoke (Playwright): signup → watchlist → alert → digest; `/ask` flow; pricing gate rendering | E2E in CI on preview deploys |
| 2.7 | Coverage gates (statements/branches on engines ≥90%) + pg pool/statement-timeout tuning + CDN caching for feeds/badges | Coverage enforced; pool exhaustion playbook in runbook |
| 2.8 | Legacy `/api/*` deprecation headers + sunset schedule; local-adapter decision (harden vs SQLite vs remove) | ADR-1 closed; deprecation announced in docs |

### Phase 3: Next-Generation Feature Expansion (Long-Term: Month 4–6+)

Prerequisite for all: Phases 1–2 complete (bounded reads, enforced authZ, CI).

| Feature | Business / Technical Value | Complexity | Architectural Prerequisites |
|---|---|---|---|
| Forecast calibration dashboard | Proves the F1 precision claim (roadmap hold-out DoD); publishable proof vs incumbents | Med | 1.2 (event queries at scale), 2.2; 30 days of post-launch events |
| Real-time anomaly push (extend existing SSE `/api/v1/stream`) | Moves alerts from poll-latency to seconds; enterprise upsell | Med | 2.3 cache as pub substrate or dedicated bus (ADR-2); 2.4 fan-out |
| BYO provider keys for F3 profiles | Unlocks real workload data; migration savings become measured, not estimated | High | Secrets-at-rest story (KMS/envelope encryption — new ADR if scoped); 1.1 tier enforcement |
| Team budget enforcement actions (webhook on breach, auto-pause recommendations) | Turns F4 from observability into control; enterprise retention | Med | 1.1, 2.5 (approval/audit schema evolution), webhook infra (exists) |
| Audit-log UI + data export v2 | Compliance sales (SOC2-adjacent evidence), GDPR completeness | Low–Med | 2.1 (query split); export currently sync — needs async job path (ADR-2) |
| Multi-source reconciliation confidence | Second ingestion source per model family; "verified price" badge; moat deepening | High | 1.4 timeouts/budgets; source-priority + conflict-resolution rules in `ingestion/diff.ts` |
| Public status page (probe-derived uptime) | Marketing from measurement moat; transparency | Low | 2.2 (cheap latest-telemetry reads); existing `evaluateEndpointHealth` |

Out of scope until product pull is proven: multi-region writes, DB sharding, event-driven
microservices. The monolith with bounded queries serves 10–100× current scale.

---

## 6. Technical Decision Log (ADR Recommendations)

**ADR-1 — Local JSON backend: harden, replace with SQLite, or remove?**
Context: the file backend buys zero-dependency onboarding but costs dual-implementation
drift, serial tests, and semantics that diverge from Postgres (filtering, ids, locking).
Options: (a) keep + harden (write queue, monotonic ids, env-scoped files); (b) SQLite via
better-sqlite3/Drizzle for a real SQL backend in dev; (c) remove, require Docker Postgres.
Recommendation: (b) — preserves one-command onboarding while collapsing two query
implementations into one SQL dialect family. Decide before 2.8; the test-parallelism and
drift fixes depend on it.

**ADR-2 — Async work: cronettes vs a job queue.**
Context: digest fan-out, bulk exports, backfills, and calibration jobs will all exceed
serverless `maxDuration` ceilings. Vercel cron + small-batch idempotent handlers scales to
mid-size; beyond that: QStash/Trigger.dev/BullMQ. Recommendation: stay on cron through
Phase 2 with strict per-run budgets and heartbeats; adopt a queue the first time a job
needs progress tracking, retries across runs, or >5min runtime (export v2 is the likely
trigger). Revisit at Phase 3 kickoff with measured cron durations in hand.

**ADR-3 — Current-state reads: materialized view vs application cache vs both.**
Context: latest-per-model is the hottest read shape. Options: (a) `REFRESH MATERIALIZED
VIEW CONCURRENTLY` at poll end (always fresh, Postgres-native, refresh cost O(history)
unless incremental); (b) Upstash-assembled context cache (fast, TTL-stale); (c) both —
matview as source of truth for reads, cache as latency shield.
Recommendation: (c), in that order — 2.2 then 2.3. Revisit partitioning (`model_snapshots`
by month) only when a single `REFRESH` exceeds the poll budget.

**ADR-4 — Enforcement and billing cutover.**
Context: `FEATURE_ENFORCEMENT` off means all gates are open; Stripe code paths
(checkout/portal/webhook, `__SIMULATE_*` seams) are untested against real money.
Decision needed: cutover sequence (normalize tiers → backfill → enforcement on in
staging → billing live → remove soft-gate code), grandfathering policy for existing
users/keys, and deletion of the `getPageFeatureTier` "everyone is enterprise" fallback.
Recommendation: execute 1.1 → 1.7 → staged cutover with the runbook; delete (don't
deprecate) the fallback within one release of billing live — dead auth paths are a
liability, not a safety net.

---

*Review conducted against repository state at 44 test files / 257 passing tests, `tsc`
clean for `src/`+`scripts/`, green `next build`. Re-run the Phase 1 exit criteria
(1.7) before treating any grade above as current.*
