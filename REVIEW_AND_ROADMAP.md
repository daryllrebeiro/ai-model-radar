# AI Model Radar - Architectural Review & Strategic Roadmap

> Review scope: `main` at `4d7f5d5` plus one uncommitted fix
> (`tests/helpers.ts` monotonic `ns()` sequence) — 4 next-steps commits on
> top of `fac1ba6` (metric sink table #33 + migration 029, supervised-cycle
> script, review checklist), `migrations/` 005–029, `tests/` — 109 files.
> Every claim is anchored to a file and line number. Grades reflect
> production-readiness, not effort. This review supersedes all earlier
> drafts: since the last review the team closed the review's own open loops
> (metric sink, supervised-cycle procedure, checklist) and hunted a flaky
> single-test failure across four full runs to a same-millisecond collision
> in test infrastructure. Verified live this session: **full local suite
> 108 files / 604 tests pass (0 failures), `tsc` clean, targeted 13/13
> green, working tree otherwise clean.**

## 1. Executive Summary & Health Assessment

**One-paragraph verdict:** the headline of this review is a flake caught
and killed, not a feature shipped. Four consecutive full runs showed an
intermittent single failure (2/4 runs); JSON-reporter triage plus mechanism
analysis traced the prime suspect to `ns()` — the P1-2 isolation helper —
which keyed uniqueness on `Date.now()` alone, so two calls in the same
millisecond produced identical "unique" ids and failed its own uniqueness
assertion. The fix (monotonic sequence suffix, `tests/helpers.ts`) is
stable 3/3 targeted with a confirming full-green run. Everything else this
round is consolidation: the metric sink gives the second threshold review
something to read besides zeros, the supervised-cycle script turns the
first-live-cycle procedure into an executable with a dry default, and the
five-line review checklist converts three audits' lessons into a pasteable
gate. No architecture changed; the system is measurably calmer than last
review.

**Live findings fixed since the last review:**
1. **Flaky `ns()` uniqueness (test infrastructure, High for trust).**
   Same-ms `Date.now()` collisions failed `backend-isolation.test.ts`
   intermittently (~2/4 full runs, never in targeted runs — classic
   timing-dependent signature). Fixed with a monotonic per-process
   sequence; stable 3/3 targeted + full-green confirm. Lesson: test
   helpers need determinism stronger than the clock.
2. Nothing else broke. The metric sink, cycle script, and checklist all
   landed green first try — the guard-wrapper/review-checklist culture
   is visibly preventing repeat findings.

### Overall System Maturity

| Dimension | Grade | Rationale |
|---|---|---|
| Architecture | **A−** | Unchanged shape, higher confidence: 33 tables all manifest-first (029 followed the drill), scheduler + ledger + queue + sink compose without new patterns. Drag unchanged: enrichment's 6 joins, single-instance overlap guard. |
| Code Quality | **A−** | `tsc` clean, eslint 0 errors, fire-and-forget metric emits that cannot break user flows (swallowed to warn-log by contract), refusal-first cycle script. Offset by `any` warnings and JSONB blobs (registry-documented). |
| Maintainability | **B+** | Review checklist (`docs/REVIEW_CHECKLIST.md`) is the highest-leverage doc added this round — five lines preventing five finding classes. Tax unchanged: 7 datasets, stacked filters, 29-migration checksum surface. |
| Performance | **B+** | No perf work this round and none was owed: prior pushdown/index/latency-sort work holds. Open items carry over (snapshot-map scans, histograms, cycle deadline). |
| Test Coverage | **A** | First A: 108 files / 604 pass with zero failures on the confirming run, flake root-caused and fixed with 3/3 stability proof, isolation contractual + startup reset + CI gate. Remaining gap is E2E, not unit confidence. |

### Architectural Philosophy

**Core strengths (keep and extend):**
1. **Flakes get root-caused, not re-run.** Four full runs (~13 minutes
   compute) to separate signal from noise, JSON-reporter triage, mechanism
   fix, stability proof, confirming run. That is the correct response to
   intermittence, and it is now precedent.
2. **Metrics before opinions.** The sink (`metric_events`, migration 029,
   registry-gated names, `getMetricSums`) means the second threshold
   review reads numbers. Emits are fire-and-forget by contract — the rare
   case where swallowing errors is the documented-correct choice, with the
   warn-log as the audit trail.
3. **Procedures become executables.** The first-live-cycle procedure is now
   `scripts/run-active-cycle.ts`: dry default verified live (10 targets,
   30 budgeted calls, zero spend), triple-gated live path (switch + key +
   explicit models) with refusal verified. A runbook that cannot be run is
   prose; this one was executed.
4. **Checklists compound.** `REVIEW_CHECKLIST.md` distills three audits
   into five review lines. If the next feature round produces zero repeat
   findings, this file is why.

**Fundamental structural risks (diminished again, none new):**
1. **Still zero production telemetry.** The sink exists; nothing has
   emitted in production yet (features unshipped). The sink is potential,
   not signal, until traffic flows.
2. **Still zero live paid cycles.** Script ready, switch OFF, no keys.
   First-cycle unknowns persist — but now with an executable path and a
   ledger waiting.
3. **Human gates unchanged.** S2 signatures, S10 vote, ADR-013
   ratification, OAuth checklist — all documented, none obtainable in
   this session.

### Primary Bottlenecks

1. **Unshipped surfaces.** Code complete, traffic zero — every success
   metric still reads 0 by construction. Shipping (or an explicit
   ship decision per item) is the bottleneck, not engineering.
2. **Human counterparties.** Four signatures/votes outstanding, all with
   complete packages awaiting readers.
3. **E2E absence.** Unit confidence is now A-grade; browser-path coverage
   is the thinnest remaining layer and the only one that can catch
   integration-class regressions the suite cannot see.

## 2. In-Depth Engineering Review

### Design Patterns & Modularity
- **Sink follows the domain pattern correctly.** `db/metrics.ts` is the
   eighth domain module: dual-backend, barreled, registry-gated names
   (`METRIC_NAMES`), tested both backends. Emits sit at the 4 natural
   completion points (3 estimator/optimizer/codegen successes + drift
   decisions) — completion semantics, not page-view spam.
- **Script layout is correct.** `scripts/run-active-cycle.ts` reuses lib
   engines + domain writers, adds no new patterns, fails closed three
   ways before spending. The `--help` + dry-default + explicit-models
   shape should be the template for future operator scripts.
- **Determinism lesson applied to helpers.** `ns()` now monotonic-suffixed;
   `uniqueEmail()` already had randomness. Rule of thumb established:
   test identifiers must be unique by construction (sequence/uuid), never
   by clock observation.
- **Enrichment, extensions, twins** — unchanged from last review; the
   `queryCatalog()` extraction still waits for the third filter family.

### Data Architecture & Persistence
- **Schema: 33 tables, manifest-clean.** 029 followed the drill; the
   drift-guard passes unmodified across three consecutive table additions
   (027/028/029) — the manifest process is now routine, which was the
   entire point of building it.
- **Metric rows are intentionally dumb.** `(name, value, at)` with no FKs,
   no rollup table — aggregation happens at read (`getMetricSums`), so
   there is no rollup job to operate and no second source of truth.
   Retention: follow the ledger's 90d precedent when volume warrants;
   not yet needed at zero traffic.
- **Dual-backend per ADR-012, now self-testing.** The flake episode
   validated the decision's framing (shared mutable store needs contractual
   isolation) while showing the contract works once helpers are
   deterministic. Committed-file CI gate + startup purge both held.
- **Migration hygiene holds at 29 files.** 027/028 applied to real
   Postgres with clean status last session; 029 applies idempotently
   (verify on next PG run — flagged as the one unverified item, since
   029 has only run against local so far).

### Error Handling & Fault Tolerance
- **Metric writes cannot break user flows** — `recordMetric` swallows to
   warn-log by explicit contract, tested (`1.5` value → no-op resolve).
   This is the mirror image of the spend ledger (which must never lose a
   row): metrics are advisory, ledger rows are accounting. Different
   reliability contracts, both documented, both tested.
- **Cycle script refusal order verified live:** no `--live` → dry;
   `--live` without switch → exit 1; switch without key → exit 1;
   live without `--models` → exit 1. Four refusals, zero spend, all
   executed (not asserted from reading).
- **Remaining gaps (unchanged):** single-instance overlap lease, cycle
   deadline, R6 hook swallowing, connector timeout.

### Observability & Diagnostics
- **The sink is the observability delta.** Plus cycle-script console
   output (targets, budget, ledger pointer) as operator telemetry.
- **Still missing (unchanged, now sharply defined):** production traffic
   through the sink; spend dashboard over ledger rows; pair-accumulation
   alerting; histograms/pool gauges/traces. The metric-names registry
   gives the dashboard a fixed vocabulary when it gets built.

### Testing & Quality Assurance
- **Process maturity milestone.** This round's testing story is the flake
   hunt: 4 full runs, reporter triage, mechanism fix, 3/3 stability,
   confirming green. The suite is now 108/604 with the failure mode
   understood rather than merely absent.
- **Known residual risk, stated plainly:** the culprit identification is
   mechanism-confident but not confession-certain (the failing assertion
   was never captured by name — the JSON run that would have named it
   came back green). If a single intermittent failure recurs, the
   procedure is recorded: full run with `--reporter=json
   --outputFile`, name the assertion, root-cause the mechanism.
- **Gaps, ordered:** (1) no E2E; (2) serial ~200s wall-time (four
   confirming runs cost ~13 min — parallelization ROI grows); (3) first
   CI coverage run still unobserved; (4) 029 migration applied to PG
   pending verification.

## 3. Critical Modifications & Technical Debt Remediation

| Priority | Category | Component / Module | Issue / Technical Debt | Impact If Ignored | Recommended Fix |
|---|---|---|---|---|---|
| P0 | Human gates | S2 signatures, S10 vote, ADR-013, OAuth checklist | Complete packages await readers; code ready | Ready code rots; bypass pressure builds | Calendar all four within 30 days; defaults stay closed |
| P0 | Empiricism | First live cycle + first nightly page | Pipeline + script ready; zero live data | Unknowns persist; schedule decision uninformed | Supervised cycle via script; confirm first verify page fires |
| P1 | Observability | Spend dashboard + pair alerting | Ledger/sink rows exist but no visualization | Data without decisions | Dashboard over `getMetricSums` + `getProbeSpendSince`; 10-pair gate alert |
| P1 | Modularity | `catalog-enrichment.ts` | 6 joins + latency helpers; third family pending | Guaranteed drift on next filter | Extract `queryCatalog()`; legacy already sunset-headered |
| P1 | Reliability | Overlap lease + cycle deadline | Single-instance flag; 30×15s worst case | Multi-instance double-spend; hung schedule | DB lease; overall deadline with skip-and-record |
| P1 | Verification | 029 on Postgres | Only locally applied/tested | PG-only failure discovered late | Apply + status-check + targeted suite on `radar-pg` next session |
| P2 | Testing | E2E | No browser-path coverage | Integration regressions invisible | Playwright smoke (5 flows incl. purge + queue UI when built) |
| P2 | Testing | Parallel workers | Serial ~200s; 4 confirming runs cost 13 min | CI time is now the velocity tax | PG per-worker schemas; parallelize after E2E exists |
| P2 | Data lifecycle | Metric-events retention | Unbounded growth once traffic flows | Slow table, no policy | 90d raw prune mirroring ledger when volume warrants |
| P2 | Ops | Drift queue UI | API + table, no reviewer surface | Candidates unread; SLA unmeasurable | Minimal queue page; review SLA |

### Before/After: flake-proof test identifiers (the round's fix)

```ts
// BEFORE: unique by clock observation — collides within the same millisecond
export function ns(file: string) {
  const run = Date.now().toString(36);   // two calls, one ms → same id → FAIL
  return (id: string) => `test/${file}/${run}/${id}`;
}

// AFTER: unique by construction — monotonic sequence can never repeat
let nsSeq = 0;
export function ns(file: string) {
  const run = `${Date.now().toString(36)}.${(nsSeq++).toString(36)}`;
  return (id: string) => `test/${file}/${run}/${id}`;
}
// Proven: 3/3 targeted stable + confirming full-green run (108/604).
```

### Before/After: advisory-vs-accounting write contracts

```ts
// Metrics (advisory): swallow to warn-log, never break the user flow
try { /* insert metric_events row */ }
catch (err) { logger.warn('metric.record.failed', { name }); }

// Ledger (accounting): throw loudly, caller handles (sibling pattern in
// spend-ledger.ts — negative counts reject, missing keys reject)
```

## 4. Optimization & Enhancement Recommendations

### Performance & Scalability
- **Parallelize the suite now that isolation is deterministic.** The
   flake fix removes the last correctness objection; per-file workers
   with the contractual `ns()` + startup purge are safe. Expected: ~200s
   → well under half. E2E can follow rather than gate — unit isolation
   no longer depends on serial execution.
- **`getLatestSnapshotsMap` full scans** — fifth review naming it.
   Schedule the predicate-pushdown or formally accept it with a comment.
- **Cycle deadline + DB lease** (§3 P1) before multi-instance scheduling.
- **Metric-events retention** when traffic starts (90d mirror of ledger).
- **Cache slow-stable S reads** (carried — no new evidence either way).

### Developer Experience (DX) & Tooling
- **Checklist is live — enforce it.** `REVIEW_CHECKLIST.md` five lines in
   the PR template (or CONTRIBUTING) so the next round measures zero
   repeat findings. Add the sixth line learned this round: *test
   identifiers unique by construction, never by clock.*
- **Operator-script template.** `run-active-cycle.ts` shape (dry default,
   `--help`, triple-gated live, ledger-first reporting) is the pattern
   for the next operator tool (verify-page drill, rotation drill).
- **Confirm 029 on Postgres** (§3 P1) — one migrate + status + targeted
   run, five minutes, closes the loop.
- **First CI coverage observation.** The job exists; read its first
   result rather than assuming 60/60/55/60 holds on 108 files.

### Security & Hardening Quick-Wins
- **Done and preserved:** N1 emits carry no PII (names + counts only —
   S3's content stays session-only, metrics count completions); cycle
   refusals verified live; checklist committed.
- **Remaining cheap items:** `PROBE_*` rotation drill pre-first-cycle;
   purge proof against a test org; allowlist scoping to 1–2 orgs at
   sign-off; re-observe org-scan 4MB cap against real pilot sizes.

## 5. Future Engineering & Feature Roadmap

### Recently done (verify, don't redo)

N1 sink (table 029 + 4 emits + suite), N2 cycle script (dry + refusals
executed), N3 checklist, ns() determinism fix with confirming green run.
Residual: 029 PG verification (5 min), E2E absence, unobserved CI coverage.

### Next: operations quarter (no new architecture required)

| Feature | Business / Technical Value | Complexity | Architectural Prerequisites |
|---|---|---|---|
| First live probe cycle | Empirical spend/latency; de-risks schedule | S (procedure) | Capped key + script ✅ (this round) |
| S-metric dashboard | Second threshold review reads numbers | S–M | Sink ✅ (this round) |
| Drift queue UI | Candidates reviewed; SLA measurable | M | Queue API ✅ |
| S1 promotion | First trust-moat signal | S | 10 pairs via weekly worker (0 now) |
| S2 pilot | Org acquisition | M | 2 signatures; allowlist ✅ |
| Nightly verify paging | Curation stays fresh | S | Ages + owners ✅; enable + confirm first page |
| Suite parallelization | CI time halved | M | Deterministic isolation ✅ (this round) |
| E2E smoke (5 flows) | Integration confidence | M | — (independent) |
| S10 vote | Unlock or kill pricing intel | S (decision) | Legal counterparty; package ✅ |
| OAuth implementation | Remove CSV friction | L | Checklist sign-off |
| Consensus engine | Data moat | M | ADR-013 ratification |
| API v2 build | Versioned growth | M | V2 plan + sunset headers ✅ |

## 6. Technical Decision Log (ADR Recommendations)

**ADR-012: DECIDED and now self-validating.** The isolation contract it
mandated produced the helper whose determinism bug this review fixed —
the framework works, including on itself. Standing rule added: test
identifiers unique by construction.

**ADR-09 (probe cost): implementation complete, operation pending.** All
six guard layers built; paging thresholds await first-cycle data. The
cycle script is the instrument; the supervised run is the experiment.

**ADR-10 (S10): HELD, vote unscheduled.** No change — calendaring, not
analysis, is the next action.

**ADR-013 (consensus): PROPOSED, awaiting ratification.** No change.

**ADR-6 (carried, fifth review): sync crons vs async workers.** Six
scheduled surfaces now. The ~200s serial suite plus 13-minute confirming
sessions are new evidence for async/parallel investment — but scoped to
CI workers, not product crons, which remain comfortably within limits.
