# Next-Phases Implementation Plan (derived from REVIEW_AND_ROADMAP.md + AUDIT_S_FEATURES.md)

> Source of truth for *what to build next, in what order, and what "done"
> means*. Every item traces to a review finding or roadmap phase. S10 stays
> HELD throughout (`docs/S10_LIMITATIONS.md`) — it appears only as a decision,
> never as engineering.
>
> Conventions: each task lists **files**, **tests**, **DoD** (definition of
> done), and **gates** (what it unblocks / what blocks it). Effort in
> focused-engineering days: S ≤ 1, M = 2–3, L = 4–5.

## Sequencing map (gates)

```
P1-1 ledger+kill-switch ─┬─> P2-2 probe scheduling ──> P3 drift queue / latency sort
P1-2 test isolation ─────┼─> P2-4 coverage/parallel ──> (velocity for everything)
P1-3 S2 review+purge ────┴─> P3 S2 pilot
P1-4 S1 poll worker ─────────> P3 S1 maturity promotion (needs 10+ real pairs)
P1-5 guards+registry ────> P2-1 backend ADR (evidence input)
P1-6 verify ages ────────> ongoing curation cadence
P1-7 usage review ───────> sunset/promote decisions per S-item
S10 vote ────────────────> (only then) S10 engineering estimate
```

No Phase 2 scheduling work starts before P1-1 (ledger) is live — scheduling
paid calls without accounting repeats the exact failure the ledger exists to
prevent. No S2 pilot before P1-3 review sign-off. No S10 engineering before
the vote. Everything else parallelizes.

---

## Phase 1 — Stabilization & Hardening (Weeks 1–4)

### P1-1 Probe spend ledger + kill switch [P0, M]

**Why:** H3 made cycles fail-safe; nothing makes them accountable. First
scheduled paid call without this is invoice-driven discovery.

- **Files:**
  - `src/lib/db/schema.sql` — `probe_spend_ledger` (cycle_id, model_id, calls, errors, est_tokens, provider, created_at) + index on `(created_at)`.
  - `migrations/027_probe_spend_ledger.sql` — new table (forward-only, idempotent).
  - `src/lib/db/tables.ts` — manifest entry (kills the N-touch tax at birth).
  - `src/lib/active-probe.ts` — `recordProbeSpend()` writer + `ACTIVE_PROBE_ENABLED` gate helper.
  - `src/app/api/cron/probes/route.ts` — gate scheduled trigger on the kill switch (fail-closed when unset).
  - `scripts/` or cron docs — nightly rollup query (SUM per provider vs budget).
- **Tests:** `tests/probe-spend.test.ts` — ledger write/read both backends; kill-switch off blocks trigger; rollup math on fixtures.
- **DoD:** cycle writes ledger rows in local + Postgres runs; trigger returns `disabled` without env; suite green; `migrate:status` clean.
- **Gates:** unblocks P2-2 (scheduling), P3 drift queue + latency sort.

### P1-2 Test isolation [P0, M]

**Why:** the only suite failure in two rounds; tolerance now masks the next one.

- **Files:**
  - `tests/helpers.ts` — `resetLocalBackend()` (clears `snapshots`/`events` keys) + `ns(file)` model-id namespacing helper.
  - `tests/price-history.test.ts` — re-tighten to positional assertion once isolation holds.
  - `.gitignore` — confirm ` .radar-data*.json` ignored; CI step asserting no committed worker files.
  - `vitest.config.ts` / CI workflow — per-file setup calling reset (or documented namespace rule).
- **Tests:** the existing suite IS the test — full run green from empty state twice consecutively, plus a new `tests/backend-isolation.test.ts` proving cross-file residue is impossible (seed in one file scope, assert absent in another).
- **DoD:** two consecutive full-suite greens from deleted worker files; price-history positional again; no test depends on run order.
- **Gates:** unblocks P2-4 (parallel workers need isolation first).

### P1-3 S2 ship-gates [P0, S–M]

**Why:** code-complete ≠ shippable for the broadest permission grant.

- **Files:**
  - `src/app/api/v1/org-scan/route.ts` — implement advertised `DELETE` purge (org-scoped result deletion).
  - `docs/ORG_SCAN_REVIEW.md` (new) — App manifest (`contents:read` only), data policy, retention window, uninstall-revocation procedure + verification log.
  - `tests/org-scan-purge.test.ts` — purge deletes scope, leaves other orgs intact, unauthenticated purge 401s.
- **Tests:** purge suite + re-run of `audit-s-hardening` H2 block.
- **DoD:** review doc signed (named reviewer + date); purge green both backends; uninstall procedure executed once against a test org and logged.
- **Gates:** unblocks P3 S2 pilot. Non-negotiable order: review BEFORE pilot users.

### P1-4 S1 changelog/RSS poll worker [P1, M]

**Why:** the only S-item still manual; maturity gate needs 10+ real pairs and zero exist.

- **Files:**
  - `src/lib/ingestion/deprecation-changelog.ts` — provider changelog/RSS fetcher reusing the ingestion-source pattern (poll → diff → `ingestion_runs` rows), emitting via `buildDeprecationAnnouncementEvent` (real URLs only, no inference).
  - `src/app/api/cron/poll/route.ts` (or new `cron/deprecations`) — wire worker behind `CRON_SECRET`.
  - `vercel.json` — schedule (weekly is plenty; announcements are rare).
- **Tests:** `tests/s1-poll.test.ts` — fixture changelog HTML/RSS → sourced events; non-announcement pages → zero events; idempotent re-poll (no dupes).
- **DoD:** worker runs on schedule in staging; first real `DEPRECATION_ANNOUNCED` rows accumulate; pair counter visible on `/api/v1/deprecations`.
- **Gates:** unblocks P3 S1 promotion (gate counts real pairs only).

### P1-5 Guard wrapper + event schema registry [P1, S]

**Why:** 6 routes share an identical guard preamble by copy-paste; `new_value` has two undocumented shapes.

- **Files:**
  - `src/lib/api-auth.ts` (or new `src/lib/route-guards.ts`) — `withPublicGuards(handler, {maxBytes})`; migrate the 5 public S routes; org-scan keeps its session variant.
  - `src/types/events.ts` — per-type `new_value` schema docs; `src/lib/db/ingestion.ts` — `insertEvents` validates shape per `event_type`.
- **Tests:** extend `audit-s-hardening` — wrapper preserves 429/413/400 ordering; invalid `new_value` shape rejected at insert.
- **DoD:** all S routes call the wrapper (grep: zero bare `validatePublicApiRequest` + `assertPayloadSize` pairs outside it); suite green.
- **Gates:** feeds P2-1 ADR (guardrails evidence).

### P1-6 Curation ownership + verify ages [P1, S]

**Why:** 7 hand-maintained datasets, one proven rot incident, regulatory stakes on S7.

- **Files:** `scripts/verify-sources.ts` (per-dataset `SOURCE_MAX_AGE_DAYS`: compliance/finetune ≤180d, benchmarks/capabilities/licenses ≤365d), header comments naming owner per dataset file, CI nightly paging (not just pass/fail).
- **Tests:** `source-verify` suite extended with per-dataset age policy cases.
- **DoD:** nightly run pages owner on stale/failing record; RACI comment on all 7 files.
- **Gates:** ongoing cadence, no downstream blocker.

### P1-7 Usage-threshold first review [P2-process, S]

**Why:** every S-item defined success metrics; none are consumed.

- **Files:** none (process) — checklist in this doc §"Threshold review".
- **DoD:** one review session held; each S-item marked promote/hold/sunset with numbers (compliance CTR, estimator completions, MTEB views, pair count, optimizer completions, codegen votes, probe status hits).
- **Gates:** informs P3 promotion decisions (S1, latency sort, drift queue).

**Phase 1 exit criteria:** ledger + kill switch live; suite green twice from empty state; S2 review signed; S1 worker accumulating; wrapper + registry landed; verify ages paging; threshold review held.

---

## Phase 2 — Architectural Scaling & Performance (Months 2–3)

### P2-1 Backend ADR-5 with numbers [P1-process, S]

Collect 30-day flake counts + dual-run CI minutes + contributor setup friction; decide per-file isolation vs JSON-as-fixture. Input from P1-2/P1-5. Owner: staff. Output: ADR file + migration tasks (which become P2-4 work).

### P2-2 Probe scheduling [P1, M]

Cron-gated cycles (`CRON_SECRET`, overlap locks, per-call `AbortSignal.timeout` + cycle deadline, skip-and-record), cycle metrics in routing-stats style. Requires P1-1 ledger live. Tests: scheduler honors kill switch, overlap, timeout accounting.

### P2-3 Deprecation read pushdown [P2, S]

SQL-side `event_type IN (...)` + provider predicates; composite `(event_type, detected_at)` index. Trigger: pair volume from P1-4 worker or p95 breach. Tests: query-shape test + seeded-volume benchmark note.

### P2-4 Coverage + parallelism [P2, M]

`@vitest/coverage-v8` thresholds on `src/lib`; per-file workers with isolated backends (requires P1-2); k6 nightly paging. Target: halve ~200s wall-time.

### P2-5 Retention policies [P2, S]

Deprecation display window; org-scan result TTL (default + purge path from P1-3); `probe_spend_ledger` rollup-then-prune (raw 90d, rollups forever). Privacy review rides along for scan/financial rows.

**Phase 2 exit criteria:** ADR-5 decided; scheduled probe cycles metered and paged; suite fast or isolated; retention jobs green.

---

## Phase 3 — Next-Generation Expansion (Months 4–6+)

| # | Feature | Value | Complexity | Prerequisites | DoD |
|---|---|---|---|---|---|
| 3-1 | S10 vote | Unlock or cleanly kill pricing intel | S (decision) | ADR-010-pattern sign-off package | Vote recorded; HELD reaffirmed or engineering estimated |
| 3-2 | S1 promotion | First trust-moat signal | S | 10+ real pairs via P1-4 | Promoted UI with sample sizes; threshold review confirms |
| 3-3 | Drift review queue | Human decisions on diffs | M | P2-2 + ledger; reviewer role | Queue UI with before/after evidence; no auto-verdict preserved; SLA on review |
| 3-4 | Latency comparator sort | "Fast+cheap+good" view | S | Cycle history table | Sort/filter dimension + scope notes; usage tracked |
| 3-5 | S2 pilot | Org acquisition | L | P1-3 signed; manifest | Allowlisted pilot orgs; install→scan conversion + repeat-scan metric |
| 3-6 | OAuth billing (R5 stretch) | Remove CSV friction | L | Token-storage audit | Scoped read-only OAuth + revocation UX + own audit |
| 3-7 | Consensus pricing | Data moat | L | Reviewed connectors; merge ADR | Weighted merge live with per-source breakers |
| 3-8 | Public API v2 + tiers | Monetize S surfaces | M | Legacy freeze; S-route quotas | v2 routes + quota mapping + docs |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Scheduled probing spends before ledger | Med | High ($$) | Gate: no P2-2 before P1-1; kill switch defaults OFF |
| Test isolation fix breaks suites relying on residue | Med | Med | Fix reveals hidden coupling — treat each break as a real bug, re-tighten assertions per file |
| S1 worker yields ~0 pairs for months | High | Low | Expected; collecting-state UI already handles it; promotion simply waits |
| S2 review rejects scope | Low | Med | Review package built first (P1-3); pilot scoped down, not forced through |
| S10 pressure to "just build it" | Med | High (legal) | HELD default stands; vote must be scheduled to change it |

## Threshold review checklist (P1-7 input)

- S7: compliance-filter CTR on models/comparator
- S9: embedding-category views vs chat; MTEB table views
- S1: real pair count vs 10-pair gate
- S6: estimator completion rate; acted-on signal if capturable
- S4+S5: status-route hits; cycle success/errors/skips (post-scheduling)
- S3: flow completion; applied-suggestion signal if capturable
- S2: installs → completed scans; repeat-scan rate (post-pilot)
- S8: completion rate; correctness votes
