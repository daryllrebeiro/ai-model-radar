# Usage-Threshold First Review (P1-7) — 2026-09-11

Every S-item shipped with a defined success metric "before building, not a
checkbox after." This is the first consumption review. Verdict basis:
production telemetry does not exist yet (features unshipped, no dashboard
sink — P2 observability item), so all usage figures are 0 by construction.
Data-maturity gates (S1 pairs, ledger rows, changelog runs) are measurable
in-code and recorded below.

## Per-item rulings

| Item | Success metric (spec) | Current reading | Ruling |
|---|---|---|---|
| S7 compliance filters | Filter usage on compliance attributes | 0 (unshipped, no sink) | HOLD — needs dashboard sink (P2), then 30d of traffic |
| S9 embeddings lane | Embedding vs chat page/comparator usage | 0 (unshipped, no sink) | HOLD — same sink dependency |
| S1 deprecation | 10+ real pairs before promotion | 0 pairs (worker lands this round, first runs pending) | COLLECTING — re-review after 4 weekly poll runs |
| S6 estimator | Completion rate; acted-on signal | 0 (unshipped) | HOLD — completion logging must be added with the UI |
| S4+S5 probing | Latency as sort dimension; cycle health | 0 cycles (no scheduler yet) | COLLECTING — re-review after P2-2 runs 4 cycles |
| S3 optimizer | Completion; applied-suggestion signal | 0 (unshipped) | HOLD — needs applied-vote signal in UI |
| S2 org scan | Install→scan conversion; repeat scans | 0 (review-gated, no pilot) | GATED — re-review after pilot (needs sign-off first) |
| S8 codegen | Completion; correctness votes | 0 (unshipped) | HOLD — needs thumbs signal in UI |
| S10 | Threshold reachability | N/A (HELD, no code) | HELD — vote first |

## Instrumentation debt created (do before second review)

1. No event sink exists for any S success metric — second review cannot
   happen without one (P2 observability: lightweight metric events).
2. S6/S3/S8 need in-UI completion/vote signals (button + counter table).
3. S1/S4 maturity counters already exist in-band (pair count on
   `/api/v1/deprecations`; cycle errors/skips in `DriftCycleResult`) —
   these two are review-ready without new sinks.

## Next review

After P2-2 has run 4 probe cycles AND the P1-4 worker has run 4 weekly
polls, or 30 days post-launch of the first S surface — whichever is later.
Sunset rule reaffirmed: an item missing its threshold at second review is
a sunset candidate, not a permanent fixture.
