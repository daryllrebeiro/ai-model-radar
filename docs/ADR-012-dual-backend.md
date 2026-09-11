# ADR-012 — Dual-Backend Test Strategy (decides ADR-5)

**Status: DECIDED 2026-09-11. Decision: Option A — per-file isolated backends
with a setup contract. JSON backend RETAINED (not demoted).**

## Context

`src/lib/db/client.ts` serves two backends: real Postgres and a file-backed
JSON store (`.radar-data.json`, per-worker `.radar-data-worker-*.json`).
Every query ships both branches; every suite runs (at least) the local mode.
The S-round grew the suite to 98 files / ~560 tests at ~200s wall-time.

## Evidence (measured, not asserted)

1. **One proven cross-test pollution failure in two rounds:**
   `tests/price-history.test.ts` read another suite's `MODEL_REMOVED` rows
   from a shared worker file (timestamps matching the session's own runs).
   Root cause class: file-shared mutable store with no reset contract.
2. **Blast radius grows per feature round:** +8 files in the S-round alone;
   each ingestion-touching suite is a future flake factory without isolation.
3. **Dual-run CI cost is linear but tolerable:** local full run ~200s;
   Postgres targeted re-runs green. Demoting JSON would force Docker
   Postgres for every contributor edit — measured friction against
   unmeasured purity.

## Decision

**Option A: keep both backends; isolate by contract.**

- `tests/helpers.ts`: `ns(file)` id-namespacing + `resetLocalBackend()`
  (local-only; Postgres untouched). LANDED (P1-2).
- Worker JSON files stay gitignored (already: `.gitignore:34-36`).
- CI asserts no committed `.radar-data*.json` (P2-4 groundwork item below).
- New suites MUST use `ns()` ids and self-sufficient seeds (no positional
  reads on shared ids). Review checklist item, enforced in code review.
- Postgres remains the parity backend: targeted re-runs on PG before merge
  for any `src/lib/db/` touch.

## Rejected

**Option B (demote JSON to fixtures, require Docker Postgres):** rejected —
contributor friction (Docker for every test run) exceeds the measured pain
(one flake, now guarded). Revisit trigger: 3+ isolation escapes in 90 days
or local full-run wall-time past 10 minutes.

## Consequences

- P2-4 may parallelize workers freely: isolation is contractual, not
  incidental.
- The tolerant price-history assertion is already re-tightened (P1-2 proof
  the contract works).
- Flake counter starts today: next isolation escape reopens this ADR.
