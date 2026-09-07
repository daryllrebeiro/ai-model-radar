# AI Model Radar - Architectural Review & Strategic Roadmap

> Review scope: full repository (`src/`, `scripts/`, `migrations/`, `tests/`, `vercel.json`,
> `package.json`, `.github/workflows/`, `src/lib/db/schema.sql`). Every claim is anchored to a
> file and line number. Grades reflect production-readiness, not effort — this team ships fast
> and the domain core is genuinely good. This review supersedes the earlier `01c0501` draft:
> Phase 1 stabilization (tier normalization, bounded event reads, digest escaping, constant-time
> secrets, dual-mode CI) has since landed and is accounted for below.

## 1. Executive Summary & Health Assessment

**One-paragraph verdict:** AI Model Radar is a well-factored event-sourced market-intelligence
system (Next.js 14 / TypeScript strict / Postgres with a JSON-file dev fallback) whose domain
core — append-only `model_snapshots` plus derived `model_events`, fronted by pure deterministic
engines for forecasts, signals, recommendations, probes, governance, and Q&A — is the right
architecture for the problem. The system is demo-strong and mid-scale-safe today. It is **not**
yet scale-safe on the read path: `getModelCurrentList` still loads the entire snapshot table
into Node and filters/sorts in memory (`src/lib/db/queries.ts:439-504`), bulk writes are
row-by-row inserts inside a transaction, the 2,382-line `queries.ts` god module concentrates all
16 domains in one file, and the dual Postgres/JSON backends must be hand-mirrored for every new
table. None of this requires a rewrite. All of it requires a disciplined hardening pass before
traffic grows — Phase 1 proved the team can execute exactly that kind of pass.

### Overall System Maturity

| Dimension | Grade | Rationale |
|---|---|---|
| Architecture | **B+** | Event-sourced core (`src/lib/db/schema.sql:4-36`), pure testable engines (`forecast.ts`, `signals.ts`, `probe.ts`, `governance.ts`, `ask-answer.ts`), clean feature-flag taxonomy. Dragged down by the `queries.ts` god module and a duplicated legacy + `v1` API surface (47 route files). |
| Code Quality | **B** | Strict TS (`tsconfig.json`: `strict:true`), zod env validation with prod fail-fast (`src/lib/env.ts`, `src/instrumentation.ts`), constant-time secret compare (`src/lib/secrets.ts:16-27`), hashed API keys. Offset by `any` clusters in query plumbing, lossy always-500 error handler, and sync whole-file JSON writes on the local backend. |
| Maintainability | **B−** | Excellent engine-per-file separation; poor data-access separation (16 domains in one file); dual persistence backends with diverging semantics that every new table must be hand-mirrored across (`client.ts`, `backup-db.ts`, `restore-db.ts`). |
| Performance | **B−** | Phase 1 fixed the worst offender: `getEventsBounded` is fully bounded SQL with keyset pagination (`queries.ts:180-297`). But `getModelCurrentList`/`getDealsData`/`getMarketStats` still hydrate whole tables into Node; bulk inserts are N round trips; `DISTINCT ON` full-table scans back every "latest snapshot" read. Safe to ~10⁵ rows on hot paths, cliff beyond on the remaining in-memory paths. |
| Test Coverage | **A−** | 48 files / ~284 tests green in **both** DB modes (dual-mode CI matrix), route-level + engine-level, deterministic `asOf` patterns, `sanitize`/`secrets`/backup-FK regression tests. Remaining: zero E2E, serial execution (`fileParallelism: false`), no coverage gates, time-based tests without fake timers. |

### Architectural Philosophy

**Core strengths (keep and extend):**
1. **Append-only event sourcing where it matters.** `model_snapshots` (immutable poll log) →
   derived `model_events` (the product) is exactly right for a price-history moat. The schema
   is disciplined: composite `(model_id, polled_at DESC)` / `(event_type, detected_at DESC)`
   indexes, FK cascades on teams/governance tables, `CHECK (monthly_budget_usd > 0)`.
2. **Pure engines, routes second.** Forecast, signals, recommendation, probe-health,
   governance, ask-answer, and briefs are side-effect-free functions with injected clocks.
   This is why hundreds of engine tests run in seconds. Do not regress this pattern.
3. **Auth is now boring in the good way.** `getSessionUser` (`src/lib/auth.ts:19-59`) with
   `X-User-Email` untrusted, `normalizeTier` at every boundary, monotonic-only tier upgrades,
   `requireFeature` gating (`src/lib/access-guard.ts:51-90`), constant-time secret compare at
   every cron/admin boundary. This layer needs no rework — only preservation.
4. **Dual-mode CI is a genuine asset.** `local × postgres × Node 18/20` matrix
   (`.github/workflows/ci.yml:54-112`) caught real backend-divergence bugs. Keep it; it is the
   project's best defense against its own dual-backend complexity.

**Fundamental structural risks:**
1. **The god module.** `queries.ts` (2,382 lines, 16 domains) is where velocity goes to die:
   every data change touches the same merge-conflict surface, and Postgres/JSON branches for
   the same function drift apart silently.
2. **Two databases, one contract, zero enforcement.** The local JSON backend is a partial
   simulator (`localQueryRunner` handles 3 statement shapes, `client.ts:159-214`); every new
   table/column must be mirrored in `LocalDbState`, `backup-db.ts`, `restore-db.ts`
   allowlists, and both branches of each query function. Nothing fails loudly when a mirror
   is forgotten — behavior just diverges per environment.
3. **In-memory reads on user-facing hot paths.** `getModelCurrentList`, `getDealsData`,
   `getMarketStats` scale with table size, not page size. The events path was fixed in
   Phase 1; the catalog path was not.

### Primary Bottlenecks

1. **Catalog read path is unbounded** (`getModelCurrentList`, `queries.ts:439-504`): full
   `DISTINCT ON` scan → entire map into Node → in-memory filter/sort/slice. Powers `/models`,
   `/api/models`, and transitively deals/stats. First page to degrade as snapshot volume grows.
2. **Write path is chatty** (`savePollTransaction`, `queries.ts:854-949`; `insertSnapshots` /
   `insertEvents`): per-row `INSERT` loops inside one transaction. Fine at current poll
   cadence; becomes the ingest ceiling the moment poll frequency or source count increases.
3. **Local JSON backend blocks the event loop**: `getLocalState`/`saveLocalState`
   (`client.ts:57-125`) do sync `readFileSync`/`writeFileSync` of the **entire** DB (the
   checked-in `.radar-data.json` is already ~1.2MB) on every mutation, with no locking or
   atomic rename. Acceptable for solo dev; corrupts or stalls under concurrent writers
   (parallel tests are already disabled because of it: `vitest.config.ts:7`).

## 2. In-Depth Engineering Review

### Design Patterns & Modularity
- **Engines are exemplary.** Each domain engine (`forecast`, `signals`, `recommendation`,
  `probe`, `governance`, `ask-answer`, `briefs`, `arbitrage`, `cost-model`,
  `migration-advisor`) is a cohesive module with a narrow interface and injected time. The
  `v1` routes are thin adapters over them (e.g. `v1/alerts/evaluate`, `v1/ask`,
  `v1/forecast`). New feature work should copy this shape, not the `queries.ts` shape.
- **Data access is the anti-pattern.** 16 domains × 2 backends in one 2,382-line file means
  the module has ~16 reasons to change and every change risks the other 15. Merge conflicts
  and accidental cross-domain edits concentrate here.
- **Leaky backend abstraction.** Callers branch on `isPostgres()` leaking through the entire
  codebase (`queries.ts` repeats `if (isPostgres()) … else …` per function; tests branch in
  `events-scale.test.ts:11-12`, `schema-drift.test.ts:34`). The abstraction (`client.ts`)
  promises one interface but delivers two behavior sets — e.g. `localQueryRunner` silently
  returns `[]` for any statement shape it doesn't recognize (`client.ts:213`). Silent wrong
  answers are worse than loud failures.
- **Legacy + `v1` API duplication.** ~14 legacy app routes (`/api/models`, `/api/events`,
  `/api/deals`, …) overlap ~18 `v1/*` routes serving the same data with different auth
  (`validatePublicApiRequest` + rate limits on `v1` only, `src/lib/api-auth.ts:175-255`;
  session auth on internal routes). Two surfaces to secure, version, and keep consistent.
- **Separation that works:** `src/types/` (14 domain type files) is clean; `FeatureGate`
  component + `FEATURES` taxonomy centralizes paywall logic; MCP tools
  (`src/lib/mcp/tools.ts`) reuse the same engines as HTTP routes — genuine reuse, not copy-paste.

### Data Architecture & Persistence
- **Schema: good bones.** 14 tables + `model_current` view, ~25 indexes, sensible cascades.
  Append-only core tables (`model_snapshots`, `model_events`) correctly carry **no** FKs.
- **Live defects, all in the fix list (§3):** `model_current` view can emit duplicate rows on
  `polled_at` ties (`schema.sql:121-128`), and `getEventsBounded` joins it (`queries.ts:258`)
  — tie duplicates propagate to the event feed. FKs reference mutable `users(email)` instead
  of `users(id)` (`teams.owner_email`, `budget_rules.owner_email`, `usage_profiles.email`) —
  an email change orphans or blocks cascades; the `user_watchlists` table correctly uses
  `user_id → users(id)` and is the template. Backup/restore table lists were fixed in the
  current pass but remain hand-maintained allowlists that the next new table will forget.
- **Query patterns: bifurcated.** The events path is now textbook (bounded SQL, `COUNT(*) OVER()`,
  keyset cursor matching `ORDER BY`, `ILIKE … ESCAPE '\'` at `queries.ts:222-224`). The
  catalog path (`getModelCurrentList`), deals (`queries.ts:682-736`, `limit:1000` + full map),
  and stats (`queries.ts:741-790`) are still hydrate-then-slice. `getModelDetail` /
  `getModelPriceHistory` issue 2 sequential `pool.query` calls that could be one round trip
  (`queries.ts:509-580`, `600-677`); `exportUserData` chains 3 sequential queries
  (`queries.ts:1448-1492`) where `getTeamDetail` already shows the `Promise.all` pattern
  (`queries.ts:1878-1886`).
- **Pooling: minimal but adequate for now.** Single global `Pool`, `max: 10`,
  `idleTimeoutMillis: 30000` (`client.ts:20-33`); no `connectionTimeoutMillis`, no statement
  timeout, no `pool.on('error')`, never `pool.end()`. Correct `BEGIN/COMMIT/ROLLBACK` usage
  on multi-statement writes. Under Vercel serverless, a process-global pool per warm instance
  with `max: 10` can exhaust a small Postgres `max_connections` during burst cold-starts —
  acceptable today, must be revisited with connection pooling (PgBouncer/Supabase pooler) at scale.
- **Migration hygiene: fragile.** `scripts/migrate.ts:39-100` applies all of `schema.sql`
  then incremental files tracked by filename in `schema_migrations` — no checksums, no
  per-file transactions (`pool.query(sql)` on the whole file), no down migrations,
  `001-004` missing (folded into baseline, undocumented), `EXPECTED_TABLES` stale (8 of 16
  tables), and `schema.sql` claims "PostgreSQL & SQLite compatible" while using
  `BIGSERIAL`/`JSONB`/`TIMESTAMPTZ`. It works because the team is small; it will bite on the
  first failed half-applied migration in production.

### Error Handling & Fault Tolerance
- **Handler is safe but lossy.** `handleApiError` (`src/lib/api-error-handler.ts:8-18`)
  captures and returns a flat 500 — no status propagation, so validation 400s, 401s, 403s,
  and 404s raised inside `try` blocks collapse into "Internal server error". Many `v1/*`
  routes bypass it with inline JSON instead, so error shape varies by route.
- **No resilience patterns.** No retries with backoff on ingestion fetches, no circuit
  breaker around OpenRouter/GitHub/HuggingFace sources, no per-source isolation (one slow
  source stalls the poll). Upstash Redis failing closed in prod (`api-auth.ts:118-125`) is
  the one correct fail-safe in the codebase — extend that philosophy outward.
- **Swallowed rejections on write paths** (flagged previously, still present): fire-and-forget
  writes without `await`/`.catch` risk silent data loss and unhandled-rejection crashes.
- **Cron fragility.** Vercel crons (`vercel.json`: poll hourly, probes :15, digest 07:00,
  weekly Mondays) are protected by `CRON_SECRET` constant-time checks (good) but have no
  overlap guard (a slow poll + next tick = concurrent writers), no dead-letter record beyond
  `ingestion_runs`, and local cron runs depend on wall-clock invocation with no scheduler.

### Observability & Diagnostics
- **Structured logging exists and is used inconsistently.** `src/lib/logger.ts:1-76` emits
  JSON `{timestamp, level, message, context}` with `DEBUG` suppression in prod — good shape.
  But ~10 legacy routes log via `console.*` or not at all, so prod log queries have gaps
  exactly where legacy traffic flows.
- **No metrics, no tracing.** "Telemetry" in this repo means *product* endpoint telemetry
  (`src/types/telemetry.ts`, `src/lib/probe.ts`, `/api/v1/telemetry`) — valuable for users,
  useless for operators. There are no request-latency histograms, no DB-pool gauges, no
  error-rate counters, no trace propagation. When the catalog path degrades, the team will
  learn about it from users, not dashboards.
- **Alerting hooks exist but point inward.** `triggerEscalationAlert`
  (`src/lib/alerts/escalation.ts`, tested in `backup.test.ts`) pages on ingestion failures —
  the right instinct, but it covers one source (ingestion monitor) and dispatches through an
  unmonitored channel. No SLOs, no burn-rate alerts, no cron-success/failure alerting.

### Testing & Quality Assurance
- **Genuinely strong for the project's age.** 48 files / ~284 tests, dual-backend CI matrix
  (Node 18/20 × local/postgres + `tsc` + `eslint` + `next build` gates), real route handlers
  against real backends instead of mocks (`vi.mock` count: **zero**), Postgres-only scale
  test seeding 100k rows (`events-scale.test.ts`), FK round-trip backup test
  (`backup.test.ts:69-110`), `sanitize`/`secrets` unit tests. The `Date.now() + random`
  fixture pattern (`backup.test.ts:74`) is the template all fixture authors should copy.
- **Gaps, ordered by risk:**
  1. **No E2E.** The k6 script (`tests/load/k6-load-test.js`) is manual-run, not CI. Nothing
     exercises the browser → API → DB path; `FeatureGate` + paywall UX is untested.
  2. **Serial execution as a load-bearing constraint.** `fileParallelism: false` exists
     because the JSON backend can't handle concurrency. Suite wall-time grows linearly with
     every added file (~140s local / ~200s Postgres already); this is a velocity tax that
     compounds.
  3. **Wall-clock tests without fake timers** (`vi.useFakeTimers` count: zero; 63 `Date.now`
     hits across tests). Windows are wide (hours/days) so flakes are rare, but the p95
     `<2000ms` assertion in `events-scale.test.ts:138-155` can flake on loaded CI runners.
  4. **Weak external assertions.** `github-integration.test.ts:4-32` passes whether the API
     answers, rate-limits, or throws — it tests nothing and teaches that green means little.
  5. **No coverage gates.** No `@vitest/coverage`, so the god-module split (§3, P1) can land
     with zero new tests and CI stays green.

## 3. Critical Modifications & Technical Debt Remediation

| Priority | Category | Component / Module | Issue / Technical Debt | Impact If Ignored | Recommended Fix |
|---|---|---|---|---|---|
| P0 | Data correctness | `model_current` view + `getEventsBounded` (`schema.sql:121-128`, `queries.ts:258`) | `MAX(polled_at)` tie yields duplicate rows; duplicates propagate into the event feed join | Duplicate events shown to users; `COUNT(*) OVER()` totals disagree with displayed rows | Add tiebreaker: `DISTINCT ON (model_id) … ORDER BY model_id, polled_at DESC, id DESC`, or materialize `model_current` as a table maintained by the poll transaction |
| P0 | Data integrity | FKs to `users(email)` (`schema.sql:135,167,210-211`) | Email is mutable identity; change/merge orphans teams, profiles, budget rules | Silent ownership loss; cascade failures on email update | Migrate FKs to `users(id)`: add `owner_user_id`/`user_id` columns, backfill by email, swap constraints, drop email FKs (same pattern `user_watchlists` already uses at `schema.sql:99`) |
| P0 | Persistence | Local JSON backend (`client.ts:57-125`) | Sync whole-file read/write per mutation, no locking, no atomic rename | DB corruption under concurrent writers; blocks enabling test parallelism; 1.2MB file already | Write to temp + atomic rename; serialize mutations with an in-process mutex; cap: declare JSON backend single-writer dev-only and fail loudly on concurrent access |
| P1 | Modularity | `queries.ts` god module (2,382 lines) | 16 domains × 2 backends in one file; maximal merge-conflict surface | Velocity decay; every data change risks unrelated domains | Split per domain (`db/users.ts`, `db/teams.ts`, `db/governance.ts`, `db/catalog.ts`, `db/events.ts`…) behind a repository interface; one domain per PR; keep function signatures stable so routes don't churn |
| P1 | Performance | `getModelCurrentList` (`queries.ts:439-504`) | Full-table `DISTINCT ON` + in-memory filter/sort/slice | Catalog latency scales with table size; first user-visible degradation as snapshots grow | Push predicates + `ORDER BY` + `LIMIT/OFFSET` (or keyset) into SQL, mirroring the `getEventsBounded` pattern; add `COUNT(*) OVER()` for totals |
| P1 | Performance | Bulk writes (`queries.ts:19-47`, `70-95`, `854-949`) | Per-row `INSERT` loops = N round trips per poll | Ingest ceiling fixed at current poll cadence × sources | Chunked multi-row `INSERT … VALUES ($1,…),($n,…)` (the 100k-seed path in `events-scale.test.ts:40-68` already demonstrates the shape — 50 statements, not 100k) or `unnest()` arrays; target one round trip per poll batch |
| P1 | Reliability | Migrations (`scripts/migrate.ts`, `migrations/`) | No checksums, no per-file TX, missing 001-004, stale `EXPECTED_TABLES`, false "SQLite compatible" claim | Half-applied production migration with no detection or rollback | Wrap each file in a transaction; record SHA-256 per applied file and verify on boot; document the 001-004 fold-in; fix `EXPECTED_TABLES`; drop the SQLite claim |
| P1 | API consistency | Error responses (`api-error-handler.ts`, ~47 routes) | Always-500 collapses 400/401/403/404; `v1` vs legacy shapes differ | Clients can't distinguish "bad request" from "down"; support load; broken retry logic | Typed error taxonomy (`ValidationError → 400`, `AuthError → 401`, `ForbiddenError → 403`, `NotFoundError → 404`) mapped in one place; adopt incrementally per route, starting with `v1/*` |
| P2 | Hygiene | `localQueryRunner` silent `[]` (`client.ts:213`) | Unrecognized statements return empty instead of throwing | Silent wrong answers in local dev; masks missing mirrors | Throw `Unsupported statement in local backend` with the SQL text; add a cross-backend parity test (same seed → same results, both modes) |
| P2 | Hygiene | Backup/restore allowlists (`backup-db.ts`, `restore-db.ts`) | New tables must be hand-added in 3+ places | Next new table ships unrestorable, exactly like `teams` did | Derive table list from `information_schema` (Postgres) filtered against an explicit exclusion set (`schema_migrations`), keeping `RESTORE_ORDER` only as an ordering hint with an assertion that every dumped table appears in it |
| P2 | Testing | E2E + parallelism + coverage | No E2E, serial suite, no coverage gates, time-based tests | Regressions reach users; suite time grows linearly; god-module split lands untested | Playwright smoke (signin → watchlist → alert → billing flag paths); per-file workers with isolated schemas (`CREATE SCHEMA test_$worker`); `vi.useFakeTimers` for clock tests; `@vitest/coverage` thresholds on `src/lib` |
| P2 | Observability | Metrics/tracing (`logger.ts` only) | Logs without metrics, traces, or SLOs | Degradation discovered by users, not dashboards | Add request-duration histogram + pool-gauge + error counters (even stdout-JSON counters a scraper can read is a start); alert on cron failure and p95 catalog latency |

### Before/After: P0 `model_current` tie fix

```sql
-- BEFORE (schema.sql:121-128): tie on polled_at duplicates the model row
CREATE OR REPLACE VIEW model_current AS
SELECT s.* FROM model_snapshots s INNER JOIN (
  SELECT model_id, MAX(polled_at) AS max_polled_at
  FROM model_snapshots GROUP BY model_id
) latest ON s.model_id = latest.model_id AND s.polled_at = latest.max_polled_at;

-- AFTER: deterministic single row per model (matches getEventsBounded's
-- ORDER BY e.detected_at DESC, e.id DESC tiebreak at queries.ts:260)
CREATE OR REPLACE VIEW model_current AS
SELECT DISTINCT ON (model_id) *
FROM model_snapshots
ORDER BY model_id, polled_at DESC, id DESC;
```

### Before/After: P1 catalog pushdown (mirrors the proven `getEventsBounded` shape)

```ts
// BEFORE (queries.ts:458-501): hydrate everything, then filter/sort/slice
const snapshotMap = await getLatestSnapshotsMap();
let models = Array.from(snapshotMap.values());
if (provider && provider !== 'All') models = models.filter(...);
if (search) models = models.filter(...);
models.sort(...);
return { models: models.slice(offset, offset + limit), total: models.length };

// AFTER: predicates + ORDER BY + LIMIT in SQL, COUNT(*) OVER() for totals,
// keyset cursor for page > 1 — the exact pattern getEventsBounded uses at
// queries.ts:192-268. Node never holds more than one page.
const where: string[] = ['1=1']; const params: unknown[] = [];
// ... push provider / isFree / search (ILIKE ... ESCAPE '\') ...
const sql = `SELECT *, COUNT(*) OVER() AS full_count FROM model_current
  WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $n OFFSET $m`;
```

### Before/After: P1 bulk-insert batching

```ts
// BEFORE (queries.ts:19-47 pattern): N round trips inside one transaction
for (const s of snapshots) await client.query(
  `INSERT INTO model_snapshots (...) VALUES ($1,...,$9)`, [...]);

// AFTER: chunked multi-row inserts — one round trip per 500-2000 rows.
// The 100k seed in events-scale.test.ts:40-68 already proves this shape.
const CHUNK = 1000;
for (const batch of chunks(snapshots, CHUNK)) {
  const { placeholders, values } = toMultiRow(batch);
  await client.query(`INSERT INTO model_snapshots (...) VALUES ${placeholders}`, values);
}
```

## 4. Optimization & Enhancement Recommendations

### Performance & Scalability
- **Catalog pushdown first** (§3 P1) — the only remaining unbounded user-facing read; everything
  else is bounded or back-office.
- **Poll batching** (§3 P1) — multi-row `INSERT` before adding sources or frequency.
- **Pool defensively for serverless.** Set `connectionTimeoutMillis: 5000` and a statement
  timeout (`statement_timeout: 15000`) so a wedged query fails instead of wedging the instance;
  add `pool.on('error')` logging (currently absent — idle-client errors crash silently). When
  traffic justifies it: transaction pooler (PgBouncer/Supabase) + `max: 2–4` per instance.
- **Cache the slow-but-stable.** `model_current` aggregations, benchmark matrices, and stats
  change on poll cadence (hourly), not request cadence — a 5-minute in-memory/Stale-While-Revalidate
  layer on `/api/stats`, deals, and benchmarks removes repeated full-table scans without any
  invalidation machinery (TTL = fraction of poll interval).
- **Connection/asset basics.** No Docker (Vercel target — fine), but no CDN/cache headers audit
  on badge/feed/JSON endpoints that are cheap to make embarrassingly cacheable
  (`s-maxage` already on feed; extend to badges and `v1/benchmarks`).

### Developer Experience (DX) & Tooling
- **Kill the JSON-backend parallelism tax.** Atomic-rename + mutex (§3 P0) unblocks per-file
  workers; then `fileParallelism: true` with isolated Postgres schemas per worker. Suite time
  is the team's second-biggest velocity lever after the god-module split.
- **Typing strictness: hold the line.** `tsc --noEmit` over src+tests with zero drift
  (CI `typecheck` job) is working — keep `no-explicit-any: warn` but ratchet: forbid *new*
  `any` in `src/lib` via a scheduled `grep` count check until the god-module split lands.
- **Seed/fixture ergonomics.** Promote the `stamp = Date.now() + random` pattern to a shared
  `tests/helpers.ts` (`uniqueEmail(prefix)`, `seedTeamWithGovernance()`) — 63 `Date.now`
  call sites copy-pasting uniqueness logic is a flake factory waiting for parallelism.
- **Migration DX.** `npm run db:init` works; add `db:migrate:status` (applied files +
  checksum verification) so "is staging current?" is one command, not source-diving.

### Security & Hardening Quick-Wins
- **Defense in depth, cheap:** rate-limit the session-authenticated internal routes
  (`/teams`, `/watchlists`, `/billing`) — currently only `v1/*` is rate-limited
  (`api-auth.ts`), so an authenticated user can hammer team/governance writes freely.
  Reuse the existing `UpstashRedisRateLimiter`; local fallback already exists.
- **Input validation:** extend `src/lib/validation/api-schemas.ts` (currently
  models/events/benchmarks queries) to all mutation bodies (teams, watchlists, governance
  rules, alerts) — several routes still hand-validate or don't.
- **Config ergonomics:** `.env.example` duplicates `DATABASE_URL` and
  `NEXT_PUBLIC_SITE_URL` (two entries each) — a copy-paste source of "works on mine"
  confusion. De-duplicate and add a boot-time duplicate detector to `validateEnv()`.
- **Unsubscribe token path** uses `timingSafeEqual` correctly (`email/resend.ts:23-29`);
  leave it. The remaining `===` compares are lengths/hashes, not secrets — verified, no action.

## 5. Future Engineering & Feature Roadmap

### Phase 1: Stabilization & Hardening (Short-Term: Weeks 1–4)
Immediate debt fixes, harness expansion, operational guardrails. (Phase 1 of the *prior*
roadmap — tier/backfill/bounded-reads/secrets/CI — is done; this is the next hardening layer.)
- [ ] P0 `model_current` tiebreak fix + regression test (duplicate `polled_at` seed → single row)
- [ ] P0 local-JSON atomic rename + write mutex; document single-writer scope
- [ ] P0 FK migration `users(email)` → `users(id)` for teams/profiles/budget rules
- [ ] P1 typed error taxonomy + adoption on `v1/*` routes
- [ ] P1 migration checksum verification + `EXPECTED_TABLES` refresh + status command
- [ ] Shared `tests/helpers.ts` fixture builders; `vi.useFakeTimers` for clock-sensitive tests
- [ ] Rate limits on authenticated internal routes (reuse Upstash limiter)
- [ ] `.env.example` de-duplication
- Exit criteria: full suite green both modes, zero P0s, catalog p95 instrumented (even if not yet optimized)

### Phase 2: Architectural Scaling & Performance (Medium-Term: Month 2–3)
- [ ] Split `queries.ts` per domain behind repository interfaces (one domain per PR; land with tests)
- [ ] Catalog SQL pushdown (`getModelCurrentList` + deals + stats) with `COUNT(*) OVER()` totals
- [ ] Bulk-insert batching on poll path; measure before/after at current volume
- [ ] Cross-backend parity test (same seed → identical results, both engines) to pin the contract
- [ ] Per-file test workers with isolated schemas; Playwright smoke suite (signin → watchlist → alert)
- [ ] Coverage thresholds on `src/lib`; k6 wired into CI nightly (not per-PR — too slow/flaky)
- [ ] Pool hardening: timeouts, `pool.on('error')`, pooler evaluation
- [ ] Cache layer (SWR/TTL) on stats/deals/benchmarks read paths
- Exit criteria: catalog latency flat vs table size; suite time halved; E2E smoke green

### Phase 3: Next-Generation Feature Expansion (Long-Term: Month 4–6+)

| Feature | Business / Technical Value | Complexity | Architectural Prerequisites |
|---|---|---|---|
| Real-time price-drop push (WebSocket/SSE on `v1/stream` extension) | Retention moat: users act in minutes, not next-digest | High | Bulk-write headroom (P1 batching); per-user connection fan-out design (ADR-2); rate-limit story for streams |
| Team workspaces v2 (roles, invites, shared budgets) | Enterprise upsell path for existing teams/governance tables | Med | FK-to-`users(id)` migration; error taxonomy for invite flows; E2E coverage of membership paths |
| Usage-based billing metering (Stripe metered seats/events) | Monetizes the cost-optimizer value prop already built | Med | `FEATURE_ENFORCEMENT` rollout plan; idempotent webhook handling (currently single-shot); metering aggregation job |
| Historical backtesting for RadarForecast | Proves forecast accuracy → converts free users | Med | Immutable snapshot guarantee (already have); forecast versioning (model_version column, new) |
| Public API v2 with keyed quotas + self-serve keys | Developer adoption; API as acquisition channel | Med | Internal-route rate limits; key-management UI exists (`API_KEY_MANAGEMENT` flag) — needs quota display |
| Multi-source consensus pricing (beyond OpenRouter) | Data moat + resilience to single-source outage | High | Per-source isolation + circuit breakers in ingestion (currently absent); source-weighted merge strategy (ADR-3) |
| Anomaly alerts (spend spikes, EOL risk push) | Activates governance tables already shipped | Low | Cron overlap guard; escalation channel monitoring |

## 6. Technical Decision Log (ADR Recommendations)

**ADR-1: Single-backend or contract-tested dual-backend?**
The Postgres/JSON split costs every data change a 2× implementation plus N allowlist updates,
and buys fast local onboarding. Options: (a) keep both but pin with a cross-backend parity
test and codegen'd table lists; (b) make Postgres mandatory for dev (Docker Compose one-liner)
and demote JSON to a documented in-memory fixture backend; (c) SQLite file backend (real SQL,
keeps zero-config dev). Decide before the `queries.ts` split, because the split's interface
shape depends on whether two implementations must exist. Recommendation: (a) short-term with
parity test, revisit (b) when contributor onboarding pain is measured, not assumed.

**ADR-2: Sync routes vs async workers for poll/digest/probe pipelines?**
Poll, digest, probes, and prune currently run as request-scoped cron invocations with no overlap
guard, no retry, and Vercel execution-time ceilings. As sources and users grow, the digest fan-out
(users × models × forecasts rendered per email) will exceed a single invocation. Options:
(a) stay request-scoped with chunked cursors + overlap locks; (b) introduce a queue (BullMQ +
Redis, or Vercel Queues / Inngest) with at-least-once workers; (c) scheduled ECS/Cloud Run jobs
outside Vercel. Decide when any cron exceeds 50% of its interval or first overlap incident —
instrument durations now so the trigger is data, not vibes.

**ADR-3: Snapshot partitioning / retention strategy?**
`model_snapshots` grows monotonically with (models × polls); every "latest" read scans it
(`DISTINCT ON` full-table). Options: (a) monthly range partitioning on `polled_at` with
`prune-raw-json` as the retention enforcer (already exists, `scripts/prune-raw-json.ts`);
(b) hot `model_current` materialized table + cold historical partitions; (c) downsampling
(old snapshots aggregated to daily). Decide at ~10⁶ snapshots or first catalog p95 breach —
whichever comes first. The `prune-raw-json` + `prune.yml` weekly job is the seed of this policy.

**ADR-4: Monolith routes vs versioned public API as the product surface?**
Legacy `/api/*` and `v1/*` overlap with different auth/rate-limit stories. Options:
(a) freeze legacy routes, route all new development through `v1`, sunset legacy per deprecation
policy; (b) merge into one versioned surface now; (c) keep both indefinitely with a
compatibility test matrix. Recommendation: (a) — cheapest, matches how the team already builds
(all F1–F5 work landed on `v1`), and the error-taxonomy work (§3 P1) gives a natural vehicle
(one surface to fix first).
