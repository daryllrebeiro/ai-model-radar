# AI Model Radar - Architectural Review & Strategic Roadmap

> Review scope: `main` at `fac1ba6` — 12 phase commits on top of `3815e51`
> (`src/lib` — 75+ modules, `src/app/api` — 85+ routes, `migrations/`
> 005–028, `tests/` — 108 files, 32 tables via manifest, `docs/` incl.
> ADRs 012/013, audit packages, threshold + promotion records). Every claim
> is anchored to a file and line number. Grades reflect
> production-readiness, not effort. This review supersedes all earlier
> drafts: since the last review the team executed the entire next-phases
> plan (P1-1→P1-7, P2-1→P2-5, P3 queue/sort/pilot/docs/status) across 12
> sequential commits, fixed a build-breaking route export live, and closed
> with a fully green tree. Verified live this session: **full local suite
> 107 files / 600 tests pass (0 failures), `tsc` clean, eslint 0 errors,
> `next build` green, real Postgres (`radar-pg`) migrations 027+028 applied
> with clean status and 31/31 targeted tests green, working tree clean.**

## 1. Executive Summary & Health Assessment

**One-paragraph verdict:** this is now a post-execution review, not a
pre-execution plan — every P0 and P1 from the last two reviews is either
landed or reduced to a human signature. The ledger exists
(`probe_spend_ledger`, migration 027, manifest table #31), the kill switch
defaults OFF, the scheduler refuses to spend without keys, test isolation
is contractual (`ns()` + `resetLocalBackend()` + startup reset + CI
hygiene gate), the S1 worker polls weekly, all 5 public S-routes share one
guard wrapper, and the drift queue stores evidence for humans only. What
remains is either data-accumulation (0/10 deprecation pairs, 0 probe
cycles) or decisions only people can make (S2 independent sign-off, S10
vote, ADR-013 ratification). The highest-ROI work is now operational, not
architectural: provision the first budget-capped probe key, run the first
live cycle, and hold the second threshold review.

**Live findings fixed since the last review:**
1. **Build-breaking route export.** The new scheduler exported a test
   helper (`__resetProbeOverlapForTests`) and a generator from a Next.js
   route module — `next build` rejects non-handler exports. Fixed by moving
   overlap state to `src/lib/probe-overlap.ts` and `buildProbeGenerateFn`
   into `src/lib/active-probe.ts`. Lesson recorded: route files export
   handlers, never helpers.
2. **Matcher threshold too strict.** The changelog poller's bare-name
   matcher (≥8 chars) missed real short names (`gpt-4o`). Fixed to ≥5 with
   a documented false-positive rationale; fixture suite caught it.
3. **Order-dependent history tests.** The new backend reset exposed tests
   6/8 in `price-history.test.ts` depending on leaked state — fixed to
   self-seed, per the ADR-012 rule that each break is treated as a real bug.

### Overall System Maturity

| Dimension | Grade | Rationale |
|---|---|---|
| Architecture | **A−** | First A-range grade: event core intact through 3 expansions, zero new tables that weren't manifest-first (027/028 followed the drill), guards extracted to a wrapper, scheduler gated four-deep, drift queue human-only by construction. Remaining drag: enrichment's 6 joins, single-instance overlap guard (documented, needs DB lease at scale). |
| Code Quality | **A−** | `tsc` clean, eslint 0 errors, zod at all 9 S boundaries plus 3 cron routes, 429/413/422/409 paths all pinned. Registry-validated event writes close the last "convention without enforcement" gap. Offset by `any` warnings (house pattern) and JSONB `new_value`/`diff_lines` blobs (now registry-documented). |
| Maintainability | **B+** | Domain-per-file held across 5 new modules + 2 tables; ADRs 012 (decided) / 013 (proposed) + 4 audit/design packages recorded as docs. Tax: 7 curated datasets (now owned, with age budgets), enrichment's stacked filters, checksum surface at 28 migrations. |
| Performance | **B+** | Pushdown verified + pinned (index already existed — no redundant migration built); latency sort bounded (500-cap window, telemetry map); probe fan-out has per-call timeouts + overlap guard. Open: `getLatestSnapshotsMap` full scans on hot paths; no latency histograms; coverage job added but first full run pending in CI. |
| Test Coverage | **A−** | 107 files / 600 pass local, 31/31 on real Postgres, zero `vi.mock`, isolation contractual with startup reset + CI committed-file gate. Gaps now narrow: no E2E, serial ~160s wall-time, per-file parallel workers still future work. |

### Architectural Philosophy

**Core strengths (keep and extend):**
1. **Execution matches planning.** The next-phases plan (`docs/
   NEXT_PHASES_IMPLEMENTATION_PLAN.md`) specified files, tests, and DoD
   per item; all 17 items landed as specified with verification at each
   step. The plan→build→verify loop is now the team's proven operating
   rhythm.
2. **Money has guardrails at every layer.** Constant budget →
   runtime ledger (`spend-ledger.ts`) → kill switch (default OFF) →
   scheduler gates (auth, switch, dry-run, key-required, overlap) →
   per-call timeouts → per-model error attribution → retention with
   pre-prune rollup snapshots. Six layers between intent and invoice.
3. **Fail-closed keeps compounding.** Guard wrapper (`route-guards.ts`),
   registry-validated writes, 401-before-413 ordering on org-scan,
   no-outage-as-drift, purge endpoint confirming zero retention — each new
   surface adopted the house style without being told twice.
4. **Honest states everywhere.** Collecting (0/10 pairs), disabled
   (kill switch), no-credentials (503, never half-run), HELD (S10),
   PROPOSED (ADR-013, OAuth) — the product now says what it hasn't done
   as clearly as what it has.

**Fundamental structural risks (all diminished, none zero):**
1. **Paid cycles are still theoretical.** The full spend pipeline exists
   but no live cycle has ever run (no keys provisioned). First-cycle
   unknowns (real token volumes, provider latency tails, ledger growth
   rate) are unmeasured — run one watched-model cycle and read the ledger.
2. **Test isolation is contractual, not mechanical.** `ns()` + reset +
   hygiene gate hold by convention and review checklist; per-file parallel
   workers with truly isolated backends remain future work (P2-4 residue).
3. **Dataset curation is owned but unstaffed.** Owners are named, budgets
   set, paging designed — but no nightly paging runs yet and no human has
   been paged. The first page proves the system.

### Primary Bottlenecks

1. **Zero production telemetry on new surfaces.** All S success metrics
   read 0 — features unshipped, no metric sink. The second threshold
   review cannot happen without the P2-observability sink.
2. **Human gates queueing.** S2 independent sign-off, S10 vote, ADR-013
   ratification, OAuth checklist — four decisions needing counterparties
   outside this session.
3. **Unmeasured paid-cycle behavior.** Infrastructure complete, empirical
   data absent — the first live cycle is the highest-information action
   available.

## 2. In-Depth Engineering Review

### Design Patterns & Modularity
- **Guard wrapper eliminated the copy-paste class.** All 5 public S-routes
   now open through `withPublicGuards()` (`src/lib/route-guards.ts`) —
   the audit's H1/H2 can never recur as a forgotten two-liner. Org-scan
   correctly keeps its session variant (different trust model, not an
   exception to unify away).
- **Route-module discipline learned the hard way.** The scheduler's
   helper-export build failure is now a documented rule: route files
   export handlers + config; all logic lives in lib (overlap in
   `probe-overlap.ts`, generation in `active-probe.ts`). Add it to the
   review checklist.
- **Domain modules added without god-module growth:** `spend-ledger.ts`,
   `drift-reviews.ts` (both barreled), `route-guards.ts`,
   `probe-overlap.ts`, `deprecation-changelog.ts` — each single-purpose,
   each tested without I/O beyond its backend.
- **Enrichment hub at 6 joins + latency helpers** (`latestP95ByModel`,
   `sortModelsByLatency`) — still the right home, but the next filter
   family must trigger the `queryCatalog()` extraction named two reviews ago.
- **Extensions still outside CI** (unchanged, third review running).

### Data Architecture & Persistence
- **Schema: 32 tables, manifest-clean.** 027/028 followed the drill
   (schema + migration + manifest + local mirror + barrel) and the
   drift-guard passes unmodified — the 6-touch tax is now a 6-touch
   checklist the team executes reliably. CI TRUNCATE list updated for the
   ledger (drift table needs no scheduled cleanup — queue rows are review
   records, pruned by decision, not time).
- **Event writes now registry-validated.** `insertEvents` rejects
   `DEPRECATION_ANNOUNCED` rows without `{source_url: https-url,
   announced_at: ISO}` (`src/lib/db/ingestion.ts:62-75`) against
   `EVENT_NEW_VALUE_SCHEMAS` (`src/types/events.ts:29-56`) — inferred
   dates cannot enter history through any writer, tested.
- **Read paths verified, not rebuilt.** P2-3 proved the deprecation query
   was already pushed down with its composite index and pinned it with
   tests instead of shipping a redundant migration — the review culture
   now avoids building to look busy.
- **Retention complete for the new surface.** Ledger rollup-then-prune
   (90d raw, aggregates survive via reads) wired into the prune cron with
   pre-prune rollup snapshots; org-scan needs no TTL (nothing persisted);
   announcements ARE history (no TTL by design).
- **Dual-backend per ADR-012 (decided).** Isolation contractual via
   `ns()` + `resetLocalBackend()` + startup worker-file purge + CI
   committed-file gate. Flake counter armed: 3 escapes in 90 days reopens.

### Error Handling & Fault Tolerance
- **Scheduler gate order is the exemplar:** 401 (cron secret) →
   disabled (kill switch) → dry-run (no spend) → 503 without keys →
   409 on overlap → per-call 15s timeouts → per-model error counts →
   ledger rows. Each refusal precedes the next spend.
- **Probe failure semantics exact and pinned:** success → sample + diff;
   budget → skipped counter; provider error → `errors` +
   `per_model_errors`, no sample, no diff; cycle continues.
- **Remaining gaps (narrowed):** single-instance overlap guard (DB lease
   documented for multi-instance); no overall cycle deadline (per-call
   timeouts bound the worst case to 30 × 15s); digest R6 hook still
   swallowed to warn-log; connector runner still unenforced timeout.

### Observability & Diagnostics
- **New trails this round:** ledger rows per model per cycle; pre-prune
   rollup snapshots in prune responses; changelog poll completion logs
   with items/emitted/error counts; drift queue with cycle attribution;
   `X-RateLimit-*` on all S routes; sunset headers on legacy.
- **Still missing (now the top bottleneck):** the S-metric event sink
   (blocks the second threshold review); probe spend dashboard over the
   ledger; S1 pair-accumulation alerting toward the 10-pair gate;
   request-latency histograms, pool gauges, traces (unchanged).

### Testing & Quality Assurance
- **Best shape yet.** 107 files / 600 pass local, 31/31 targeted on real
   Postgres, zero `vi.mock`, three live fixes this round (matcher
   threshold, order-dependent history tests, route-export build break) —
   two caught by tests, one by the build. The suite + compiler + build
   form a triple gate that actually gates.
- **Gaps, ordered by risk:** (1) no E2E — compare compliance section,
   MTEB table, estimator/optimizer flows, drift queue UI (nonexistent),
   purge flow untested browser→API→DB; (2) serial ~160s wall-time;
   (3) per-file parallel workers still future; (4) coverage thresholds
   configured but first full run happens in CI (job added this round);
   (5) extensions outside CI.

## 3. Critical Modifications & Technical Debt Remediation

| Priority | Category | Component / Module | Issue / Technical Debt | Impact If Ignored | Recommended Fix |
|---|---|---|---|---|---|
| P0 | Human gates | S2 review, S10 vote, ADR-013, OAuth checklist | Four decisions need outside counterparties; code is ready and waiting | Ready code rots; pressure builds to bypass gates | Schedule all four within 30 days; defaults stay closed (no pilot, HELD, proposed, design-only) |
| P0 | Empiricism | First live probe cycle | Full spend pipeline never executed; token volumes, tails, ledger growth unmeasured | First incident happens on a real schedule instead of a supervised run | Provision one budget-capped key; run one watched-model cycle manually; read the ledger; then schedule |
| P1 | Observability | S-metric event sink | All success metrics read 0; second threshold review impossible | Gates stay opinion; sunset rule unenforceable | Lightweight metric events + dashboard; S6/S3/S8 in-UI completion/vote signals |
| P1 | Modularity | `catalog-enrichment.ts` | 6 joins + 2 filter families + latency helpers, composed by nesting in twins | Third family guarantees drift | Extract `queryCatalog()`; freeze legacy (sunset headers already shipped) |
| P1 | Reliability | Overlap guard + cycle deadline | Single-instance flag; no overall deadline (worst case 30 × 15s serial) | Multi-instance double-spend; hung cycle occupies schedule | DB lease for overlap; overall cycle deadline with skip-and-record |
| P1 | Data freshness | Nightly verify paging | Ages + owners configured, paging not yet running, nobody paged | Silent rot returns; compliance rows highest stakes | Enable nightly job paging owners; confirm first page fires |
| P2 | Testing | E2E + parallel workers | No browser tests; serial suite; parallel needs isolated schemas | Regressions reach users; CI time grows | Playwright smoke (5 flows); PG per-worker schemas; then parallelize |
| P2 | Ops | Drift queue UI | Queue API + table exist, no reviewer UI | Candidates accumulate unread; SLA unmeasurable | Minimal queue page reusing compare-page card patterns; review SLA defined |
| P2 | Data lifecycle | Drift review retention | Decided rows accumulate forever | Slow table growth of decided rows | Archive-after-90d job for confirmed/dismissed (evidence export first) |
| P2 | DX | Coverage first run | Thresholds configured, CI job added, full run unobserved | Unknown whether 60/60/55/60 holds on the enlarged tree | Watch first CI coverage job; adjust deliberately or fix coverage |

### Before/After: P0 first live cycle (procedure, not code)

```ts
// BEFORE: pipeline complete, empirically empty
// ACTIVE_PROBE_ENABLED unset → every trigger returns { status: 'disabled' }
// probe_spend_ledger has zero rows; token-volume estimates are untested math

// AFTER (supervised first cycle):
// 1. Provision PROBE_OPENAI_KEY (budget cap $X, single-model allowlist).
// 2. ACTIVE_PROBE_ENABLED=true (staging env only).
// 3. Trigger with ?models=<one-watched-model> (live, not dry_run).
// 4. Read probe_spend_ledger: calls/errors/est_tokens match expectations.
// 5. Run getProbeSpendSince rollup; confirm alert query shape.
// 6. Decide: schedule weekly (vercel dry_run→live flip) or tighten caps.
```

### Before/After: P1 metric sink (smallest useful shape)

```ts
// BEFORE: success metrics exist only as spec prose + zero-count reviews
// AFTER: one table, one writer, one dashboard query
// metric_events HDL: (name, value, at) — S-route handlers emit
//   ('s6.estimate.completed', 1), ('s8.codegen.vote', +1/-1), ...
// Second threshold review reads SUMs instead of asserting zeros.
```

## 4. Optimization & Enhancement Recommendations

### Performance & Scalability
- **First CI coverage run is the next data point.** Job exists; if
   60/60/55/60 fails on the enlarged tree, add tests (preferred) or lower
   deliberately (recorded, never silent).
- **Parallelize only after E2E exists.** Per-file workers speed the suite
   but multiply backend semantics risk; ADR-012 isolation makes it safe,
   E2E makes it verifiable. Order matters.
- **`getLatestSnapshotsMap` full scans** remain the hottest unoptimized
   path (fourth review naming it — schedule the predicate-pushdown or stop
   listing it).
- **Probe cycle deadline** (§3 P1): bound worst case below 30 × 15s with
   skip-and-record.
- **Cache slow-stable S reads** (`ETag`/`max-age` on compliance/embeddings/
   battery GETs); keep money/decision POSTs uncached.

### Developer Experience (DX) & Tooling
- **Route-file rule is now documented.** Handlers + config only; helpers
   in lib. The build enforces it — keep the rule next to the error by
   leaving the comment in `probe-overlap.ts`.
- **Review checklist update** (from three rounds of findings): `ns()` ids
   in new suites; guards via wrapper (never bare); no non-handler route
   exports; registry entry for new event types; manifest entry for new
   tables. Five lines that prevent five findings.
- **Seed curation tooling.** Enable the nightly verify job; the first
   page is the milestone, not the configuration.
- **S1 worker needs production traffic.** Weekly schedule ships; confirm
   first run's `ingestion_runs` row and spot-check emitted events.

### Security & Hardening Quick-Wins
- **Done and must be preserved:** 12-commit chain all green; H1/H2/H3
   guards; guard wrapper; registry validation; kill switch OFF;
   scheduler gate order; no-outage-as-drift; purge endpoint; sunset
   headers; pilot allowlist (open state = unset, correctly permissive
   pre-pilot since sessions still gate).
- **Remaining cheap items:** one `PROBE_*` rotation drill pre-first-cycle;
   `DELETE` purge proof against a test org; scope the pilot allowlist to
   1–2 orgs at sign-off; review the 4MB org-scan cap after first real
   pilot scan sizes are observed.

## 5. Future Engineering & Feature Roadmap

### Phase 1 (done — verify, don't redo)

All 7 items shipped across `c76c1e2`→`00e1960` + docs: ledger/kill-switch,
isolation contract, purge + review package, changelog worker, guard
wrapper + registry, verify ages, threshold review. Residual: first nightly
page unobserved; first worker production run pending.

### Phase 2 (done — operate, don't rebuild)

ADR-012 decided; scheduler built (dry_run scheduled, live manual);
pushdown pinned; CI hygiene + coverage jobs added; retention wired.
Residual: first CI coverage run; overlap DB lease; cycle deadline.

### Phase 3: Next (Months 1–3 from here)

| Feature | Business / Technical Value | Complexity | Architectural Prerequisites |
|---|---|---|---|
| First live probe cycle | Empirical spend/latency data; de-risks scheduling | S (procedure) | Budget-capped key; kill switch (live) ✅ |
| S-metric event sink | Makes second threshold review possible | S–M | Route touchpoints identified ✅ |
| Drift queue UI | Candidates get reviewed; SLA measurable | M | Queue API ✅ (this round) |
| S1 promotion | First trust-moat signal live | S | 10 pairs via weekly worker (0 now) |
| S2 pilot (post-sign-off) | Org acquisition motion | M | Independent + sponsor signatures; allowlist ✅ |
| Latency-driven comparator promo | "Fast+cheap+good" as default view | S | Cycle history (needs live cycles) |
| S10 vote | Unlock or kill pricing intel | S (decision) | Legal counterparty; §3 package ✅ |
| OAuth implementation | Remove CSV friction | L | Audit checklist sign-off (`OAUTH_BILLING_AUDIT.md`) |
| Consensus merge engine | Data moat + resilience | M | ADR-013 ratification; reviewed connectors |
| API v2 build | Versioned growth; monetized S tiers | M | V2 plan ✅; sunset headers ✅ |

## 6. Technical Decision Log (ADR Recommendations)

**ADR-012: DECIDED (this round).** Per-file isolation with setup contract;
JSON retained. Flake counter armed (3 escapes/90d reopens). Implementation
complete: helpers, startup reset, CI gate.

**ADR-09 (probe cost accounting): EFFECTIVELY DECIDED by implementation.**
Ledger schema, env kill switch, gate order, per-model attribution, and
retention all landed; paging thresholds are the remaining open parameter —
set them from first-cycle data, not theory.

**ADR-10 (S10): HELD, vote unscheduled.** Package complete
(`S10_LIMITATIONS.md` + status row). Next action is calendaring, not
analysis — name the legal reviewer.

**ADR-013 (consensus pricing): PROPOSED, awaiting ratification.**
Weighted-median + divergence-signal design recorded; per-source breakers
already shipped. Ratify/amend/reject before any merge engine.

**ADR-6 (carried, fourth review): sync crons vs async workers.** Five
scheduled surfaces now (poll, probes, digest ×2, deprecations, active-probe
dry-run). Trigger unchanged: any cycle past 50% of its interval or first
overlap — instrument durations now; the overlap flag already reports.
