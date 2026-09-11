# AI Model Radar - Architectural Review & Strategic Roadmap

> Review scope: full repository as of `994653c` (`src/` — 242 files,
> `scripts/`, `migrations/` 005–025, `tests/` — 80 files, `vercel.json`,
> `package.json`, `.github/workflows/`, `src/lib/db/schema.sql`,
> `extensions/`, `docs/`). Every claim is anchored to a file and line number.
> Grades reflect production-readiness, not effort. This review supersedes all
> earlier drafts: since the last review the team landed the `queries.ts`
> god-module split (22 domain modules behind a barrel), R1–R10 feature batch
> (extensions, capability/license data, usage import, compound alerts, savings
> leaderboard, export connectors, connector system, pilot routing gateway),
> the SCIM route-type fix, AES-GCM connector-secret encryption, and a full
> adversarial audit round (AUDIT10Features.md). Verified live against
> `radar-pg:5433`: **78 files / 465 tests pass local (+5 skipped), targeted
> suites re-run green on Postgres, `tsc` clean, `eslint` 0 errors,
> `next build` green.**

## 1. Executive Summary & Health Assessment

**One-paragraph verdict:** AI Model Radar is now a broad surface (26 pages,
72 API routes, 30 tables, 3 extension packages) over the same disciplined
event-sourced core — and the core survived the expansion intact: the
append-only history was never written by any new feature path (proven by
audit, not asserted), the old god module is dead, and 465 tests with zero
mocks guard both backends. The new structural problem is the *cost of
adding tables*: every table now has six touch points (`schema.sql`,
`migrations/`, `LocalDbState`, backup/restore lists, `EXPECTED_TABLES`,
domain module), and R5–R10 added six tables through exactly that gauntlet.
The second problem is concentration re-forming elsewhere: `governance.ts`
(831 lines), the 358-line chat route, and the digest route now carrying R6
matching inline. Nothing here needs a rewrite; the highest-ROI work is
retention policies for the new write-per-request tables, finishing the
secrets-rotation story the audit started, and stopping the next god module
before it calcifies.

### Overall System Maturity

| Dimension | Grade | Rationale |
|---|---|---|
| Architecture | **B+** | Event core + pure engines intact; `queries.ts` is a 43-line barrel (`src/lib/db/queries.ts:24-43`) over 22 domain modules. Dragged down by re-concentration (`db/governance.ts` 831 lines, chat route 358 lines), 72 routes with legacy+`v1` duplication, and hardcoded static datasets (`benchmarks.ts`, `capabilities.ts`, `licenses.ts`) that require deploys for data updates. |
| Code Quality | **B+** | Strict TS, `tsc` clean incl. tests, eslint 0 errors, zod at every new boundary (`api-schemas.ts` now 10KB covering R5–R10 payloads), constant-time secrets, SSRF guard reused by R8. Offset by `any` warnings (pre-existing pattern, now ~350+) and JSONB condition blobs (`compound_rules.conditions`) validated only in app code. |
| Maintainability | **B** | Domain-per-file is holding (new features followed it: `db/usage-imports.ts`, `db/routing.ts`, `lib/compound-rules.ts`). Tax: 6 touch points per table, 29 local-backend keys to mirror, hand-maintained backup/restore orders, and `012` migration drift still open on dev (blocks checksum-gated deploys). |
| Performance | **B** | Hot catalog/event paths bounded; R8 drivers capped (20/10 per run); digest fan-out capped. Open: `getLatestSnapshotsMap` full `DISTINCT ON` scan still backs detail/health/arbitrage/probe reads (`catalog.ts:20-26`); `routing_attempts` is write-per-request with no retention; digest R6 hook evaluates up to 500 events × rules per tick unmeasured. |
| Test Coverage | **A−** | 80 files / 465 pass (+5 skipped) in local mode, targeted suites green on Postgres, `vi.mock` count **zero**, mutation-verified PIN test for the tier-gate recurrence. Gaps unchanged: no E2E, serial execution (`fileParallelism: false`), no coverage gates, no fake timers. |

### Architectural Philosophy

**Core strengths (keep and extend):**
1. **The moat held through a 10-feature expansion.** R9/R10 were the
   dangerous ones — unreviewed ingestion and live traffic routing — and both
   landed with the invariant intact: `runConnector()` has zero non-test
   callers in `src/`+`scripts/` (audit-proven), and the gateway cannot
   silently substitute (400 without policy, verbatim explicit model).
   The "database is the product" principle now has machine enforcement, not
   just documentation.
2. **Engines-first held for R5/R6/R9/R10.** `usage-import.ts`
   (parse/aggregate/reconcile pure), `compound-rules.ts` (validate/match
   pure), connector `normalize` (pure), router `select*` (pure) — all
   unit-tested without I/O. The digest-cron R6 hook is correctly shaped:
   bounded, fail-safe-wrapped, never fails the digest.
3. **Fail-closed is now a house style.** Pilot triple-gate, secret-storage
   refusal without key, legacy-plaintext refusal, unsigned-webhook default
   deny, SSRF-guarded user destinations, no-retry proxy (double-bill
   reasoning documented). New code copies this shape without being told.
4. **Auditability as a feature.** `routing_attempts` + `routing/stats` is
   the first true operational metric surface; `AUDIT10Features.md` plus
   42 audit tests make the last round reproducible instead of lore.

**Fundamental structural risks:**
1. **Table-addition fan-out (6 touch points).** `schema.sql` + migration +
   `LocalDbState` (3 spots: interface, `emptyState`, hydration) +
   backup list + restore order + serials set + `EXPECTED_TABLES` (now 30).
   R5–R10 did all six correctly six times — by diligence, not tooling.
   The next contributor will miss one.
2. **Re-concentration.** `db/governance.ts` (831 lines, budgets + shadow +
   approvals + quorum) is the old god module reincarnating by domain
   instead of by backend. The chat route (358 lines: auth + breaker +
   policy + forwarding + fail-open + audit) and digest route (214 lines)
   are route-level equivalents. Each is one feature away from unreviewable.
3. **Data-as-code for market facts.** Benchmarks, capabilities, and licenses
   are curated TS arrays — correct for sourcing rigor, but every provider
   change ships as a code deploy, and the R1-0528 correction proved these
   rows rot. No curation path, no staleness signal, no owner.

### Primary Bottlenecks

1. **Unbounded new tables.** `routing_attempts` grows per proxied request
   and `usage_imports.rows_json` stores up to 2MB per import — neither has a
   retention/prune policy (`prune-raw-json` covers only the old path).
   This is the next storage cliff, and it is also a privacy posture issue
   for financial data.
2. **Suite wall-time under serial execution.** 78 files passed in ~226–327s
   local; every R-round adds files linearly because the JSON backend forces
   `fileParallelism: false`. CI feedback is now the slowest part of shipping.
3. **Single-key secret envelope.** `EXPORT_CONNECTOR_KEY` rotation is
   delete-and-re-register (documented, executable, but operationally sharp):
   a leak forces coordinated user action instead of a transparent re-wrap.
   Fine for the current connector count; not fine at 10×.

## 2. In-Depth Engineering Review

### Design Patterns & Modularity
- **Domain split landed and is being honored.** 22 modules under
  `src/lib/db/` (largest: `governance.ts` 831, `catalog.ts` 608,
  `teams.ts` 373, `users.ts` 338); routes import domains, barrel
  preserves compat. New R5–R10 code followed the pattern instead of
  reopening the god module — the strongest evidence the split worked.
- **Next split candidates are visible now:** `governance.ts` →
  `governance/{rules,shadow,approvals}.ts`; chat route → thin adapter over
  `lib/routing/forward.ts` (upstream call + fail-open shaping) keeping
  `router.ts` pure-selection; digest route → extract the R6 hook into
  `lib/compound-digest.ts` (it already has a clean inputs/outputs shape).
- **Static datasets need an interface, not just arrays.** `capabilities.ts`,
  `licenses.ts`, `benchmarks.ts` share a shape (sourced, dated, lookup +
  filter helpers) but no common type or staleness contract. A
  `SourcedRecord { source_url, verified_date }` base + a
  `verify:sources` CI job that fails on records older than N days would
  convert the R1-0528 lesson into machinery.
- **Legacy + `v1` duplication persists across ~14 surfaces** (models,
  events, and now capability/license enrichment implemented twice:
  `api/models/route.ts` vs `api/v1/models/route.ts`). Enrichment logic
  (`findCapabilityForModel`/`findLicenseForModel` join + attr filtering)
  is already copy-pasted between the twins — extract to
  `lib/catalog-enrichment.ts` before the third copy.
- **Extensions are correctly isolated** (own dir, excluded from root
  `tsconfig.json:26`, vscode has its own tsconfig) and covered by
  `audit10-tier-a` via stub-DOM — but neither extension compiles/publishes
  in CI, so bit-rot has no tripwire.

### Data Architecture & Persistence
- **Schema: 30 tables, integrity preserved.** FKs to `users(id)`,
  CHECKs on money/logic/status columns, partial unique index on
  approvals, `enc:v1:` ciphertext for connector secrets. Migrations
  021–025 applied cleanly on real Postgres with per-file transactions.
- **Query patterns: bounded reads, unbounded writes.** Reads stayed
  disciplined (R8 caps, digest caps, `COUNT(*) OVER()` totals preserved in
  the attr-filter path). Writes did not: `routing_attempts` (per request),
  `digest_deliveries`, `usage_imports.rows_json` (per upload) have no
  retention. The `model_current` view + `DISTINCT ON` full scan still backs
  `getLatestSnapshotsMap` and therefore detail/health/arbitrage/probes.
- **Dual-backend cost is now the dominant data tax.** 29 local-state keys,
  each with Postgres + JSON branches per function, plus three list files.
  Parity held this round (targeted suites green both modes) — by running
  everything twice, which is exactly the velocity tax §1 names.
- **Migration hygiene: good with one open sore.** Checksums, transactions,
  `migrate:status` all working; `012` drift on dev remains unaddressed,
  which vetoes the planned checksum-gated deploy. New tables did not add
  down-migration support (policy is forward-only + backup/restore —
  documented in `migrate.ts:15-19`, acceptable if the 012 drift is the
  exception that proves backups work).

### Error Handling & Fault Tolerance
- **Best-in-class for the project's age at the edges:** typed taxonomy with
  no client leakage, fail-closed cron/webhook/SCIM/admin paths, SSRF guard
  with redirect re-validation reused by R8, single-attempt proxy with
  documented no-retry rationale, legacy-plaintext refusal, decrypt-failure
  delivery degradation (secretless → driver fails closed, never plaintext).
- **Gaps, ordered by blast radius:** (1) digest R6 hook failure is swallowed
  to warn-log — correct for digest survival, but a silently dead hook looks
  identical to "no matches" (add a hook-error counter to the digest
  response); (2) no per-source isolation/timeouts in `runConnector` beyond
  what each connector implements (the interface documents throw-and-isolate
  but does not enforce a timeout — add `AbortSignal.timeout` in the runner);
  (3) R8 drivers share a 10s timeout but no circuit breaker — one slow
  Datadog endpoint serially delays a 20-event push (batch or deadline it).

### Observability & Diagnostics
- **Logs are good; metrics are one endpoint.** Secret-redacting JSON logs,
  auth-denied audit, delivery audit, DLQ, and now `routing/stats`
  (success rate, p50/p95, by-policy) — the first reliability-first readout.
  Still no request-latency histograms, pool gauges, error counters, trace
  propagation, SLOs, or paging (R10 stats has thresholds in prose, not alerts).
- **R-round metrics are product-telemetry, correctly scoped:** upload
  completion/deletion counts, `compound_rule_created`, connector runs,
  case-study submissions — counts without PII. The missing piece is
  *using* them: no dashboard or review cadence consumes the usage
  thresholds each feature spec demanded (CTR, second-upload habit,
  multi-condition share).

### Testing & Quality Assurance
- **Genuinely strong and still honest.** 465 pass / 5 skipped local, zero
  `vi.mock`, real handlers × real backends, mutation-verified PIN test
  (`tier-normalization.test.ts:161` fails 403 on the reverted fix),
  audit suites that found and fixed real bugs mid-audit (secret-store
  slice bug, R1 slug truncation). This is the project's crown jewel —
  protect it.
- **Gaps, ordered by risk:** (1) **No E2E** — paywall UX, upload→reconcile→
  share→moderate→leaderboard, and compound builder flows are untested
  across the browser→API→DB path; (2) serial suite (~4–5.5 min and growing
  linearly); (3) no coverage gates — the governance/chat/digest splits can
  land untested and CI stays green; (4) wall-clock tests without fake
  timers; (5) extensions publish/compile outside CI.

## 3. Critical Modifications & Technical Debt Remediation

| Priority | Category | Component / Module | Issue / Technical Debt | Impact If Ignored | Recommended Fix |
|---|---|---|---|---|---|
| P0 | Data lifecycle | `routing_attempts`, `usage_imports` | Unbounded write growth; financial rows retained indefinitely | Storage cliff + privacy posture decay on spend data | Retention policy + job: attempts aggregate-then-prune at 30/90d; imports auto-expire opt-in window (default 12mo, user-deletable anytime already); extend `prune-raw-json` into `prune-pii-tables` |
| P0 | Secrets | `src/lib/secret-store.ts` | Single-key envelope; rotation = re-register (sharp at scale) | Key leak forces coordinated user action across all connectors | Dual-key decrypt (`EXPORT_CONNECTOR_KEYS` list, try-each) + `re-encrypt` script; keep `enc:v1:` prefix → `enc:v2:` migration path |
| P0 | Modularity | `db/governance.ts` (831 lines) | Budgets + shadow + approvals + quorum in one module — god-module recurrence | Same velocity death as `queries.ts`, one domain away | Split to `governance/{rules,shadow,approvals}.ts` behind current exports; one domain per PR |
| P1 | Modularity | Chat route (358 lines), digest route (214) | Auth + policy + forwarding + fail-open + audit in one handler; R6 hook inline | Unreviewable at next feature; hook errors invisible | Extract `lib/routing/forward.ts`, `lib/compound-digest.ts`; add hook-error count to digest JSON |
| P1 | Migrations | `012` drift on dev | Blocks checksum-gated deploys; normalizes "drift is fine" | Next real drift ignored as noise | Resolve (re-baseline or document-and-repair), then gate deploys on `migrate:status` clean |
| P1 | Data freshness | `capabilities.ts`, `licenses.ts`, `benchmarks.ts` | Curated arrays rot silently (proven by R1-0528) | Stale capability/license data served as sourced fact | Shared `SourcedRecord` type + `verify:sources` CI staleness check + named data owner per file |
| P1 | Reliability | `runConnector`, R8 drivers | No enforced timeout/circuit breaker on third-party calls | One slow upstream stalls runs serially | `AbortSignal.timeout` in runner; batch R8 pushes with an overall deadline |
| P1 | API surface | Legacy + `v1` twins | Enrichment/filter logic already duplicated twice | Third copy guaranteed | `lib/catalog-enrichment.ts` shared by both twins; freeze legacy per ADR-4 |
| P2 | Testing | E2E + coverage + parallelism | No browser path tests, no gates, serial suite | Regressions reach users; CI time grows linearly | Playwright smoke (upload→share→moderate; builder→test-delivery); per-file workers w/ isolated schemas; `@vitest/coverage` thresholds on `src/lib` |
| P2 | Observability | Metrics/tracing | Logs without counters/traces/SLOs; R10 thresholds in prose | Degradation found by users; pilot bar unenforced | Histograms + gauges + error counters; page on routing 1h success < 99% / p95 overhead > 250ms; consume the R-spec usage metrics on a dashboard |
| P2 | Moderation | `admin/savings` via shared `ADMIN_SECRET` | No separate moderator role; single secret = full admin | Over-privileged moderation access | Scoped `MODERATION_SECRET` or role claim; moderation audit log (who approved what, when) |
| P2 | DX/CI | Extensions outside CI | Browser/VSCode packages compile/publish manually | Silent bit-rot | CI jobs: `tsc` vscode ext, package browser ext artifact, run `audit10-tier-a` (already in suite — keep) |

### Before/After: P0 dual-key secret envelope

```ts
// BEFORE (secret-store.ts): single key, rotation = re-register everything
const key = sha256(EXPORT_CONNECTOR_KEY);          // one key or nothing
decryptSecret(ciphertext);                          // throws on rotation day

// AFTER: key list with versioned envelopes, transparent rotation
// enc:v2:<keyId>:<iv>:<ct>:<tag> — decrypt tries each configured key,
// encrypt always uses the newest. Rotation = add key, run re-encrypt,
// drop old key. Users never re-register.
const keys = parseKeyring(EXPORT_CONNECTOR_KEYS);   // "id:hex,id:hex"
decryptSecret(row.secret, keys);                    // try-each by keyId
await reencryptConnectors(keys);                    // background script
```

### Before/After: P0 retention for write-per-request tables

```ts
// BEFORE: every proxied call appends forever; no job exists
await recordRoutingAttempt({ ... });                // routing_attempts grows ∝ traffic

// AFTER: bounded raw window + rolled-up history (same pattern as prune-raw-json)
await recordRoutingAttempt({ ... });                // unchanged write path
// nightly: ROLLUP routing_attempts → routing_daily_stats (policy, success_rate,
// p50/p95) then DELETE raw rows older than 30d; usage_imports older than the
// account retention window (default 12mo)(listed, consented, deletable anytime).
```

### Before/After: P1 shared enrichment (kill the third copy)

```ts
// BEFORE: identical join+filter code in api/models/route.ts and api/v1/models/route.ts
// AFTER (lib/catalog-enrichment.ts): one function, both twins call it
export function enrichModels(models: ModelCurrent[]) { ... capabilities/license join ... }
export function applyAttributeFilters(models, { tool_calling, vision, commercial }) { ... }
```

## 4. Optimization & Enhancement Recommendations

### Performance & Scalability
- **Bound the new writes first** (§3 P0 retention) — the only tables whose
  growth is ∝ traffic or ∝ upload size.
- **Retire `getLatestSnapshotsMap` full scans** from health/arbitrage/probe
  paths: serve from `model_current` with predicate pushdown (the catalog
  pushdown in `catalog.ts:106-162` is the template), or a materialized
  `model_current` refresh on poll.
- **Deadline R8 fan-out**: one overall budget (e.g. 30s) across the ≤20
  event pushes instead of 20 × 10s serial; record per-event skips.
- **Pool defensively for serverless**: timeouts landed (`client.ts:28-34`);
  add graceful shutdown on more paths (only `instrumentation.ts` wires
  `closePool` today) and evaluate PgBouncer before the next traffic step.
- **Cache slow-stable reads**: stats/deals/benchmarks change on poll
  cadence — 5-minute TTL removes repeated scans with trivial invalidation.

### Developer Experience (DX) & Tooling
- **Kill the 6-touch table tax.** Codegen the mirror: derive `LocalDbState`
  keys + backup/restore lists + `EXPECTED_TABLES` from `information_schema`
  or a single `tables.ts` manifest; keep `RESTORE_ORDER` as ordering hint
  with an assertion. Every R-round table proved humans *can* do six edits;
  none proved they *will* forever.
- **Parallelize the suite.** Per-file workers with isolated Postgres schemas
  (`CREATE SCHEMA test_$worker`) + keep JSON mode serial-only; target: halve
  wall-time before the next feature round doubles it again.
- **Typing ratchet.** `tsc` clean + 0-error eslint is working; add a scheduled
  `any`-count check (currently ~350 warnings) so the governance/chat splits
  don't smuggle new ones.
- **Seed curation tooling.** The R1-0528 lesson wants a `verify:sources`
  script (fetch each `source_url`, confirm 200 + date sanity) run nightly,
  paging the data owner — not a human calendar reminder.

### Security & Hardening Quick-Wins
- **Done and must be preserved:** triple-gate pilot, AES-GCM secrets with
  fail-closed creation, legacy-plaintext refusal, SSRF-guarded
  destinations, no-retry proxy, parameterized everything, redacted logs,
  constant-time compares, tier normalization at every boundary (now
  mutation-pinned on the chat path too).
- **Remaining cheap items:** scoped moderation secret + approval audit log;
  `EXPORT_CONNECTOR_KEY` rotation drill (procedure exists in SECRETS.md —
  never exercised); `ADMIN_SECRET` prod requirement (already fail-closed
  401-always; make it ops-visible); extend `api-schemas.ts` discipline to
  any remaining hand-validated bodies; hook-error visibility for the R6
  digest path.

## 5. Future Engineering & Feature Roadmap

### Phase 1: Stabilization & Hardening (Short-Term: Weeks 1–4)
- [ ] P0 retention job for `routing_attempts` + `usage_imports` (aggregate, prune, verify on Postgres)
- [ ] P0 dual-key secret envelope + `re-encrypt` script + rotation drill
- [ ] P0 `governance.ts` split, first cut (rules vs shadow vs approvals)
- [ ] P1 resolve `012` drift; checksum-gated deploys
- [ ] P1 extract `catalog-enrichment.ts`; freeze legacy routes per ADR-4
- [ ] P1 `verify:sources` nightly job for curated datasets
- [ ] P2 Playwright smoke (signin → upload → reconcile → share → moderate)
- [ ] R-spec usage-threshold first review: extension CTR, capability/license filter usage, second-upload rate, multi-condition rule share, connector runs, case-study submissions — sunset what misses
- Exit criteria: suite green both modes (holds: 465 local, targeted Postgres green); build green (holds); `migrate:status` clean (blocked today by `012`)

### Phase 2: Architectural Scaling & Performance (Medium-Term: Month 2–3)
- [ ] Chat/digest route thinning (`forward.ts`, `compound-digest.ts` + hook metrics)
- [ ] `getLatestSnapshotsMap` retirement from hot paths; evaluate PgBouncer
- [ ] Table-manifest codegen (kill the 6-touch tax); per-file test workers
- [ ] Coverage thresholds on `src/lib`; k6 nightly paging (exists non-blocking — make it page)
- [ ] R8 deadline fan-out + connector timeout enforcement; DLQ coverage for export runs
- [ ] Metrics/tracing instrumentation with the R10 thresholds as the first real alerts
- Exit criteria: suite time halved; E2E smoke green; degradation pages before users notice

### Phase 3: Next-Generation Feature Expansion (Long-Term: Month 4–6+)

| Feature | Business / Technical Value | Complexity | Architectural Prerequisites |
|---|---|---|---|
| R10 general availability | Turns pilot infra into revenue routing | High | 7-day pilot bar (≥99% success, p95 < 250ms) sustained; dual-key secrets; stats paging; ADR-010 GA amendment |
| Usage-based billing metering | Monetizes optimizer + routing value already built | Med | Metering aggregation job; webhook idempotency (done); retention policy (Phase 1) |
| OAuth billing connections (R5 stretch) | Removes CSV friction; habit-forming imports | High | Dedicated token-storage audit (per R5 spec); scoped read-only OAuth; revocation UX |
| Multi-source consensus pricing | Data moat + single-source resilience | High | Reviewed connectors running (R9 ops); source-weighted merge ADR; per-source breakers (P1) |
| Public API v2 + usage tiers | Developer acquisition; monetized R8/R10 surface | Med | Legacy freeze (ADR-4); keyed quotas; quota display in key UI |
| Team workspaces v2 (roles, invites) | Enterprise upsell for teams/governance/R7 | Med | Scoped moderation roles (P2); E2E membership paths |
| Anomaly alerts (spend spikes, EOL push) | Activates governance + telemetry tables | Low | Cron overlap guard; escalation channel monitoring |
| Extension store launches (R1/R2) | Funnel from where users already compare | Low | CTR instrumentation review; store-review privacy answers (allowlist story ready) |

## 6. Technical Decision Log (ADR Recommendations)

**ADR-5: Single-backend or contract-tested dual-backend — revisit with numbers.**
The JSON backend now mirrors 29 keys and doubles every query implementation;
parity held this round but cost two full test runs per change. Either (a)
keep both with generated mirrors (§4 codegen), or (b) demote JSON to a
seeded fixture backend and require Docker Postgres for dev. Decide with
measured contributor pain + CI minutes, before the next table-heavy round —
the 6-touch tax compounds per table and this ADR is the only structural fix.

**ADR-6: Sync crons vs async workers for digest/probe/export/routing fan-out.**
Digest (500-recipient cap with deferral), R8 pushes (serial, 10s each), and
any routing growth all run request-scoped with serverless time ceilings.
Options: (a) chunked cursors + overlap locks (current trajectory); (b) queue
(BullMQ/Redis — Redis already implied by `UPSTASH_REDIS_*`, or Vercel
Queues/Inngest); (c) off-Vercel scheduled jobs. Trigger: any cron exceeding
50% of its interval or first overlap incident — instrument durations now.

**ADR-7: Retention & downsampling policy for event-time tables.**
`snapshots` (existing `prune-raw-json` seed), plus new `routing_attempts`,
`digest_deliveries`, `usage_imports`, `routing_attempts` rollups. Decide
windows (30/90d raw, rollups forever, 12mo financial default) and the
partitioning strategy (`polled_at`/`created_at` ranges) at ~10⁶ rows or first
p95 breach — whichever comes first. Privacy review rides along for the
financial tables.

**ADR-8: R10 GA criteria and business posture.**
Pilot-only is the current authorized state (ADR-010). GA needs its own
amendment: sustained reliability bar evidence, OpenRouter-competition
positioning decision, incident history review, support/ToS updates for
routing traffic, and metering/billing for proxied calls. Do not let
"pilot works" silently become "GA launched" — require the amendment vote.
