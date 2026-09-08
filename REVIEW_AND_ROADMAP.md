# AI Model Radar - Architectural Review & Strategic Roadmap

> Review scope: full repository (`src/`, `scripts/`, `migrations/`, `tests/`, `vercel.json`,
> `package.json`, `.github/workflows/`, `src/lib/db/schema.sql`). Every claim is anchored to a
> file and line number. Grades reflect production-readiness, not effort — this team ships fast
> and the domain core is genuinely good. This review supersedes all earlier drafts: since the
> last review the team has landed Phase 1 stabilization (tier normalization, bounded event
> reads, digest escaping, constant-time secrets, dual-mode CI), a schema-integrity batch
> (`model_current` tiebreak, atomic local writes, `users(id)` FK migration with orphan
> healing), and a full security-hardening pass (fail-closed webhooks/crons, SSRF guards, bot
> signatures, stream caps, security headers, error taxonomy, session rate limits — commits
> `af45557` through `aadaf9f`). Verified live against `radar-pg:5433`: **298 tests pass local,
> 310 pass on Postgres, `tsc` clean, `eslint` 0 errors, `next build` green.**

## 1. Executive Summary & Health Assessment

**One-paragraph verdict:** AI Model Radar is a well-factored event-sourced market-intelligence
system (Next.js 14 / TypeScript strict / Postgres with a JSON-file dev fallback) whose domain
core — append-only `model_snapshots` plus derived `model_events`, fronted by pure deterministic
engines for forecasts, signals, recommendations, probes, governance, and Q&A — is the right
architecture for the problem. Two hardening passes have closed the acute risks: the auth layer
is boring in the good way, secrets fail closed, outbound fetches are SSRF-guarded, and error
responses no longer leak internals. What remains is **structural, not acute**: the catalog read
path still hydrates whole tables into Node, bulk writes are still N round trips, and the
2,653-line `queries.ts` god module still concentrates 16 domains in one file. None of this
requires a rewrite. All of it is now precisely itemized below, with the highest-ROI items
first.

### Overall System Maturity

| Dimension | Grade | Rationale |
|---|---|---|
| Architecture | **B+** | Event-sourced core (`src/lib/db/schema.sql:4-36`), pure testable engines (`forecast.ts`, `signals.ts`, `probe.ts`, `governance.ts`, `ask-answer.ts`), clean feature-flag taxonomy. Dragged down by the `queries.ts` god module (2,653 lines) and a duplicated legacy + `v1` API surface (47 route files). |
| Code Quality | **B+** | Strict TS (`tsconfig.json`: `strict:true`), zod env validation with prod fail-fast (`src/lib/env.ts`, `src/instrumentation.ts`), constant-time secret compare (`src/lib/secrets.ts:16-26`), hashed API keys, typed error taxonomy (`src/lib/errors.ts`) with no client leakage, secret-redacting logger (`src/lib/logger.ts:21-40`), full security headers (`next.config.mjs:4-36`). Offset by `any` clusters in query plumbing (278 warnings, 0 errors) and dual-backend branching per function. |
| Maintainability | **B−** | Excellent engine-per-file separation; poor data-access separation (17 tables × 2 back-ends in one file); dual persistence backends with diverging semantics that every new table must be hand-mirrored across (`client.ts`, `backup-db.ts`, `restore-db.ts`). Mitigated but not solved: FK migration established the `users(id)` pattern, backup/restore order is canonical and tested. |
| Performance | **B−** | Events path is textbook bounded SQL with keyset pagination (`queries.ts:180-297`); `model_current` tiebreak fixed (`schema.sql:120-128`). But `getModelCurrentList`/`getDealsData`/`getMarketStats` still hydrate whole tables into Node; bulk inserts are N round trips. Safe to ~10⁵ rows on hot paths, cliff beyond on the remaining in-memory paths. |
| Test Coverage | **A−** | 53 files / 310 tests green in **both** DB modes (dual-mode CI matrix + typecheck + lint + audit + build gates), real route handlers against real backends instead of mocks (`vi.mock` count: **zero**), Postgres-only 100k-row scale test, FK round-trip backup test, sanitization/secrets/SSRF/rate-limit regression tests. Remaining: zero E2E, serial execution (`fileParallelism: false`), no coverage gates, time-based tests without fake timers. |

### Architectural Philosophy

**Core strengths (keep and extend):**
1. **Append-only event sourcing where it matters.** `model_snapshots` (immutable poll log) →
   derived `model_events` (the product) is exactly right for a price-history moat. The schema
   is disciplined: composite `(model_id, polled_at DESC)` / `(event_type, detected_at DESC)`
   indexes, FK cascades on teams/governance tables, `CHECK (monthly_budget_usd > 0)`, and —
   since the integrity batch — stable `users(id)` identity FKs with emails retained
   display-only.
2. **Pure engines, routes second.** Forecast, signals, recommendation, probe-health,
   governance, ask-answer, and briefs are side-effect-free functions with injected clocks.
   This is why hundreds of engine tests run in seconds of test time. Do not regress this pattern.
3. **Auth is boring in the good way — and now fail-closed everywhere.** `getSessionUser`
   (`src/lib/auth.ts`) with `X-User-Email` untrusted, `normalizeTier` at every boundary,
   monotonic-only tier upgrades, `requireFeature` gating, constant-time secret compare at
   every cron/admin boundary, plus fail-closed cron/webhook/bot handlers, key revocation on
   cancel, and per-route session rate limits (35 call sites). This layer needs preservation,
   not rework.
4. **Dual-mode CI is a genuine asset.** `local × postgres × Node 18/20` matrix plus `audit`
   and `build` gates (`.github/workflows/ci.yml`) caught real backend-divergence bugs. Add the
   Dependabot + nightly-k6 additions to the asset column: supply-chain and load signals now
   arrive without human prompting.

**Fundamental structural risks:**
1. **The god module.** `queries.ts` (2,653 lines, 17 tables) is where velocity goes to die:
   every data change touches the same merge-conflict surface, and Postgres/JSON branches for
   the same function drift apart silently.
2. **Two databases, one contract, weak enforcement.** The local JSON backend is a partial
   simulator (`localQueryRunner` handles a few statement shapes and silently returns `[]`
   otherwise); every new table/column must be mirrored in `LocalDbState`, `backup-db.ts`,
   `restore-db.ts` allowlists, and both branches of each query function. Nothing fails loudly
   when a mirror is forgotten — behavior just diverges per environment. (No parity test and
   no shared fixture helpers exist yet.)
3. **In-memory reads on user-facing hot paths.** `getModelCurrentList`, `getDealsData`,
   `getMarketStats` scale with table size, not page size. The events path was fixed in
   Phase 1; the catalog path was not — it is the single remaining user-facing scale hazard.

### Primary Bottlenecks

1. **Catalog read path is unbounded** (`getModelCurrentList`, `queries.ts:439-504`): full
   `DISTINCT ON` scan → entire map into Node → in-memory filter/sort/slice. Powers `/models`,
   `/api/models`, and transitively deals/stats. First page to degrade as snapshot volume grows.
2. **Write path is chatty** (`savePollTransaction`, `queries.ts:854-949`; `insertSnapshots` /
   `insertEvents`): per-row `INSERT` loops inside one transaction. Fine at current poll
   cadence; becomes the ingest ceiling the moment poll frequency or source count increases.
3. **Local JSON backend blocks the event loop**: `getLocalState`/`saveLocalState`
   (`client.ts:78-134`) do sync `readFileSync` plus whole-file rewrite on every mutation
   (atomic rename on POSIX, copy+unlink fallback on Windows — crash-atomicity holds only on
   POSIX). Acceptable for solo dev; parallel tests remain disabled because of it
   (`vitest.config.ts:7`), so suite wall-time (~105s local / ~106s Postgres) grows linearly
   with every added file.

## 2. In-Depth Engineering Review

### Design Patterns & Modularity
- **Engines are exemplary.** Each domain engine (`forecast`, `signals`, `recommendation`,
  `probe`, `governance`, `ask-answer`, `briefs`, `arbitrage`, `cost-model`,
  `migration-advisor`) is a cohesive module with a narrow interface and injected time. The
  `v1` routes are thin adapters over them (e.g. `v1/alerts/evaluate`, `v1/ask`,
  `v1/forecast`). Security primitives followed the same shape successfully (`ssrf-guard.ts`,
  `stream-slots.ts`, `errors.ts`). New feature work should copy this shape, not the
  `queries.ts` shape.
- **Data access is the anti-pattern.** 17 tables × 2 backends in one 2,653-line file means
  the module has ~17 reasons to change and every change risks the other 16. Merge conflicts
  and accidental cross-domain edits concentrate here. The FK-migration and webhook-idempotency
  work both had to touch it; each such change is riskier than it should be.
- **Leaky backend abstraction.** Callers branch on `isPostgres()` leaking through the entire
  codebase (`queries.ts` repeats `if (isPostgres()) … else …` per function; tests branch in
  `events-scale.test.ts`, `schema-drift.test.ts`). The abstraction (`client.ts`) promises one
  interface but delivers two behavior sets — e.g. `localQueryRunner` silently returns `[]`
  for any statement shape it doesn't recognize. Silent wrong answers are worse than loud failures.
- **Legacy + `v1` API duplication.** ~14 legacy app routes (`/api/models`, `/api/events`,
  `/api/deals`, …) overlap ~18 `v1/*` routes serving the same data with different auth
  (`validatePublicApiRequest` + tiered rate limits on `v1`; session auth + per-user limits on
  internal routes since the hardening pass). Two surfaces to secure, version, and keep consistent.
- **Separation that works:** `src/types/` (14 domain type files) is clean; `FeatureGate`
  component + `FEATURES` taxonomy centralizes paywall logic; MCP tools
  (`src/lib/mcp/tools.ts`) reuse the same engines as HTTP routes — genuine reuse, not copy-paste.

### Data Architecture & Persistence
- **Schema: good bones, integrity batch landed.** 17 tables + `model_current` view, ~25 indexes,
  sensible cascades. Identity FKs now point at immutable `users(id)` (`teams.owner_user_id`,
  `budget_rules.owner_user_id`, `usage_profiles.user_id`, all `ON DELETE SET NULL`) with
  emails retained display-only; `model_current` is deterministic (`DISTINCT ON … ORDER BY
  model_id, polled_at DESC, id DESC`). Append-only core tables correctly carry **no** FKs.
  Billing idempotency has a dedicated `processed_stripe_event_ids` table; approval races are
  closed by `UPDATE … AND status='pending'` plus a pending-dedup partial unique index.
- **Query patterns: bifurcated.** The events path is textbook (bounded SQL, `COUNT(*) OVER()`,
  keyset cursor matching `ORDER BY`, `ILIKE … ESCAPE '\'` at `queries.ts:222-224`). The
  catalog path (`getModelCurrentList`), deals (`limit:1000` + full map), and stats are still
  hydrate-then-slice. `getModelDetail` / `getModelPriceHistory` issue 2 sequential `pool.query`
  calls that could be one round trip; `exportUserData` chains sequential queries where
  `getTeamDetail` already shows the `Promise.all` pattern.
- **Pooling: minimal but adequate for now.** Single global `Pool`, `max: 10`,
  `idleTimeoutMillis: 30000` (`client.ts:20-33`); no `connectionTimeoutMillis`, no statement
  timeout, no `pool.on('error')`, never `pool.end()`. Correct `BEGIN/COMMIT/ROLLBACK` usage
  on multi-statement writes (including the newer `createTeam` transaction). Under Vercel
  serverless, a process-global pool per warm instance with `max: 10` can exhaust a small
  Postgres `max_connections` during burst cold-starts — acceptable today, must be revisited
  with connection pooling (PgBouncer/Supabase pooler) at scale.
- **Migration hygiene: improved, still fragile.** Seven incremental files (`005`–`011`) tracked
  by filename in `schema_migrations`; `EXPECTED_TABLES` is current at 17. Still missing:
  checksums, per-file transactions (`pool.query(sql)` on the whole file — only migration 009
  carries its own `BEGIN`), down migrations, `001-004` (folded into baseline, undocumented),
  and `schema.sql` still claims "PostgreSQL & SQLite compatible" while using
  `BIGSERIAL`/`JSONB`/`TIMESTAMPTZ`. It works because the team is small; it will bite on the
  first failed half-applied migration in production.

### Error Handling & Fault Tolerance
- **Handler is now typed and safe.** `toAppError` (`src/lib/errors.ts:118-140`) maps unknown
  errors to a generic `InternalError` (raw `err.message`, pg codes, and Zod internals never
  reach clients — enforced by `tests/error-taxonomy.test.ts`), with `ValidationError → 400`,
  `ConflictError → 409`, `RateLimitError → 429` for known shapes; originals stay server-side
  via `captureException`. `handleApiError` preserves this contract.
- **No resilience patterns.** No retries with backoff on ingestion fetches, no circuit
  breaker around OpenRouter/GitHub/HuggingFace sources, no per-source isolation (one slow
  source stalls the poll). Upstash Redis failing closed in prod is the correct fail-safe
  pattern — since extended to cron/webhook/bot handlers and the audit gate. Extend it to
  ingestion next.
- **Write-path fire-and-forget** persists in spots (`updateApiKeyLastUsed().catch(()=>{})`,
  digest-delivery audit `.catch(()=>{})`): acceptable for telemetry, but audit the list
  before calling any of them load-bearing.
- **Cron fragility, reduced.** Vercel crons are now authenticated fail-closed with hashed-IP
  denial audit logs — but still no overlap guard (a slow poll + next tick = concurrent
  writers), no dead-letter record beyond `ingestion_runs`, and local cron runs depend on
  wall-clock invocation with no scheduler. The SSE stream at least has `maxDuration = 60`
  plus per-identity connection caps now.

### Observability & Diagnostics
- **Structured logging, now with redaction and audit trails.** `src/lib/logger.ts` emits JSON
  with secret-shaped keys scrubbed (`REDACTED_KEY_RE`), stable `hashIp`/`hashEmail` for
  correlation without PII retention, and `logAuthDenied` records every auth denial
  (cron/admin/webhook/bot) as `logger.warn('auth.denied', …)` — 17 wired call sites. Remaining
  gap: raw interpolated emails persist in a few message strings outside the redacted paths;
  finish the `hashEmail` sweep.
- **No metrics, no tracing.** "Telemetry" in this repo means *product* endpoint telemetry —
  valuable for users, useless for operators. No request-latency histograms, no DB-pool gauges,
  no error-rate counters, no trace propagation. When the catalog path degrades, the team will
  still learn about it from users, not dashboards.
- **Alerting hooks exist but point inward.** `triggerEscalationAlert` pages on ingestion
  failures — the right instinct, but it covers one source through an unmonitored channel. No
  SLOs, no burn-rate alerts, no cron-success/failure alerting. The k6 nightly workflow now
  produces load signals; nobody is paged on them yet.

### Testing & Quality Assurance
- **Genuinely strong for the project's age.** 53 files / 310 tests green in **both** DB modes
  (dual-mode CI matrix: Node 18/20 × local/postgres + `tsc` + `eslint` + `npm audit` +
  `next build` gates), real route handlers against real backends instead of mocks (`vi.mock`
  count: **zero**), Postgres-only 100k-row scale test, FK round-trip backup test, sanitizer /
  secrets / SSRF / rate-limit / error-taxonomy / pentest-regression suites. The
  `Date.now() + random` fixture pattern is the template all fixture authors should copy.
- **Gaps, ordered by risk:**
  1. **No E2E.** The k6 script runs nightly, explicitly non-blocking. Nothing exercises the
     browser → API → DB path; `FeatureGate` + paywall UX is untested.
  2. **Serial execution as a load-bearing constraint.** `fileParallelism: false` exists
     because the JSON backend can't handle concurrency. Suite wall-time (~105s / ~106s)
     grows linearly with every added file; this is a velocity tax that compounds.
  3. **Wall-clock tests without fake timers** (`vi.useFakeTimers` count: zero). Windows are
     wide (hours/days) so flakes are rare, but the p95 assertion in `events-scale.test.ts`
     can flake on loaded CI runners.
  4. **Weak external assertions.** `github-integration.test.ts` passes whether the API
     answers, rate-limits, or throws — it tests nothing and teaches that green means little.
  5. **No coverage gates.** No `@vitest/coverage`, so the god-module split (§3, P1) can land
     with zero new tests and CI stays green.

## 3. Critical Modifications & Technical Debt Remediation

| Priority | Category | Component / Module | Issue / Technical Debt | Impact If Ignored | Recommended Fix |
|---|---|---|---|---|---|
| P0 | Performance | `getModelCurrentList` (`queries.ts:439-504`) | Full-table `DISTINCT ON` + in-memory filter/sort/slice on the primary catalog path | Catalog latency scales with table size; first user-visible degradation as snapshots grow | Push predicates + `ORDER BY` + `LIMIT/OFFSET` (or keyset) into SQL, mirroring the `getEventsBounded` pattern; add `COUNT(*) OVER()` for totals |
| P0 | Performance | Bulk writes (`queries.ts:19-47`, `70-95`, `854-949`) | Per-row `INSERT` loops = N round trips per poll | Ingest ceiling fixed at current poll cadence × sources | Chunked multi-row `INSERT … VALUES ($1,…),($n,…)` (the 100k-seed path in `events-scale.test.ts` already demonstrates the shape) or `unnest()` arrays; target one round trip per poll batch |
| P1 | Modularity | `queries.ts` god module (2,653 lines) | 17 tables × 2 backends in one file; maximal merge-conflict surface | Velocity decay; every data change risks unrelated domains | Split per domain (`db/users.ts`, `db/teams.ts`, `db/governance.ts`, `db/catalog.ts`, `db/events.ts`…) behind a repository interface; one domain per PR; keep function signatures stable so routes don't churn |
| P1 | Reliability | Migrations (`scripts/migrate.ts`, `migrations/`) | No checksums, no per-file TX, missing 001-004, false "SQLite compatible" claim | Half-applied production migration with no detection or rollback | Wrap each file in a transaction; record SHA-256 per applied file and verify on boot; document the 001-004 fold-in; drop the SQLite claim (`EXPECTED_TABLES` itself is now current) |
| P1 | Performance | Pool (`client.ts:20-33`) | No timeouts, no error handler, `max: 10` per serverless instance | Wedged queries wedge instances; burst cold-starts exhaust small Postgres | `connectionTimeoutMillis: 5000`, `statement_timeout: 15000`, `pool.on('error')` logging; evaluate PgBouncer/Supabase pooler |
| P1 | Testing | Cross-backend parity | No parity test, no shared fixture helpers | Silent backend divergence on every new table | Same-seed → identical-results test in both engines; shared `tests/helpers.ts` (`uniqueEmail`, `seedTeamWithGovernance`); `vi.useFakeTimers` for clock tests |
| P2 | Hygiene | `localQueryRunner` silent `[]` (`client.ts`) | Unrecognized statements return empty instead of throwing | Silent wrong answers in local dev; masks missing mirrors | Throw `Unsupported statement in local backend` with the SQL text |
| P2 | Hygiene | Backup/restore allowlists (`backup-db.ts`, `restore-db.ts`) | New tables must be hand-added in 3+ places (now 17 + `schema_migrations` exclusion) | Next new table ships unrestorable, exactly like `teams` did | Derive table list from `information_schema` filtered against an explicit exclusion set, keeping `RESTORE_ORDER` only as an ordering hint with an assertion that every dumped table appears in it |
| P2 | Hygiene | `.env.example` duplicates | `DATABASE_URL` and `NEXT_PUBLIC_SITE_URL` listed twice each | Copy-paste "works on mine" confusion | De-duplicate and add a boot-time duplicate detector to `validateEnv()` |
| P2 | Testing | E2E + parallelism + coverage | No E2E, serial suite, no coverage gates, time-based tests | Regressions reach users; suite time grows linearly; god-module split lands untested | Playwright smoke (signin → watchlist → alert); per-file workers with isolated schemas (`CREATE SCHEMA test_$worker`); `@vitest/coverage` thresholds on `src/lib` |
| P2 | Observability | Metrics/tracing (`logger.ts` only) | Logs without metrics, traces, or SLOs | Degradation discovered by users, not dashboards | Request-duration histogram + pool-gauge + error counters; alert on cron failure and catalog p95; page on k6 nightly regressions |

### Before/After: P0 catalog pushdown (mirrors the proven `getEventsBounded` shape)

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

### Before/After: P0 bulk-insert batching

```ts
// BEFORE (queries.ts:19-47 pattern): N round trips inside one transaction
for (const s of snapshots) await client.query(
  `INSERT INTO model_snapshots (...) VALUES ($1,...,$9)`, [...]);

// AFTER: chunked multi-row inserts — one round trip per 500-2000 rows.
// The 100k seed in events-scale.test.ts already proves this shape.
const CHUNK = 1000;
for (const batch of chunks(snapshots, CHUNK)) {
  const { placeholders, values } = toMultiRow(batch);
  await client.query(`INSERT INTO model_snapshots (...) VALUES ${placeholders}`, values);
}
```

### Completed exemplar: P0 `model_current` tiebreak (landed, keep as template)

```sql
-- BEFORE: tie on polled_at duplicated the model row
SELECT s.* FROM model_snapshots s INNER JOIN (
  SELECT model_id, MAX(polled_at) AS max_polled_at
  FROM model_snapshots GROUP BY model_id
) latest ON s.model_id = latest.model_id AND s.polled_at = latest.max_polled_at;

-- AFTER (schema.sql:120-128): deterministic single row per model
SELECT DISTINCT ON (model_id) *
FROM model_snapshots
ORDER BY model_id, polled_at DESC, id DESC;
```

## 4. Optimization & Enhancement Recommendations

### Performance & Scalability
- **Catalog pushdown first** (§3 P0) — the only remaining unbounded user-facing read; everything
  else is bounded or back-office.
- **Poll batching** (§3 P0) — multi-row `INSERT` before adding sources or frequency.
- **Pool defensively for serverless.** `connectionTimeoutMillis` + `statement_timeout` +
  `pool.on('error')` now (cheap), transaction pooler when traffic justifies it.
- **Cache the slow-but-stable.** `model_current` aggregations, benchmark matrices, and stats
  change on poll cadence (hourly), not request cadence — a 5-minute TTL layer on `/api/stats`,
  deals, and benchmarks removes repeated full-table scans without invalidation machinery.
- **Asset basics.** No Docker (Vercel target — fine). Security headers now ship globally
  (`next.config.mjs:4-36`); extend CDN/cache-header treatment to badges and `v1/benchmarks`
  (`s-maxage` already on feed).

### Developer Experience (DX) & Tooling
- **Kill the JSON-backend parallelism tax.** POSIX atomic rename landed; Windows uses
  copy+unlink (documented non-atomic). Next: in-process write mutex, then
  `fileParallelism: true` with isolated Postgres schemas per worker. Suite time is the
  team's second-biggest velocity lever after the god-module split.
- **Typing strictness: hold the line.** `tsc --noEmit` over src+tests with zero drift plus
  `eslint` 0 errors (278 warnings, all pre-existing patterns — no new `any` accepted in this
  pass) is working. Keep the ratchet: scheduled `any`-count check until the god-module
  split lands.
- **Seed/fixture ergonomics.** Promote the `stamp = Date.now() + random` pattern to a shared
  `tests/helpers.ts` (`uniqueEmail(prefix)`, `seedTeamWithGovernance()`) — dozens of call
  sites copy-pasting uniqueness logic is a flake factory waiting for parallelism.
- **Migration DX.** `npm run db:init` works and `EXPECTED_TABLES` is current; add
  `db:migrate:status` (applied files + checksum verification) so "is staging current?" is one
  command, not source-diving.

### Security & Hardening Quick-Wins
- **Done this pass, preserve:** fail-closed cron/webhook/bot handlers, prod-required
  `CRON_SECRET`/`UNSUBSCRIBE_SECRET`, Stripe timestamp tolerance + event dedup + tier
  allowlist, key revoke-on-cancel, SSRF guard with redirect re-validation, session rate
  limits (35 sites), security headers, error-taxonomy no-leak, secret redaction + auth-denied
  audit, 7d rolling sessions, exact dep pins + critical audit gate + Dependabot.
- **Remaining cheap items:** extend `src/lib/validation/api-schemas.ts` (currently
  models/events/benchmarks queries) to all mutation bodies (teams, watchlists, governance
  rules, alerts) — several routes still hand-validate or don't; finish the `hashEmail`
  sweep for the few raw-email log lines left; require `ADMIN_SECRET` in prod (currently
  fail-closed 401-always, which is safe but ops-blind); de-duplicate `.env.example`.
- **Unsubscribe token path** uses `timingSafeEqual` correctly; leave it. Webhook
  `verifyStripeWebhookSignature` enforces 300s tolerance; leave it.

## 5. Future Engineering & Feature Roadmap

### Phase 1: Stabilization & Hardening (Short-Term: Weeks 1–4)
Prior hardening layers are done (tier/backfill/bounded-reads/secrets/CI; integrity batch;
security pass). This layer finishes the job:
- [ ] P0 catalog SQL pushdown (`getModelCurrentList` + deals + stats) with `COUNT(*) OVER()` totals
- [ ] P0 bulk-insert batching on poll path; measure before/after at current volume
- [ ] P1 pool hardening: timeouts, `pool.on('error')`, pooler evaluation
- [ ] P1 cross-backend parity test + shared `tests/helpers.ts`; `vi.useFakeTimers` for clock tests
- [ ] P1 migration TX-per-file + checksum verification + status command; drop SQLite claim
- [ ] P2 `.env.example` de-duplication; `localQueryRunner` loud failure; finish `hashEmail` sweep
- Exit criteria: catalog latency flat vs table size; zero P0s; full suite green both modes (holds today: 298/303 local, 310/310 Postgres)

### Phase 2: Architectural Scaling & Performance (Medium-Term: Month 2–3)
- [ ] Split `queries.ts` per domain behind repository interfaces (one domain per PR; land with tests)
- [ ] Per-file test workers with isolated schemas; Playwright smoke suite (signin → watchlist → alert)
- [ ] Coverage thresholds on `src/lib`; k6 nightly already runs — page on regressions
- [ ] Cache layer (SWR/TTL) on stats/deals/benchmarks read paths
- [ ] Cron overlap guard + dead-letter handling; ingestion per-source isolation + circuit breakers
- [ ] Request-duration/pool-gauge/error-counter instrumentation with alerts
- Exit criteria: suite time halved; E2E smoke green; degradation pages before users notice

### Phase 3: Next-Generation Feature Expansion (Long-Term: Month 4–6+)

| Feature | Business / Technical Value | Complexity | Architectural Prerequisites |
|---|---|---|---|
| Real-time price-drop push (WebSocket/SSE on `v1/stream` extension) | Retention moat: users act in minutes, not next-digest | High | Bulk-write headroom (P0 batching); stream caps already landed (`maxDuration`, per-identity slots); per-user fan-out design (ADR-2) |
| Team workspaces v2 (roles, invites, shared budgets) | Enterprise upsell path for existing teams/governance tables | Med | FK-to-`users(id)` migration (done); error taxonomy for invite flows (done); E2E coverage of membership paths |
| Usage-based billing metering (Stripe metered seats/events) | Monetizes the cost-optimizer value prop already built | Med | `FEATURE_ENFORCEMENT` rollout plan; webhook idempotency (done: event table + mark-after-commit); metering aggregation job |
| Historical backtesting for RadarForecast | Proves forecast accuracy → converts free users | Med | Immutable snapshot guarantee (already have); forecast versioning (model_version column, new) |
| Public API v2 with keyed quotas + self-serve keys | Developer adoption; API as acquisition channel | Med | Internal-route rate limits (done); key-management UI exists (`API_KEY_MANAGEMENT` flag) — needs quota display |
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
guard, no retry, and Vercel execution-time ceilings (stream now has `maxDuration = 60`; crons
do not). As sources and users grow, the digest fan-out (users × models × forecasts rendered
per email) will exceed a single invocation. Options: (a) stay request-scoped with chunked
cursors + overlap locks; (b) introduce a queue (BullMQ + Redis, or Vercel Queues / Inngest)
with at-least-once workers; (c) scheduled ECS/Cloud Run jobs outside Vercel. Decide when any
cron exceeds 50% of its interval or first overlap incident — instrument durations now so the
trigger is data, not vibes.

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
(all feature work lands on `v1`), and the error-taxonomy work gives a natural vehicle
(one surface to fix first).
