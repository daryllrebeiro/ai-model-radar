# AI Model Radar - Architectural Review & Strategic Roadmap

> Review scope: `main` at `3815e51` — 9 S-round commits on top of `739cdd3`
> (`src/lib` — 70+ modules, `src/app/api` — 80+ routes, `migrations/`
> 005–026, `tests/` — 98 files, `src/lib/db/schema.sql`, `extensions/`,
> `docs/` incl. `docs/S10_LIMITATIONS.md`, plus `AUDIT_S_FEATURES.md`).
> Every claim is anchored to a file and line number. Grades reflect
> production-readiness, not effort. This review supersedes all earlier
> drafts: since the last review the team shipped S1–S9 across 7 feature
> commits, ran a dedicated adversarial audit of the new surface
> (`AUDIT_S_FEATURES.md`, 3 findings fixed live), and pushed everything
> green. Verified live this session, local-backend mode: **12/12 files,
> 68/68 tests green across the S-suites + audit suite + neighbors
> (r3-r4, source-verify, price-history, session-rate-limit); `tsc` clean
> from the prior session with no code changes since; working tree clean.**

## 1. Executive Summary & Health Assessment

**One-paragraph verdict:** the audit round just completed is the strongest
evidence this codebaseFOR is healthy: adversarial review of the 9 shipped
S-items found 3 real issues (5 unthrottled routes, missing pre-parse body
guards, probe cycle abort on single-provider failure), all fixed live with
regression pins, and the full S-surface is 68/68 green with `tsc` clean and
a clean tree on `main`. The event-sourced core survived a second 10-feature
expansion intact — S1 added an event type, not a side table — and the new
development remains cost surface, not code shape: S4+S5 is still the first
paid-call infrastructure with only a constant as guardrail, and test-backend
isolation is still an assertion relaxation rather than a structural fix.
Nothing needs a rewrite; the highest-ROI work is the probe spend ledger,
test isolation, and the two reviews code cannot close (S2 permission, S10
strategy).

**Live findings fixed since the last review (the audit working as designed):**
1. **H1 (High): 5 public S-routes had zero rate limiting** —
   `GET /api/v1/deprecations` (5000-row read + Node pairing per hit),
   `GET /api/v1/active-probe`, and the finetune/optimizer/codegen POSTs.
   Fixed with `validatePublicApiRequest` on all five
   (`src/app/api/v1/deprecations/route.ts:15-18`,
   `src/app/api/v1/active-probe/route.ts`,
   `src/app/api/v1/finetune-estimate/route.ts`,
   `src/app/api/v1/prompt-optimize/route.ts`,
   `src/app/api/v1/migrate-code/route.ts`), same anonymous-within-budget
   pattern as `v1/models`.
2. **H2 (Medium): no pre-parse body guards** — compute routes parsed full
   JSON synchronously; org-scan's schema admitted ~100MB. Fixed with
   `assertPayloadSize` before `request.json()` (256KB × 3, 4MB org-scan).
3. **H3 (Medium): one throwing provider aborted the whole paid cycle.**
   Fixed with per-call try/catch + `errors` counter in
   `src/lib/active-probe.ts` — errored calls emit no sample and no diff, so
   outage can never present as drift.
4. Earlier (prior session): stale `source-verify` dataset expectation and
   the price-history shared-state flake — both fixed, both still green.

### Overall System Maturity

| Dimension | Grade | Rationale |
|---|---|---|
| Architecture | **B+** | Event core + pure engines held through 9 shipped S-items and a hostile audit without a single architectural change — every fix was a guard, not a redesign. `catalog-enrichment.ts` remains the correct single join point. Dragged down by the still-unledgered paid-call surface and enrichment's 6-join growth. |
| Code Quality | **B+** | Strict TS, `tsc` clean, eslint 0 errors, zod at all 6 S boundaries, 429/413/422 paths all pinned by tests. The audit added the missing cross-cutting guards (throttleniosk + payload caps) the feature round skipped. Offset by `any` warnings (house pattern) and free-form `new_value` blobs on the new event type. |
| Maintainability | **B** | Domain-per-file held (7 new types + 7 new libs, zero god-module growth); S10 gate recorded as `docs/S10_LIMITATIONS.md`; audit recorded as `AUDIT_S_FEATURES.md` with decision-grade verdicts. Tax: 7 curated static datasets, enrichment's triple-stacked filters, checksum drift risk per migration. |
| Performance | **B** | Catalog TTL cache + bounded reads intact; S filters apply over a 500-row cap; S1 report caps at 5000 events with Node pairing (fine at current volume). Open: `getLatestSnapshotsMap` full `DISTINCT ON` scan on hot paths; probe cycles have call caps but no time/deadline budget; deprecations read path has no SQL pushdown. |
| Test Coverage | **A−** | 68/68 green on the S-surface + audit suite + neighbors, zero `vi.mock`, real handlers × real backends, 11-test audit suite pinning every finding. Gaps unchanged: no cross-file isolation (assertion relaxed, isolation open), no E2E, ~200s serial wall-time, no coverage gates. |

### Architectural Philosophy

**Core strengths (keep and extend):**
1. **Guards compose; redesigns weren't needed.** H1/H2/H3 were each fixed
   with existing house machinery (`validatePublicApiRequest`,
   `assertPayloadSize`, per-call try/catch) — proof the fail-closed style
   is load-bearing, not decorative. New code copies it without being told.
2. **The moat held through a second expansion plus audit.** S1's
   `DEPRECATION_ANNOUNCED` rides `model_events` + `COMPOUND_EVENT_TYPES`
   (`src/lib/compound-rules.ts:30-37`); `runConnector()` still has zero
   non-test callers; the gateway still cannot silently substitute; S6/S8
   422-instead-of-guess survived adversarial review untouched.
3. **Engines-first held for all 9 items.** Every S engine is pure and
   unit-tested without I/O; `runActiveProbeCycle` takes an injected
   `generateFn`, so the 68-test surface never spends money and never hits
   network.
4. **Gates as documents, not lore.** `docs/S10_LIMITATIONS.md` (HELD with
   decision log), `AUDIT_S_FEATURES.md` (conditional passes with named
   residuals), disclaimers in-band on every S6/S7/S8/S4+S5 response.

**Fundamental structural risks:**
1. **Paid-call surface still has no runtime ledger.** H3 made cycles
   fail-safe per call, but the budget (`DEFAULT_ACTIVE_PROBE_BUDGET`,
   `src/types/active-probe.ts:29-35`) is still a constant, not an account:
   no spend table, no kill switch, no alerting. Status route makes zero
   paid calls by construction — the scheduler (not yet built) is where
   money actually moves.
2. **Test-backend isolation is documented, not fixed.** The price-history
   assertion now tolerates residue instead of assuming cleanliness. The
   flake shape (ingestion tests appending rows reader tests can see)
   persists for all 98 files sharing worker JSON stores.
3. **Static-dataset sprawl ×7.** `verify:sources` covers 5 datasets, but no
   named owner per file, no nightly paging, no per-dataset age budgets —
   and S7 compliance rows carry regulatory stakes the arena scores don't.

### Primary Bottlenecks

1. **Unmetered paid-call surface.** Code-complete and fail-safe, but
   finance learns about overruns from the provider invoice, not the product.
2. **Shared mutable test backend.** Proven failure source; current
   mitigation is tolerant assertions, not isolation.
3. **Manual follow-through on shipped cores.** S1 changelog worker,
   probe scheduler, S2 App manifest/review, org-scan purge endpoint
   (advertised, unimplemented) — each shipped core awaits its operator.

## 2. In-Depth Engineering Review

### Design Patterns & Modularity
- **Enrichment hub holding at 6 joins + 2 filter families**
   (`src/lib/catalog-enrichment.ts:12-62`, now with `category`/`embedding`
   fields and `applyCategoryFilter`). Both models twins share it — no third
   copy appeared during the S-round. Next split line is visible: extract
   `queryCatalog()` when the third filter family lands.
- **S-type/S-lib pairing consistent** across all 7 new pairs; audit added
   no new modules, only guards inside existing ones — correct layering.
- **Active probing extends rather than duplicates** (`active-probe.ts`
   reuses `probe.ts` target/p95/tokens concepts). The drift signal is still
   deliberately unwired from `signals.ts` — no review queue exists to
   consume `candidate_for_review`, and wiring it early would create
   unactionable alerts.
- **Route-handler shape converged.** All 6 S routes now open with the same
   two lines (throttle, then size-guard for POSTs) — a de facto middleware
   pattern worth extracting to a `withPublicGuards()` wrapper on the next
   route added.
- **Extensions still outside CI** (unchanged): no compile/publish tripwire.

### Data Architecture & Persistence
- **Schema: 30 tables via manifest, integrity preserved.** `TABLE_MANIFEST`
   (`src/lib/db/tables.ts:19-51`) + drift-guard test hold; FK heal chain
   008→009→012→013 remains the repair model. The S-round added **zero
   tables** — S1 reused `model_events`, everything else is static or
   stateless. That restraint is the quarter's best data decision.
- **Event-type growth disciplined but unregistered.** `DEPRECATION_ANNOUNCED`
   stores `{source_url, announced_at}` in `new_value` with no schema
   registry — two JSONB conventions now; validate at `insertEvents` before
   a third type lands.
- **New read paths bounded after audit.** Deprecations caps at 5000 events
   *and* is throttled (H1); optimizer/codegen/finetune bodies capped
   pre-parse (H2). Org-scan's 500×200KB schema still relies on the 4MB
   header guard + worker chunking — acceptable, documented in-route.
- **Dual-backend tax persists.** Enrichment dodges it (in-memory statics);
   S1's `getEvents`-backed report does not. Local-backend semantics (shared
   files, no isolation) remain the divergence risk Postgres doesn't share.
- **Migration hygiene good, standing risk unchanged.** Checksums, `status`,
   rebaseline tooling all hold; each file is another drift candidate.

### Error Handling & Fault Tolerance
- **Post-audit route matrix is complete:** 400 on bad JSON/shape (zod),
   401 on org-scan without session (checked before any parse work — pinned),
   413 on oversized bodies (pinned for 3 routes), 422 with alternatives on
   unknown pricing/pairs (untouched by audit — already correct), 429 past
   tier budget on all 5 public S routes (new).
- **Probe failure semantics now exact:** success → sample + diff; budget
   exhaustion → `calls_skipped_over_budget`; provider error → `errors`
   with no sample, no diff, cycle continues. All three pinned.
- **Remaining gaps (unchanged, ordered):** no per-call timeout/deadline
   inside the cycle (serial await over ≤30 paid calls); digest R6 hook
   errors swallowed to warn-log; connector runner has no enforced timeout;
   R8 pushes serial without an overall deadline.

### Observability & Diagnostics
- **Audit-strengthened trails:** org-scan `org-scan.completed` (org, repo
   count, matches, actor — no contents); deprecation self-reporting
   maturity (`total_pairs/min_pairs`); probe `errors` + `calls_skipped`
   counters per cycle; throttling emits standard `X-RateLimit-*` +
   `Retry-After` on every S route.
- **Still missing (highest value first):** probe spend metering (dollars,
   not milliseconds); S1 pair-accumulation tracking toward the 10-pair
   gate; S-spec usage-threshold consumption (compliance CTR, estimator
   completions, latency-sort usage) with no dashboard; request-latency
   histograms, pool gauges, trace propagation (all unchanged).

### Testing & Quality Assurance
- **Genuinely strong and twice-proven.** 68/68 this session on the
   S-surface + audit + neighbors; the feature round's 32/32 plus the
   audit's 11/11, zero `vi.mock`, real handlers × real backends. Two
   separate live failures (stale expectation, shared-state pollution)
   caught by the suite, plus three audit findings caught by adversarial
   review — the process finds things.
- **Gaps, ordered by risk:** (1) **No cross-file isolation** — still P0,
   mitigated not fixed; (2) ~200s serial wall-time, +8 files this round;
   (3) no coverage gates over the enrichment hub or probe diffing; (4) no
   E2E — compare compliance section, MTEB table, estimator and optimizer
   flows untested browser→API→DB; (5) extensions outside CI.

## 3. Critical Modifications & Technical Debt Remediation

| Priority | Category | Component / Module | Issue / Technical Debt | Impact If Ignored | Recommended Fix |
|---|---|---|---|---|---|
| P0 | Cost control | `src/lib/active-probe.ts` + future scheduler | Budget is a constant; no spend ledger, kill switch, or alerting on paid calls (H3 fixed safety, not accounting) | Silent money burn; invoice-driven discovery | `probe_spend_ledger` table + `ACTIVE_PROBE_ENABLED` kill switch + page on spend-delta/calls-skipped; schedule only behind `CRON_SECRET` |
| P0 | Testing | Local JSON backend × 98 suites | No per-file reset/isolation; price-history assertion now tolerates residue instead of assuming clean | Every ingestion-touching test is a latent flake; tolerance masks real regressions | Per-file namespaces + setup reset; git-ignore worker JSON; empty-state precondition; CI fails on committed `.radar-data*.json` |
| P0 | Security review | S2 org scan | Code-complete and throttled, but unreviewed broad-permission surface; purge endpoint advertised but unimplemented | Ships broadest grant on inherited trust | Dedicated review + `contents:read`-only manifest + implement `DELETE /api/v1/org-scan` + uninstall-revocation proof |
| P1 | Data freshness | 7 curated datasets | Hand-maintained rows rot (R1-0528 precedent ×7); compliance rows carry regulatory stakes | Stale compliance/pricing served as sourced fact | Named owner per file; `verify:sources` nightly paging; per-dataset age budgets (compliance/finetune shorter) |
| P1 | Data model | `model_events.new_value` | Two JSONB conventions, no registry | Third event type invents a third shape | Document per-type schemas in `src/types/events.ts`; validate at `insertEvents` |
| P1 | Reliability | `runActiveProbeCycle` fan-out | No per-call timeout/deadline/breaker; serial await over ≤30 paid calls | One hung provider stalls the cycle while spend accrues | `AbortSignal.timeout` per call + overall deadline + skip-and-record (mirror R8 pattern) |
| P1 | Modularity | Route guards (×6 S routes) | Throttle + size-guard copy-pasted identically per route | Seventh route drifts (wrong order, missing guard) | Extract `withPublicGuards(handler, {maxBytes})` wrapper; org-scan keeps its session variant |
| P2 | Testing | E2E + coverage + parallelism | No browser tests, no gates, ~200s serial | Regressions reach users; CI grows per round | Playwright smoke (compliance section, MTEB table, estimator, collecting-state); isolated per-file workers; coverage thresholds on `src/lib` |
| P2 | Observability | S-spec usage metrics | CTR/completion/maturity signals have no sink | Cannot sunset misses; gates stay opinion | Lightweight metric events + monthly threshold review per S-item |
| P2 | Ops | S10 gate | Doc exists, no vote scheduled | Held item unholds under pressure | Schedule ADR-010-pattern vote; default stays HELD |

### Before/After: P0 probe spend ledger (the remaining P0, H3 was safety)

```ts
// TODAY (post-H3): safe per call, but blind in aggregate
const res = await runActiveProbeCycle({ modelIds, generateFn });
// res.errors + res.calls_skipped_over_budget exist — nobody persists them

// AFTER: every cycle leaves an accounting trail; scheduling is gated
if (process.env.ACTIVE_PROBE_ENABLED !== 'true') return { status: 'disabled' };
const res = await runActiveProbeCycle({ modelIds, generateFn });
await recordProbeSpend({ cycle_id: runId, calls: res.calls_made,
  errors: res.errors, est_tokens: estimate(res.samples), at: now() });
// nightly: SUM per provider vs budget → page before invoice day
```

### Before/After: P1 shared route guards (extract before the 7th route)

```ts
// TODAY: identical two-line open across 5 public S routes (+ session variant)
const auth = await validatePublicApiRequest(request);
if (!auth.allowed && auth.errorResponse) return auth.errorResponse;
const tooLarge = assertPayloadSize(request, 256 * 1024);
if (tooLarge) return tooLarge;

// AFTER: one wrapper, guards can't drift
export const sRoute = (handler, { maxBytes } = {}) => async (req: NextRequest) => {
  const auth = await validatePublicApiRequest(req);
  if (!auth.allowed && auth.errorResponse) return auth.errorResponse;
  if (maxBytes) { const tl = assertPayloadSize(req, maxBytes); if (tl) return tl; }
  return handler(req);
};
export const POST = sRoute(computeEstimate, { maxBytes: 256 * 1024 });
```

## 4. Optimization & Enhancement Recommendations

### Performance & Scalability
- **Push S1 predicates to SQL.** Deprecations pulls 5000 events then pairs
   in Node — add `event_type IN (...)` + provider pushdown (the
   `catalog.ts:106-162` template) and a composite `(event_type,
   detected_at)` index before announcement ingestion goes weekly.
- **Retire `getLatestSnapshotsMap` full scans** from detail/health/
   arbitrage/probe reads (unchanged hottest path).
- **Deadline the probe fan-out** (§3 P1): per-call timeout + cycle budget
   with skip-and-record, mirroring the R8 recommendation.
- **Cache slow-stable S reads**: compliance/embeddings/finetune/battery
   metadata change on curation cadence — `ETag`/`max-age` on the GETs;
   keep money/decision POSTs uncached and `no-store` where sensitive.
- **Pool defensively** (unchanged): timeouts landed; graceful shutdown on
   remaining paths; PgBouncer before traffic steps.

### Developer Experience (DX) & Tooling
- **Fix test isolation structurally** (§3 P0): namespaces + setup reset +
   git-ignored worker files + CI committed-file assertion. The tolerant
   price-history assertion can then be re-tightened to positional.
- **Typing ratchet.** `tsc` clean + 0-error eslint holds; add a scheduled
   `any`-count check so S-round pragmatics don't normalize new ones.
- **Guard wrapper** (§3 P1) so the next route can't forget throttle order
   (auth before parse — the org-scan 401-before-413 pin proves order matters).
- **S1 ingestion worker.** The only S-item still manual: changelog/RSS poll
   reusing the ingestion-source pattern, emitting via
   `buildDeprecationAnnouncementEvent`.
- **Seed curation tooling.** Per-dataset `verify:sources` ages with owner
   paging — compliance/finetune on shorter fuses than arena scores.

### Security & Hardening Quick-Wins
- **Done and must be preserved:** H1 throttling on all 5 public S routes,
   H2 pre-parse caps (auth-before-parse ordering on org-scan), H3
   no-outage-as-drift, S6/S8 422-instead-of-guess, S3 `no-store`
   session-only, S2 session-auth + 10/min + audit log, SSRF guards,
   constant-time compares, tier vocabulary at every boundary.
- **Remaining cheap items:** `ACTIVE_PROBE_ENABLED` kill switch (even
   before the ledger — a boolean today beats accounting tomorrow);
   implement the advertised org-scan purge endpoint; one `PROBE_*` key
   rotation drill to prove the SECRETS.md procedure; scoped moderation
   secret if S2 ever grows a review queue.

## 5. Future Engineering & Feature Roadmap

### Phase 1: Stabilization & Hardening (Short-Term: Weeks 1–4)
- [x] H1 throttling on all public S routes (shipped in audit)
- [x] H2 pre-parse payload caps (shipped in audit)
- [x] H3 probe per-call failure isolation (shipped in audit)
- [ ] P0 probe spend ledger + kill switch + spend alert
- [ ] P0 test isolation (namespaces + reset + git-ignore + CI assertion)
- [ ] P0 S2 dedicated review + purge endpoint + uninstall proof
- [ ] P1 S1 changelog/RSS poll worker (first real pairs accumulate)
- [ ] P1 `withPublicGuards()` extraction; `new_value` schema registry
- [ ] P1 per-dataset verify ages + named owners
- [ ] S-spec usage-threshold first review (CTR, completions, MTEB views,
   pair count, optimizer completions, codegen votes)
- Exit criteria: ledger + kill switch live; suite green from empty state
   twice running; S2 review signed; re-tightened positional assertions

### Phase 2: Architectural Scaling & Performance (Medium-Term: Month 2–3)
- [ ] Single-vs-dual-backend ADR with flake counts + CI minutes (§6 ADR-5)
- [ ] Probe scheduling on cron infra (`CRON_SECRET`, overlap locks,
   timeouts, cycle metrics in routing-stats style)
- [ ] Deprecation read-path pushdown + `(event_type, detected_at)` index
- [ ] Coverage thresholds on `src/lib`; isolated per-file workers; k6 paging
- [ ] Retention: deprecation display window + org-scan result TTL
- Exit criteria: suite time down or isolated; probe spend on a dashboard;
   pages fire before users notice

### Phase 3: Next-Generation Feature Expansion (Long-Term: Month 4–6+)

| Feature | Business / Technical Value | Complexity | Architectural Prerequisites |
|---|---|---|---|
| S10 go/no-go vote | Unlocks pricing intel or kills it cleanly | Low (decision) / High (build) | ADR-010-pattern sign-off; threshold + bounds (`docs/S10_LIMITATIONS.md` §3) |
| S1 maturity promotion | First trust-moat signal ("provider X gives N days notice") | Low | 10+ real pairs via Phase-1 worker; collecting UI already built |
| S4 drift review queue | Turns diffs into human decisions | Med | Scheduled cycles + ledger; reviewer role; no-auto-verdict preserved |
| S5 latency as comparator sort | "Fast + cheap + good" in one view | Low | Cycle history; scope-note rendering in comparator |
| S2 GitHub App pilot | Org-level acquisition motion | High | P0 review signed; manifest; allowlist + uninstall proof |
| OAuth billing connections (R5 stretch) | Removes CSV friction; habit imports | High | Token-storage audit (unchanged) |
| Multi-source consensus pricing | Data moat + single-source resilience | High | Reviewed connectors; weighted-merge ADR; breakers (shipped) |
| Public API v2 + usage tiers | Developer acquisition; monetized S surfaces | Med | Legacy freeze; quotas (shipped); S-route quota mapping |
| Unified anomaly + drift signals | One event-cited signal surface | Low | Drift queue shares display contract (diffs + citations, no scores) |

## 6. Technical Decision Log (ADR Recommendations)

**ADR-5: Single-backend or contract-tested dual-backend — decide with
numbers.** The JSON backend's file-shared semantics caused the only
suite failure in two rounds; tolerance now masks the next one. Either
(a) per-file isolated backends with a setup contract, or (b) JSON as
seeded-fixture mode with Docker Postgres required for dev/CI. Inputs:
flake count over 30 days, dual-run CI minutes, contributor friction.
Each feature round widens the blast radius.

**ADR-9: Active-probe cost accounting.** Ledger schema (cycle, model,
calls, errors, est. tokens, provider), budget source of truth (env vs
table), kill-switch semantics, paging thresholds, provider-cap ownership.
H3 made cycles safe; this ADR makes them accountable. Decide before the
first scheduled cycle — the code is ready, the account is not.

**ADR-10 (S10): Enterprise-pricing go/no-go.** Pre-framed in
`docs/S10_LIMITATIONS.md`: legal sign-off, disclaimer copy, threshold
(≥5 orgs), bounds + reviewer role. Default HELD; shipping without the
vote repeats R10's anti-pattern.

**ADR-6 (carried): Sync crons vs async workers.** Digest, probes, and
active-probe cycles run request-scoped under serverless ceilings. Options
unchanged (cursors + overlap locks vs queue vs off-Vercel jobs). Trigger:
any cycle past 50% of its interval or first overlap — instrument
durations now, including probe cycles.
