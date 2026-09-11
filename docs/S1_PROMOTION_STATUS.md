# S1 Promotion Status (P3 3-2) — 2026-09-11

**Status: NOT PROMOTED. Collecting-state UI remains the only surface.**

## Gate criteria (from spec + plan)

Promote from "collecting data" to a promoted, linked feature when:
1. ≥ 10 real announcement/removal pairs accumulated across providers
   (sourced `DEPRECATION_ANNOUNCED` + later `MODEL_REMOVED`, no backfill).
2. The P1-4 changelog worker has run ≥ 4 weekly cycles without systematic
   false positives (spot-check emitted events against their source URLs).

## Current reading

| Criterion | Value | Source |
|---|---|---|
| Real pairs | 0 | `GET /api/v1/deprecations` → `total_pairs: 0`, `status: collecting` |
| Worker cycles | 0 | Worker + schedule land this round (`cron/deprecations`, weekly Mondays 09:00); first production run pending |
| False-positive rate | Unknown (fixture-tested only) | `tests/s1-poll.test.ts` 6/6 on stubs |

## Decision

NOT PROMOTED — correctly so. The collecting-state response already says
exactly this ("Collecting data: 0/10… excluded, not backfilled"). No code
changes needed for the gate itself; the worker is the unblocked path to
meeting it.

## Next check

After 4 weekly production poll runs: read `total_pairs`, spot-check up to
10 emitted events against their `source_url`s, then promote (nav link +
comparator trust-signal) or keep collecting. Record the outcome here.
