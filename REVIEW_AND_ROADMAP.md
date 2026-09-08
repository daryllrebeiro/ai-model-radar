# AI Model Radar - Architectural Review & Strategic Roadmap

> Review scope: full repository (`src/`, `scripts/`, `migrations/`, `tests/`, `vercel.json`,
> `package.json`, `.github/workflows/`, `src/lib/db/schema.sql`). Every claim is anchored to a
> file and line number. Grades reflect production-readiness, not effort — this team ships fast
> and the domain core is genuinely good. This review supersedes all earlier drafts: since the
> last review the team has landed catalog SQL pushdown, bulk-insert batching, migration
> hardening (per-file transactions, checksums, status command, migrations 010–013), and a
> second security sweep (legacy-route throttling, sliding-window limiter, payload caps).
> Verified live against `radar-pg:5433`: **308 tests pass local (+5 skipped), 322 pass on
> Postgres, `tsc` clean, `eslint` 0 errors, `next build` green.**

## 1. Executive Summary & Health Assessment

**One-paragraph verdict:** AI Model Radar is a well-factored event-sourced market-intelligence
system (Next.js 14 / TypeScript strict / Postgres with a JSON-file dev fallback) whose domain
core — append-only `model_snapshots` plus derived `model_events`, fronted by pure deterministic
engines for forecasts, signals, recommendations, probes, governance, and Q&A — is the right
architecture for the problem. Three hardening passes have closed the acute risks and, since
the last review, the two remaining user-facing scale hazards: the catalog path is now bounded
SQL and the poll path writes in bulk. What remains is **structural, not acute**: the 3,022-line
`queries.ts` god module still concentrates 17 tables in one file, the dual Postgres/JSON
backends still lack a parity contract, and there is still no E2E coverage. None of this
requires a rewrite. The highest-ROI remaining work is the module split plus the small set of
operational guardrails itemized below.

### Overall System Maturity

| Dimension | Grade | Rationale |
|---|---|---|
| Architecture | **B+** | Event-sourced core (`src/lib/db/schema.sql:4-36`), pure testable engines (`forecast.ts`, `signals.ts`, `probe.ts`, `governance.ts`, `ask-answer.ts`), clean feature-flag taxonomy. Dragged down by the `queries.ts` god module (3,022 lines) and a duplicated legacy + `v1` API surface (47 route files). |
| Code Quality | **B+** | Strict TS (`tsconfig.json`: `strict:true`), zod env validation with prod fail-fast (`src/lib/env.ts`, `src/instrumentation.ts`), constant-time secret compare (`src/lib/secrets.ts:16-26`), hashed API keys, typed error taxonomy (`src/lib/errors.ts`) with no client leakage, secret-redacting logger (`src/lib/logger.ts:21-40`), full security headers (`next.config.mjs:4-36`). Offset by `any` clusters in query plumbing (294 warnings, 0 errors) and dual-backend branching per function. |
| Maintainability | **B−** | Excellent engine-per-file separation; poor data-access separation (17 tables × 2 back-ends in one file); dual persistence backends with diverging semantics that every new table must be hand-mirrored across (`client.ts`, `backup-db.ts`, `restore-db.ts`). Mitigated but not solved: FK migration established the `users(id)` pattern, backup/restore order is canonical and tested, migrations carry checksums. |
| Performance | **B** | Events, catalog, deals, and stats paths are now bounded SQL with keyset pagination and `COUNT(*) OVER()` (`queries.ts:180-297, 486-533, 789-920`); bulk writes are chunked multi-row (`BULK_CHUNK_ROWS = 1000`). Remaining: `getLatestSnapshotsMap` full `DISTINCT ON` scan still backs several reads, restore replays row-by-row, local backend stays in-memory. Safe well past 10⁵ rows on hot paths. |
| Test Coverage | **A−** | 56 files / 322 tests green in **both** DB modes (dual-mode CI matrix + typecheck + lint + audit + build gates), real route handlers against real backends instead of mocks (`vi.mock` count: **zero**), Postgres-only 100k-row scale test, FK round-trip backup test, sanitizer / secrets / SSRF / rate-limit / error-taxonomy / parity suites. Remaining: zero E2E, serial execution (`fileParallelism: false`), no coverage gates, time-based tests without fake timers. |

### Architectural Philosophy

**Core strengths (keep and extend):**
1. **Append-only event sourcing where it matters.** `model_snapshots` (immutable poll log) →
   derived `model_events` (the product) is exactly right for a price-history moat. The schema
   is disciplined: composite `(model_id, polled_at DESC)` / `(event_type, detected_at DESC)`
   indexes, FK cascades on teams/governance tables, `CHECK (monthly_budget_usd > 0)`, stable
   `users(id)` identity FKs with emails retained display-only, and a deterministic
   `model_current` view (`DISTINCT ON … ORDER BY model_id, polled_at DESC, id DESC`).
2. **Pure engines, routes second.** Forecast, signals, recommendation, probe-health,
   governance, ask-answer, and briefs are side-effect-free functions with injected clocks.
   This is why hundreds of engine tests run in seconds of test time. Do not regress this pattern.
3. **Auth is boring in the good way — and fail-closed everywhere.** `getSessionUser` with
   `X-User-Email` untrusted, `normalizeTier` at every boundary, monotonic-only tier upgrades,
   `requireFeature` gating, constant-time secret compare at every cron/admin boundary, plus
   fail-closed cron/webhook/bot handlers, key revocation on cancel, per-route session rate
   limits, and — since this pass — throttling on every legacy read route and a true sliding
   window limiter. This layer needs preservation, not rework.
4. **Dual-mode CI is a genuine asset.** `local × postgres × Node 18/20` matrix plus `audit`
   and `build` gates (`.github/workflows/ci.yml`) caught real backend-divergence bugs. Add the
   Dependabot + nightly-k6 additions to the asset column: supply-chain and load signals now
   arrive without human prompting.

**Fundamental structural risks:**
1. **The god module.** `queries.ts` (3,022 lines and growing — up from 2,653 last round
   *because* the pushdown and batching work landed inside it) is where velocity goes to die:
   every data change touches the same merge-conflict surface, and Postgres/JSON branches for
   the same function drift apart silently. Each landed improvement that lives here raises the
   cost of the eventual split.
2. **Two databases, one contract, weak enforcement.** The local JSON backend is a partial
   simulator that now fails loudly on unknown statements (an improvement), but every new
   table/column must still be mirrored in `LocalDbState`, `backup-db.ts`, `restore-db.ts`
   allowlists, and both branches of each query function. There is still no parity test and
   no shared fixture helpers — divergence is caught by humans, not machines.
3. **Residual unbounded reads.** The hot paths are bounded, but `getLatestSnapshotsMap`
   (full `DISTINCT ON` scan) still backs health checks, arbitrage, probes, and several pages;
   `getDealsData` free-models has no `LIMIT`; restore replays row-by-row. Each is small
   today and each has a cliff at scale.

### Primary Bottlenecks

1. **Module concentration, not query latency.** The bottleneck has moved up the stack: with
   hot paths bounded, the binding constraint on shipping speed is `queries.ts` itself —
   3,022 lines, 17 domains, 2 backends per function. Every data change risks unrelated domains.
2. **Write-path ceiling, raised but not removed.** Bulk inserts took polling from N round
   trips to N/1000; the remaining ceiling is restore replay (row-by-row) and the absence of
   `COPY`/`unnest` for the largest transfers.
3. **Local JSON backend blocks the event loop**: `getLocalState`/`saveLocalState` do sync
   `readFileSync` plus whole-file rewrite on every mutation (atomic rename on POSIX,
   copy+unlink fallback on Windows — crash-atomicity holds only on POSIX). Parallel tests
   remain disabled (`vitest.config.ts:7`), so suite wall-time (~110s local / ~133s Postgres)
   grows linearly with every added file.

## 2. In-Depth Engineering Review

### Design Patterns & Modularity
- **Engines are exemplary.** Each domain engine (`forecast`, `signals`, `recommendation`,
  `probe`, `governance`, `ask-answer`, `briefs`, `arbitrage`, `cost-model`,
  `migration-advisor`) is a cohesive module with a narrow interface and injected time. The
  `v1` routes are thin adapters over them (e.g. `v1/alerts/evaluate`, `v1/ask`,
  `v1/forecast`). Security primitives followed the same shape successfully (`ssrf-guard.ts`,
  `stream-slots.ts`, `errors.ts`). New feature work should copy this shape, not the
  `queries.ts` shape.
- **Data access is the anti-pattern.** 17 tables × 2 backends in one 3,022-line file means
  the module has ~17 reasons to change and every change risks the other 16. The pushdown,
  batching, FK-migration, and idempotency work all landed here — each correct in isolation,
  each raising the merge-conflict surface.
- **Leaky backend abstraction.** Callers branch on `isPostgres()` leaking through the entire
  codebase (`queries.ts` repeats `if (isPostgres()) … else …` per function; tests branch in
  `events-scale.test.ts`, `schema-drift.test.ts`). The fallback path in `localQueryRunner`
  now throws instead of returning silent `[]` — a genuine improvement — but the contract is
  still enforced by code review, not by a parity test.
- **Legacy + `v1` API duplication, now uniformly throttled.** ~14 legacy app routes overlap
  ~18 `v1/*` routes. As of this pass every legacy read route runs the same
  `validatePublicApiRequest` as its `v1` twin (identical tier logic by construction), and
  session routes carry per-user limits. The duplication cost is now consistency risk, not
  security risk.
- **Separation that works:** `src/types/` (14 domain type files) is clean; `FeatureGate`
  component + `FEATURES` taxonomy centralizes paywall logic; MCP tools
  (`src/lib/mcp/tools.ts`) reuse the same engines as HTTP routes — genuine reuse, not copy-paste.

### Data Architecture & Persistence
- **Schema: good bones, integrity batches landed.** 17 tables + `model_current` view, ~25
  indexes, sensible cascades. Identity FKs point at immutable `users(id)` with emails
  display-only. Billing idempotency has a dedicated `processed_stripe_event_ids` table;
  approval races are closed by `UPDATE … AND status='pending'` plus a pending-dedup partial
  unique index; orphaned FK rows land in a durable `fk_orphans` review table instead of
  rotting as silent NULLs.
- **Query patterns: bounded on hot paths, in-memory on the local backend by design.** Events,
  catalog, deals, and stats push predicates + `ORDER BY` + `LIMIT` into SQL with `COUNT(*)
  OVER()` totals on Postgres (`queries.ts:180-297, 486-533, 789-920`); the JSON fallback
  hydrates and slices in memory, which is acceptable for a dev backend but means local-mode
  latency never predicts production. `getModelDetail` / `getModelPriceHistory` still issue
  2 sequential `pool.query` calls that could be one round trip; `exportUserData` chains
  sequential queries where `getTeamDetail` already shows the `Promise.all` pattern.
- **Pooling: adequate, not yet defensive.** Single global `Pool` with `max: 10`,
  `idleTimeoutMillis: 30000`, and — new this pass — `connectionTimeoutMillis: 5000`,
  `statement_timeout: 15000`, and `pool.on('error')` logging (`client.ts:20-48`). No
  `pool.end()` handling, no transaction pooler. Under Vercel serverless, a process-global
  pool per warm instance can still exhaust a small Postgres `max_connections` during burst
  cold-starts — acceptable today, revisit with PgBouncer/Supabase pooler at scale.
- **Migration hygiene: much improved, two gaps left.** Nine incremental files (`005`–`013`)
  tracked by filename **plus SHA-256 checksums** with drift detection, each applied inside
  its own transaction, `EXPECTED_TABLES` current at 17, and a `db:migrate:status` command
  that exits nonzero when pending/drifted. Still missing: `001-004` (folded into baseline,
  now documented in `migrate.ts`), down migrations, and `schema.sql` still claims
  "PostgreSQL & SQLite compatible" while using `BIGSERIAL`/`JSONB`/`TIMESTAMPTZ`.

### Error Handling & Fault Tolerance
- **Handler is typed and safe.** `toAppError` (`src/lib/errors.ts:118-140`) maps unknown
  errors to a generic `InternalError` (raw `err.message`, pg codes, and Zod internals never
  reach clients — enforced by `tests/error-taxonomy.test.ts`), with `ValidationError → 400`,
  `ConflictError → 409`, `RateLimitError → 429` for known shapes; originals stay server-side
  via `captureException`. Legacy read routes return generic messages without stacks. No
  `err.message`-to-client pattern remains in API responses.
- **No resilience patterns.** No retries with backoff on ingestion fetches, no circuit
  breaker around OpenRouter/GitHub/HuggingFace sources, no per-source isolation (one slow
  source stalls the poll). The fail-closed philosophy now covers auth, rate limiting, cron,
  webhooks, and bot handlers — ingestion is the last major subsystem without it.
- **Write-path fire-and-forget** persists in spots (`updateApiKeyLastUsed().catch(()=>{})`,
  digest-delivery audit `.catch(()=>{})`): acceptable for telemetry, but audit the list
  before calling any of them load-bearing.
- **Cron fragility, reduced.** Vercel crons are authenticated fail-closed with hashed-IP
  denial audit logs and bounded fan-out (digest cap with deferred reporting) — but still no
  overlap guard (a slow poll + next tick = concurrent writers), no dead-letter record beyond
  `ingestion_runs`, and local cron runs depend on wall-clock invocation with no scheduler.
  The SSE stream has `maxDuration = 60` plus per-identity connection caps.

### Observability & Diagnostics
- **Structured logging, with redaction and audit trails.** `src/lib/logger.ts` emits JSON
  with secret-shaped keys scrubbed, stable `hashIp`/`hashEmail` for correlation without PII
  retention, and `logAuthDenied` records auth denials. Remaining gap: raw interpolated emails
  persist in a few message strings outside the redacted paths; finish the `hashEmail` sweep.
- **No metrics, no tracing.** "Telemetry" in this repo means *product* endpoint telemetry —
  valuable for users, useless for operators. No request-latency histograms, no DB-pool gauges,
  no error-rate counters, no trace propagation. The k6 nightly workflow produces load signals
  but nobody is paged on them yet.
- **Alerting hooks exist but point inward.** `triggerEscalationAlert` pages on ingestion
  failures — the right instinct, but it covers one source through an unmonitored channel. No
  SLOs, no burn-rate alerts, no cron-success/failure alerting.

### Testing & Quality Assurance
- **Genuinely strong for the project's age.** 56 files / 322 tests green in **both** DB modes
  (dual-mode CI matrix: Node 18/20 × local/postgres + `tsc` + `eslint` + `npm audit` +
  `next build` gates), real route handlers against real backends instead of mocks (`vi.mock`
  count: **zero**), Postgres-only 100k-row scale test, FK round-trip backup test, sanitizer /
  secrets / SSRF / rate-limit / error-taxonomy / parity suites, plus catalog-pushdown and
  backend-parity suites from this pass. The `Date.now() + random` fixture pattern (now
  factored into `tests/helpers.ts`) is the template all fixture authors should copy.
- **Gaps, ordered by risk:**
  1. **No E2E.** The k6 script runs nightly, explicitly non-blocking. Nothing exercises the
     browser → API → DB path; `FeatureGate` + paywall UX is untested.
  2. **Serial execution as a load-bearing constraint.** `fileParallelism: false` exists
     because the JSON backend can't handle concurrency. Suite wall-time (~110s / ~133s)
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
| P0 | Modularity | `queries.ts` god module (3,022 lines) | 17 tables × 2 backends in one file; every data change risks unrelated domains; growth accelerating (+371 lines last round) | Velocity decay; merge conflicts; a single bad edit can take down all domains | Split per domain (`db/users.ts`, `db/teams.ts`, `db/governance.ts`, `db/catalog.ts`, `db/events.ts`…) behind a repository interface; one domain per PR; keep function signatures stable so routes don't churn |
| P0 | Performance | Residual hydration (`getLatestSnapshotsMap`, deals free-list, restore replay) | Full `DISTINCT ON` scan still backs health/arbitrage/probes/pages; free-models unbounded; restore is row-by-row | Next user-visible degradation and slowest operational path as data grows | Push remaining filters down (or a `model_current` materialization); `LIMIT` on free-models; chunked multi-row restore replay reusing `bulkInsert` |
| P1 | Reliability | Migrations (`scripts/migrate.ts`, `migrations/`) | No down migrations, missing 001-004 file history, false "SQLite compatible" claim | Half-applied production migration with no rollback path | Document the fold-in (done in code comment — promote to docs); drop the SQLite claim; add down-migration policy |
| P1 | Performance | Pool (`client.ts:20-48`) | No `pool.end()` handling, no transaction pooler, `max: 10` per serverless instance | Burst cold-starts exhaust small Postgres; wedged instances linger | PgBouncer/Supabase pooler evaluation; graceful shutdown; per-instance `max` tuning |
| P1 | Testing | Cross-backend parity | No parity test, no shared fixture helpers (helpers exist now but parity coverage is one file) | Silent backend divergence on every new table | Expand parity coverage per new table; `vi.useFakeTimers` for clock tests |
| P2 | Hygiene | `localQueryRunner` | Only a few statement shapes simulated (now fail-loud, good) | Local dev surprises on unimplemented shapes | Extend shapes as needed or route everything through per-function adapters |
| P2 | Hygiene | Backup/restore allowlists (`backup-db.ts`, `restore-db.ts`) | New tables must be hand-added in 3+ places (now 17 + `schema_migrations` exclusion) | Next new table ships unrestorable, exactly like `teams` did | Derive table list from `information_schema` filtered against an explicit exclusion set, keeping `RESTORE_ORDER` only as an ordering hint with an assertion that every dumped table appears in it |
| P2 | Hygiene | `.env.example` duplicates | `DATABASE_URL` and `NEXT_PUBLIC_SITE_URL` listed twice each | Copy-paste "works on mine" confusion | De-duplicate and add a boot-time duplicate detector to `validateEnv()` |
| P2 | Testing | E2E + parallelism + coverage | No E2E, serial suite, no coverage gates, time-based tests | Regressions reach users; suite time grows linearly; god-module split lands untested | Playwright smoke (signin → watchlist → alert); per-file workers with isolated schemas (`CREATE SCHEMA test_$worker`); `@vitest/coverage` thresholds on `src/lib` |
| P2 | Observability | Metrics/tracing (`logger.ts` only) | Logs without metrics, traces, or SLOs | Degradation discovered by users, not dashboards | Request-duration histogram + pool-gauge + error counters; alert on cron failure and catalog p95; page on k6 nightly regressions |

### Before/After: P0 god-module split (the next cut to make)

```ts
// BEFORE: everything behind one import surface
import { getModelCurrentList, createTeam, updateUserTier, ... } from '@/lib/db/queries';
// 3,022 lines, 17 domains, 2 backends per function.

// AFTER: domain modules behind a stable repository interface; routes import
// only their domain. The existing function signatures become the interface,
// so no route churns during the split.
import { getModelCurrentList } from '@/lib/db/catalog';
import { createTeam } from '@/lib/db/teams';
import { updateUserTier } from '@/lib/db/users';
```

### Before/After: P0 chunked restore replay (reuse the proven helper)

```ts
// BEFORE (scripts/restore-db.ts): one round trip per row
for (const row of rows) {
  await client.query(`INSERT INTO ${table} (...) VALUES (...)`, values);
}

// AFTER: same bulkInsert(table, columns, rows) queries.ts already uses —
// one round trip per 1,000 rows, inside the existing transaction.
await bulkInsert(client, table, columns, rows.map(toValueArray));
```

### Completed exemplar: P0 catalog pushdown (landed, keep as template)

```ts
// BEFORE: hydrate everything, then filter/sort/slice
const snapshotMap = await getLatestSnapshotsMap();
let models = Array.from(snapshotMap.values());
models = models.filter(...); models.sort(...);
return { models: models.slice(offset, offset + limit), total: models.length };

// AFTER (queries.ts:486-533): predicates + ORDER BY + LIMIT in SQL,
// COUNT(*) OVER() for totals — Node never holds more than one page.
const res = await pool.query(
  `SELECT *, COUNT(*) OVER() AS full_count FROM model_current
   WHERE ${where.join(' AND ')} ORDER BY ${orderCol} ${dir}
   LIMIT $n OFFSET $m`, [...params, safeLimit, safeOffset]);
```

## 4. Optimization & Enhancement Recommendations

### Performance & Scalability
- **Residual hydration next** (§3 P0) — `getLatestSnapshotsMap` callers, free-models `LIMIT`,
  chunked restore replay. Everything else hot is bounded or back-office.
- **Pool defensively for serverless.** Timeouts and idle-error logging landed; add graceful
  shutdown and evaluate a transaction pooler before the next traffic step-change.
- **Cache the slow-but-stable.** `model_current` aggregations, benchmark matrices, and stats
  change on poll cadence (hourly), not request cadence — a 5-minute TTL layer on `/api/stats`,
  deals, and benchmarks removes repeated scans without invalidation machinery.
- **Asset basics.** No Docker (Vercel target — fine). Security headers ship globally;
  extend CDN/cache-header treatment to badges and `v1/benchmarks` (`s-maxage` already on feed).

### Developer Experience (DX) & Tooling
- **Kill the JSON-backend parallelism tax.** POSIX atomic rename landed; Windows uses
  copy+unlink (documented non-atomic). Next: in-process write mutex, then
  `fileParallelism: true` with isolated Postgres schemas per worker. Suite time is the
  team's second-biggest velocity lever after the god-module split.
- **Typing strictness: hold the line.** `tsc --noEmit` over src+tests with zero drift plus
  `eslint` 0 errors (294 warnings, all pre-existing patterns — no new `any` accepted in this
  pass) is working. Keep the ratchet: scheduled `any`-count check until the god-module
  split lands.
- **Seed/fixture ergonomics: started.** `tests/helpers.ts` now holds `uniqueEmail`,
  `seedTeamWithGovernance`, `seedCatalog` — migrate the remaining 60+ inline `Date.now`
  call sites onto it.
- **Migration DX.** `npm run db:init` works, `EXPECTED_TABLES` is current, and
  `db:migrate:status` answers "is staging current?" in one command. Next: checksum-gated
  deploy (fail the release when `drifted` is non-empty rather than logging).

### Security & Hardening Quick-Wins
- **Done this pass, preserve:** fail-closed cron/webhook/bot handlers, prod-required
  secrets, Stripe timestamp tolerance + event dedup + tier allowlist, key revoke-on-cancel,
  SSRF guard with redirect re-validation, session rate limits on all legacy reads, security
  headers, error-taxonomy no-leak, secret redaction + auth-denied audit, 7d rolling sessions,
  exact dep pins + critical audit gate + Dependabot, sliding-window limiter, payload caps,
  uniform-404 oracle suppression.
- **Remaining cheap items:** extend `src/lib/validation/api-schemas.ts` (currently
  models/events/benchmarks queries) to all mutation bodies (teams, watchlists, governance
  rules, alerts) — several routes still hand-validate or don't; finish the `hashEmail`
  sweep for the few raw-email log lines left; require `ADMIN_SECRET` in prod (currently
  fail-closed 401-always, which is safe but ops-blind).

## 5. Future Engineering & Feature Roadmap

### Phase 1: Stabilization & Hardening (Short-Term: Weeks 1–4)
Prior hardening layers are done (tier/backfill/bounded-reads/secrets/CI; integrity batch;
security pass; catalog pushdown + batching + migration hardening). This layer finishes the job:
- [ ] P0 god-module split, first cut (catalog + users domains; land with tests)
- [ ] P0 residual hydration (`getLatestSnapshotsMap` callers, free-models `LIMIT`, chunked restore)
- [ ] P1 pool hardening completion (graceful shutdown, pooler evaluation)
- [ ] P1 parity coverage per new table + migrate remaining fixtures to `tests/helpers.ts`
- [ ] P1 migration down-policy + drop SQLite claim; checksum-gated deploys
- [ ] P2 `.env.example` de-duplication; finish `hashEmail` sweep
- Exit criteria: split landed without route churn; full suite green both modes (holds today: 308/313 local, 322/322 Postgres)

### Phase 2: Architectural Scaling & Performance (Medium-Term: Month 2–3)
- [ ] Finish `queries.ts` split per remaining domains behind repository interfaces
- [ ] Per-file test workers with isolated schemas; Playwright smoke suite (signin → watchlist → alert)
- [ ] Coverage thresholds on `src/lib`; k6 nightly already runs — page on regressions
- [ ] Cache layer (SWR/TTL) on stats/deals/benchmarks read paths
- [ ] Cron overlap guard + dead-letter handling; ingestion per-source isolation + circuit breakers
- [ ] Request-duration/pool-gauge/error-counter instrumentation with alerts
- Exit criteria: suite time halved; E2E smoke green; degradation pages before users notice

### Phase 3: Next-Generation Feature Expansion (Long-Term: Month 4–6+)

| Feature | Business / Technical Value | Complexity | Architectural Prerequisites |
|---|---|---|---|
| Real-time price-drop push (WebSocket/SSE on `v1/stream` extension) | Retention moat: users act in minutes, not next-digest | High | Stream caps already landed (`maxDuration`, per-identity slots); per-user fan-out design (ADR-2) |
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
