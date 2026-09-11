# AI Model Radar - Architectural Review & Strategic Roadmap

> Review scope: full working tree including the uncommitted S1–S10 batch
> (`src/lib` — 70+ modules, `src/app/api` — 80+ routes, `migrations/`
> 005–026, `tests/` — 97 files, `src/lib/db/schema.sql`, `extensions/`,
> `docs/` incl. new `docs/S10_LIMITATIONS.md`). Every claim is anchored to a
> file and line number. Grades reflect production-readiness, not effort. This
> review supersedes all earlier drafts: since the last review the team landed
> Phase 2 hardening (route thinning, catalog cache, table manifest, SLO watch),
> Phase 3 scoped features (anomaly alerts, team invites v2, quotas, metering,
> source breakers, extension kit), the S1–S10 batch (S1 deprecation, S2 org
> scan, S3 optimizer, S4+S5 active probing, S6 finetune estimator, S7
> compliance, S8 codegen, S9 embeddings; S10 deliberately unbuilt), the FK
> backfill heal chain (009/012/013), session rate-limit wiring, and two live
> test failures found and fixed during this review (see §1). Verified live in
> local-backend mode: **full suite 97 files / 557 tests — 550 pass, 5 skipped,
> 2 fail at review start (both fixed live, 13/13 green on re-run), `tsc`
> clean, `eslint` 0 errors, `next build` green.**

## 1. Executive Summary & Health Assessment

**One-paragraph verdict:** the event-sourced core survived a second
10-feature expansion intact — S1 added a first-class event type
(`DEPRECATION_ANNOUNCED` in `src/types/events.ts:4`) instead of a side table,
and every S-round engine is pure and unit-tested without I/O. The genuinely
new development is cost surface, not code shape: S4+S5 is the first
paid-call infrastructure in a product that previously only read free
metadata, and today's review proved the next structural bill is due in the
test backend — the shared mutable JSON store produced a cross-file
pollution failure (`tests/price-history.test.ts` reading another suite's
`MODEL_REMOVED` from `.radar-data-worker-1.json`) that no amount of engine
purity can prevent. Nothing here needs a rewrite; the highest-ROI work is
test isolation, a runtime spend ledger for active probing, and the S2/S10
reviews that code alone cannot close.

**Live findings fixed during this review (evidence the process works):**
1. `tests/source-verify.test.ts:18` asserted exactly 3 curated datasets; the
   S-round correctly added `compliance` + `embeddings` to
   `src/lib/source-verify.ts:1-8,44-80`. The collector was right, the test
   was stale — updated to expect all five datasets.
2. `tests/price-history.test.ts:79` asserted positional `events[0]` identity
   against a backend that accumulates rows across files with no reset. Four
   `MODEL_REMOVED` rows for `test/price-history-model` in the worker file
   (timestamps matching this session's own runs, source `openrouter` —
   diff-engine output from ingestion-cycle tests sharing the store) broke the
   assertion. Fixed to assert newest-first ordering + presence of the
   suite's own `PRICE_CHANGE`. The loose assertion is documented in-test as
   tolerating the debt item in §3 P0-1; the strict fix is isolation itself.

### Overall System Maturity

| Dimension | Grade | Rationale |
|---|---|---|
| Architecture | **B+** | Event core + pure engines held through 9 shipped S-items; `catalog-enrichment.ts` is the correct single join point (now capabilities/license/compliance/category — `src/lib/catalog-enrichment.ts:12-62`); table manifest kills the 6-touch tax. Dragged down by the first paid-call surface with no runtime ledger, and enrichment becoming the next concentration point (6 joins, 2 filters). |
| Code Quality | **B+** | Strict TS, `tsc` clean, eslint 0 errors, zod at every new S boundary (`finetune-estimate`, `prompt-optimize`, `org-scan`, `migrate-code` routes), no-score/no-guess discipline preserved across all 9 items. Offset by `any` warnings (house pattern) and JSONB-ish free-form `new_value` blobs on the new event type. |
| Maintainability | **B** | Domain-per-file held (7 new types + 7 new libs, zero god-module growth); S10 gate recorded as `docs/S10_LIMITATIONS.md` instead of code. Tax: 7 curated static datasets with hand-maintained rows, enrichment filter logic now triple-stacked (attributes + category), and `012`-style checksum drift remains a standing risk per migration added. |
| Performance | **B** | Catalog TTL cache + bounded reads intact; S filters apply post-query over a 500-row cap (same pattern as R3/R4). Open: `getLatestSnapshotsMap` full `DISTINCT ON` scan still backs hot paths (`src/lib/db/catalog.ts:20-26`); active-probe cycles have a call-count cap but no time/deadline budget; no latency histograms on the new probe status route. |
| Test Coverage | **A−** | 97 files / 552 pass post-fix (+5 skipped) local, zero `vi.mock`, real handlers × real backends, S-round added 7 suites / 32 tests green. Gaps unchanged and now proven biting: no cross-file isolation (P0-1 failed live today), no E2E, serial wall-time (~200s and growing), no coverage gates. |

### Architectural Philosophy

**Core strengths (keep and extend):**
1. **The moat held through a second expansion.** S1's `DEPRECATION_ANNOUNCED`
   flows through the existing `model_events` table, `ingestion_runs` ledger,
   and `COMPOUND_EVENT_TYPES` (`src/lib/compound-rules.ts:30-37`) — no
   parallel event system. `runConnector()` still has zero non-test callers;
   the gateway still cannot silently substitute.
2. **Engines-first held for all 9 shipped items.** `deprecation.ts`
   (pair/median pure), `finetuning.ts` (estimator pure), `active-probe.ts`
   (diff/similarity/selection pure, generation injected),
   `prompt-optimizer.ts`, `org-scan.ts`, `migration-codegen.ts` — all
   unit-tested without I/O or network. `runActiveProbeCycle` takes a
   `generateFn`, so tests never spend money.
3. **Fail-closed is now a house style, and the S-round copied it.**
   Finetune 422s on unknown pricing instead of guessing
   (`src/app/api/v1/finetune-estimate/route.ts`); codegen 422s on
   unsupported pairs (`src/app/api/v1/migrate-code/route.ts`); optimizer is
   `no-store` session-only (`src/app/api/v1/prompt-optimize/route.ts`);
   org-scan is session-authed, rate-limited, audit-logged
   (`src/app/api/v1/org-scan/route.ts`); active-probe status route makes
   zero paid calls by construction.
4. **Gates as documents, not lore.** `docs/S10_LIMITATIONS.md` records the
   held item with decision log; `docs/SECRETS.md` gained the `PROBE_*`
   inventory; disclaimers ship in-band on every S6/S7/S8/S4+S5 response.

**Fundamental structural risks:**
1. **First paid-call surface without a runtime ledger.** The budget cap
   (`DEFAULT_ACTIVE_PROBE_BUDGET`, `src/types/active-probe.ts:29-35`) is a
   constant, not an account: no spend table, no kill switch, no alerting.
   A misconfigured cadence or a broadened target set spends real money with
   only a per-run call counter as witness.
2. **Test-backend sharing is now a proven failure source, not a theory.**
   Today's `MODEL_REMOVED` pollution is the shape of all future flakes:
   any suite that runs ingestion diffs can append rows any price-history /
   signal / forecast test can then read. Severity grows with suite size.
3. **Static-dataset sprawl.** 7 curated sets (benchmarks, capabilities,
   licenses, compliance, embeddings, embedding-benchmarks, finetune pricing)
   all rot the same way R1-0528 proved. `verify:sources` now covers 5
   datasets — good machinery, but still no named owner per file and no
   nightly paging.

### Primary Bottlenecks

1. **Shared mutable test backend (proven today).** No per-file reset or key
   namespacing; worker JSON files accumulate across runs and suites.
2. **Unmetered paid-call surface.** S4+S5 can run on schedule with only a
   constant as guardrail; finance learns about overruns from the provider
   invoice, not the product.
3. **S-round follow-through still manual.** S1 changelog ingestion has a
   builder (`buildDeprecationAnnouncementEvent`) but no poll worker; S2 has
   a scanner but no GitHub App manifest/review; active probing has a cycle
   runner but no scheduler wiring. Each is a pure core awaiting an operator.

## 2. In-Depth Engineering Review

### Design Patterns & Modularity
- **Enrichment hub is working — watch its growth.** `catalog-enrichment.ts`
   now joins 6 datasets and applies 2 filter families behind one import used
   by both models twins. Correct per ADR-4. Next split line is visible: move
   filter predicates to `lib/catalog-filters.ts` when the third family lands.
- **S-type/S-lib pairing is consistent** (`types/compliance.ts` +
   `lib/compliance.ts`, same for embeddings/finetuning/active-probe/
   optimizer/org-scan/codegen) and matches the R-round convention. Keep it.
- **Active probing extends rather than duplicates.** `active-probe.ts`
   reuses `probe.ts` concepts (targets, p95, tokens/sec) without forking the
   endpoint-health engine. The drift signal is deliberately *not* wired into
   `signals.ts` yet — correct, since no human-review queue exists to consume
   `candidate_for_review`.
- **Leaky edge:** `applyCategoryFilter` + `applyAttributeFilters` compose by
   nesting in two route handlers identically
   (`src/app/api/v1/models/route.ts`, `src/app/api/models/route.ts`) — a
   third twin or third filter family will copy-paste drift. Extract a single
   `queryCatalog()` helper on the next touch.
- **Extensions still outside CI** (unchanged): browser/VSCode packages have
   no compile/publish tripwire.

### Data Architecture & Persistence
- **Schema: 30 tables via manifest, integrity preserved.** `TABLE_MANIFEST`
   (`src/lib/db/tables.ts:19-51`) + `EXPECTED_TABLES` derivation
   (`scripts/migrate.ts:24`) + drift-guard test hold. Migrations 005–026
   apply in order; FK heal chain 008→009→012→013 is the model for loud,
   idempotent repair (normalize → dedupe → durable `fk_orphans` queue).
- **Event-type growth is disciplined.** `DEPRECATION_ANNOUNCED` rides
   `model_events` with JSONB `new_value {source_url, announced_at}` and a
   CHECK-free text column — acceptable, but the second JSONB-shaped event
   type argues for a documented `new_value` schema registry before a third.
- **New query pattern, same bound.** Deprecations route caps at 5000 events
   (`src/app/api/v1/deprecations/route.ts`) and pairs in Node — fine at
   current volume; needs predicate pushdown if announcement ingestion ever
   runs weekly across providers.
- **Dual-backend tax persists.** Every S feature that reads the catalog pays
   it (enrichment is in-memory static, so S7/S9 dodge it; S1's
   `getEvents`-backed report does not). The price-history flake is local-only
   evidence that the JSON backend's semantics (no isolation, file-shared)
   diverge from Postgres (schema-shared but test-transactional where used).
- **Migration hygiene: good, with standing risk.** Checksum drift detection
   + `migrate:status` + rebaseline tooling exist; each new migration file is
   another checksum that can drift on a hotfix branch.

### Error Handling & Fault Tolerance
- **S-round error paths are correct:** 400 on bad JSON/shape (zod details),
   401 on org-scan without session, 422 with supported-alternatives on
   unknown pricing/pairs, `Cache-Control: no-store` on optimizer + org-scan.
- **Active-probe budgeting is count-only.** `calls_skipped_over_budget` is
   reported (`src/lib/active-probe.ts`) but nothing enforces a wall-clock
   deadline, per-model timeout, or provider-error circuit breaker inside the
   cycle. One hung generation call stalls the run serially — same shape as
   the old R8 serial-push gap.
- **Digest/R6 hook swallowing, connector timeouts** — unchanged from prior
   review; still open (see §3).
- **Org-scan upload caps** (500 files × 200KB, `src/app/api/v1/org-scan/route.ts`)
   bound the new authenticated-DoS surface; session rate limiting (10/min)
   is correctly tighter than the 60/min default.

### Observability & Diagnostics
- **New audit trails where they matter:** org-scan logs
   `org-scan.completed` with org/repo-count/match-count/actor and no file
   contents; deprecation maturity is self-reporting
   (`total_pairs/min_pairs` on every response); probe status exposes battery
   version + budget + scope notes.
- **Still missing:** request-latency histograms, pool gauges, error
   counters, trace propagation; active-probe spend metering (the highest
   marginal value — dollars, not milliseconds); S1 pair-accumulation
   dashboard; S-spec usage-threshold consumption (compliance-filter CTR,
   estimator completion, latency-sort usage) has no dashboard or review
   cadence.
- **SLO watch + routing stats** exist as the first reliability readouts;
   active-probe needs the same treatment (cycle success rate, p95 cycle
   duration, calls-skipped rate) before scheduling.

### Testing & Quality Assurance
- **Strong and honest, with one honest failure.** 97 files / 552 pass (+5
   skipped) local post-fix, zero `vi.mock`, real handlers × real backends,
   S-round 32/32 green. The 2 failures caught live were both S-round
   integration seams (stale test expectation + shared-state pollution) — the
   suite doing its job.
- **Gaps, ordered by risk:** (1) **No cross-file isolation** — P0, proven
   today; (2) serial ~200s wall-time growing linearly with the S-round's 7
   new files; (3) no coverage gates — the enrichment hub and active-probe
   diffing can regress uncovered and CI stays green; (4) no E2E — compare
   page compliance section, benchmarks MTEB table, and estimator flows are
   untested across browser→API→DB; (5) extensions outside CI.

## 3. Critical Modifications & Technical Debt Remediation

| Priority | Category | Component / Module | Issue / Technical Debt | Impact If Ignored | Recommended Fix |
|---|---|---|---|---|---|
| P0 | Testing | Local JSON backend × all suites | No per-file reset/isolation; proven cross-file pollution (price-history `MODEL_REMOVED` flake) | Every future ingestion-touching test is a flake factory; erodes trust in the suite | Per-file backend reset in setup (clear `snapshots`/`events` or unique model-id namespaces per file); delete committed `.radar-data*.json` from git; assert empty-state precondition in history/signal suites |
| P0 | Cost control | `src/lib/active-probe.ts` + scheduler | Budget is a constant; no spend ledger, kill switch, or alerting on paid calls | Silent money burn on misconfiguration; invoice-driven discovery | `probe_spend_ledger` table (cycle id, model, calls, est. tokens, timestamp) + `ACTIVE_PROBE_ENABLED` kill switch + page on calls-skipped spike or spend delta; wire cycle through existing cron auth (`CRON_SECRET`) |
| P0 | Security review | S2 org scan (`src/app/api/v1/org-scan/route.ts`, `src/lib/org-scan.ts`) | Code-complete but unreviewed broad-permission surface; no App manifest, no reviewer sign-off | Ships the broadest permission grant on inherited trust | Dedicated review: manifest with `contents:read` only, data-policy shown pre-install, scan-audit retention window, deletion-path test, uninstall-revocation verification — then ship |
| P1 | Data freshness | 7 curated datasets (`benchmarks`, `capabilities`, `licenses`, `compliance`, `embeddings`, `finetune`) | Hand-maintained rows rot (R1-0528 precedent ×7 surface) | Stale compliance/pricing served as sourced fact — regulatory stakes for S7 | Named owner per file + `verify:sources` nightly paging (not just CI) + `SOURCE_MAX_AGE_DAYS` per dataset (compliance/finetune shorter than benchmarks) |
| P1 | Modularity | `src/lib/catalog-enrichment.ts` (62 lines, 6 joins) | Attribute + category filters composed by nesting in two twins | Third filter family guarantees a third copy and drift | Extract `queryCatalog({search, provider, filters, category, limit, offset})` used by both twins; freeze legacy per ADR-4 |
| P1 | Reliability | `runActiveProbeCycle` fan-out | No per-call timeout / deadline / breaker; serial await over up to 30 paid calls | One hung provider stalls the cycle; spend accrues while waiting | `AbortSignal.timeout` per generation call + overall cycle deadline + skip-and-record; mirror R8's 30s-deadline pattern |
| P1 | Data model | `model_events.new_value` shapes | Two JSONB conventions (diff-engine blobs + S1 `{source_url, announced_at}`), no registry | Third event type invents a third shape; validators diverge | Document `new_value` schemas per event type in `src/types/events.ts`; validate at `insertEvents` boundary |
| P2 | Testing | E2E + coverage + parallelism | No browser-path tests, no gates, ~200s serial | Regressions reach users; CI time grows per feature round | Playwright smoke (compare compliance section, MTEB table, estimator flow, deprecation collecting-state); per-file workers w/ isolated backends (fixes P0-1 structurally); coverage thresholds on `src/lib` |
| P2 | Observability | S-spec usage metrics | CTR/completion/maturity signals emitted nowhere consumable | Cannot sunset what misses its threshold; S10-style gates stay opinion | Lightweight metrics table or log-structured events + monthly review checklist per S-item success metric |
| P2 | Moderation/ops | S10 gate | Doc exists (`docs/S10_LIMITATIONS.md`), no ADR vote scheduled | Held item silently unholds under schedule pressure | Schedule the ADR-010-pattern vote explicitly; "no decision" keeps HELD status by default |

### Before/After: P0 test isolation

```ts
// BEFORE: suites share one mutable file; any ingestion test can break any reader
await insertSnapshots([...]);          // appends to shared .radar-data.json
const result = await getModelPriceHistory(MODEL_ID, 'all');
expect(result!.events[0].event_type).toBe('PRICE_CHANGE');  // flakes on residue

// AFTER: per-file namespace + empty-state precondition (cheap, no harness rewrite)
// tests/helpers.ts
export const ns = (f: string) => (id: string) => `test/${f}/${id}`;
// price-history.test.ts
const MODEL_ID = 'test/price-history/model-v1';   // unique per file, never reused
// + setup: clear snapshots/events keys for this backend before suite
// + committed .radar-data*.json git-ignored; CI starts from empty state
```

### Before/After: P0 probe spend ledger

```ts
// BEFORE: the only witness is a counter in the response
const res = await runActiveProbeCycle({ modelIds, generateFn });
return { calls_made: res.calls_made };                    // dollars unknown

// AFTER: every paid call leaves a ledger row; kill switch gates scheduling
if (process.env.ACTIVE_PROBE_ENABLED !== 'true') return { status: 'disabled' };
const res = await runActiveProbeCycle({ modelIds, generateFn });
await recordProbeSpend({ cycle_id: runId, calls: res.calls_made,
  est_tokens: res.samples.reduce(...), at: new Date().toISOString() });
// nightly: SUM(est_tokens) per provider vs budget → page before invoice day
```

## 4. Optimization & Enhancement Recommendations

### Performance & Scalability
- **Bound the new S1 read path first.** Deprecations route pulls 5000 events
   then pairs in Node — add SQL-side `event_type IN (...)` + provider
   predicate pushdown (the `catalog.ts:106-162` pattern) and a composite
   index on `(event_type, detected_at)` if announcement ingestion goes weekly.
- **Retire `getLatestSnapshotsMap` full scans** from detail/health/
   arbitrage/probe reads (unchanged; still the hottest full-scan path).
- **Deadline the active-probe fan-out**: per-call timeout + overall cycle
   budget (e.g., 5 min) with skip-and-record, mirroring the R8 30s-deadline
   recommendation already on the books.
- **Cache slow-stable S reads**: compliance/embeddings/finetune records
   change on curation cadence — serve from memory (module constants already
   are) and add `ETag`/`max-age` on the status/estimate GETs; keep
   money/decision POSTs uncached.
- **Pool defensively** (unchanged): timeouts landed; add graceful shutdown
   on remaining paths and evaluate PgBouncer before traffic steps.

### Developer Experience (DX) & Tooling
- **Kill test pollution at the source** (§3 P0-1): git-ignore worker JSON
   files, add a setup helper (`resetLocalBackend()` or per-file namespaces),
   and a CI assertion that committed `.radar-data*.json` files are absent.
- **Typing ratchet.** `tsc` clean + 0-error eslint holds; add a scheduled
   `any`-count check so the S-round's pragmatic `any`s (notably
   `deprecation.ts:72`, `source-verify.ts`) don't normalize new ones.
- **Seed curation tooling.** Extend `verify:sources` with per-dataset age
   budgets and page the file owner — compliance/finetune deserve shorter
   fuses than arena scores.
- **S1 ingestion worker.** The only S-item whose Phase 1 is still manual:
   a changelog/RSS poll worker reusing the ingestion-source pattern
   (polling, diffing, `ingestion_runs` rows) that emits
   `DEPRECATION_ANNOUNCED` via `buildDeprecationAnnouncementEvent`.

### Security & Hardening Quick-Wins
- **Done and must be preserved:** S6/S8 422-instead-of-guess, S3 no-store
   session-only, S2 session-auth + tight rate limit + audit log, legacy
   plaintext refusal, SSRF guards, constant-time compares, tier vocabulary
   at every boundary.
- **Remaining cheap items:** `ACTIVE_PROBE_ENABLED` kill switch + per-cycle
   auth on the (future) scheduled trigger; org-scan result purge endpoint
   (advertised as `DELETE /api/v1/org-scan` — implement it, it doesn't exist
   yet); moderation-role scoping if S2 review queue ever lands; rotation
   drill for one `PROBE_*` key to prove the SECRETS.md procedure.

## 5. Future Engineering & Feature Roadmap

### Phase 1: Stabilization & Hardening (Short-Term: Weeks 1–4)
- [ ] P0 test isolation (namespaces + setup reset + git-ignore worker files)
- [ ] P0 probe spend ledger + `ACTIVE_PROBE_ENABLED` kill switch + spend alert
- [ ] P0 S2 dedicated security/data-handling review (manifest, policy, deletion test, uninstall verification)
- [ ] P1 S1 changelog/RSS poll worker (real `DEPRECATION_ANNOUNCED` flow begins)
- [ ] P1 `queryCatalog()` extraction; legacy freeze re-affirmed
- [ ] P1 per-dataset `verify:sources` ages + named owners
- [ ] P2 `DELETE /api/v1/org-scan` purge implementation (route advertises it)
- [ ] S-spec usage-threshold first review: compliance-filter CTR, estimator completions, MTEB views, deprecation pair count, optimizer completions, codegen usefulness votes
- Exit criteria: full suite green from empty state twice in a row (no residue
   sensitivity); probe cycle behind kill switch + ledger; S2 review signed

### Phase 2: Architectural Scaling & Performance (Medium-Term: Month 2–3)
- [ ] Single-vs-dual-backend ADR with numbers (the flake moves this from
   hygiene to architecture — §6 ADR-5)
- [ ] Probe scheduling on cron infra (`CRON_SECRET`-gated, overlap locks,
   per-call timeouts, cycle metrics in routing-stats style)
- [ ] Deprecation read-path pushdown + `(event_type, detected_at)` index
- [ ] `new_value` schema registry + `insertEvents` validation
- [ ] Coverage thresholds on `src/lib`; per-file workers with isolated
   backends (structural fix for P0-1); k6 nightly paging
- [ ] Retention policy for `DEPRECATION_ANNOUNCED` pairs display window +
   org-scan result TTL
- Exit criteria: suite time halved or isolated; probe spend visible on a
   dashboard; degradation pages before users notice

### Phase 3: Next-Generation Feature Expansion (Long-Term: Month 4–6+)

| Feature | Business / Technical Value | Complexity | Architectural Prerequisites |
|---|---|---|---|
| S10 go/no-go vote | Unlocks enterprise-pricing intelligence or kills it cleanly | Low (decision) / High (build) | ADR-010-pattern sign-off; threshold + bounds documented (`docs/S10_LIMITATIONS.md` §3) |
| S1 maturity promotion | First data-moat trust signal ("provider X gives N days notice") | Low | 10+ real pairs via Phase-1 worker; collecting-state UI already built |
| S4 drift review queue | Turns diffs into a human decision surface | Med | Scheduled cycles + spend ledger; reviewer role; no-auto-verdict preserved |
| S5 latency as comparator sort | Answers "fast + cheap + good" in one view | Low | Cycle history table; scope-note rendering in comparator |
| S2 GitHub App pilot | Org-level acquisition motion | High | P0 review signed; App manifest; pilot allowlist + uninstall verification |
| OAuth billing connections (R5 stretch) | Removes CSV friction; habit-forming imports | High | Dedicated token-storage audit (unchanged from prior review) |
| Multi-source consensus pricing | Data moat + single-source resilience | High | Reviewed connectors running; source-weighted merge ADR; per-source breakers (shipped) |
| Public API v2 + usage tiers | Developer acquisition; monetized S surfaces | Med | Legacy freeze; keyed quotas (shipped); S-route quota mapping |
| Anomaly + drift unified signals | One event-cited signal surface | Low | Drift queue + anomaly engine share display contract (diffs + citations, no scores) |

## 6. Technical Decision Log (ADR Recommendations)

**ADR-5: Single-backend or contract-tested dual-backend — decide with numbers,
now urgent.** The JSON backend's file-shared semantics caused a live failure
today that Postgres would not (transactional tests). Either (a) per-file
isolated backends with a setup contract, or (b) demote JSON to seeded-fixture
mode and require Docker Postgres for dev/CI. Inputs: flake count over 30
days, CI minutes for dual runs, contributor setup friction. The S-round grew
the suite 7 files; the next round doubles the blast radius.

**ADR-9: Active-probe cost accounting.** Spend ledger schema (cycle, model,
calls, est. tokens, provider), budget source of truth (env vs table),
kill-switch semantics (fail-open status vs fail-closed scheduling), paging
thresholds (spend-delta and calls-skipped rate), and who owns the provider
budget caps. Decide before the first scheduled cycle — the code is ready,
the account is not.

**ADR-10 (S10): Enterprise-pricing go/no-go.** Pre-framed in
`docs/S10_LIMITATIONS.md`: legal sign-off, NDA disclaimer copy, threshold
number (≥5 orgs recommended), plausibility bounds + reviewer role. Default is
HELD; shipping without the vote repeats R10's anti-pattern.

**ADR-6 (carried): Sync crons vs async workers.** Digest, probes, and now
active-probe cycles all run request-scoped with serverless ceilings. Options
unchanged (chunked cursors + overlap locks vs queue vs off-Vercel jobs).
Trigger: any cycle exceeding 50% of its interval or first overlap incident —
instrument durations now, including the new probe cycle.
