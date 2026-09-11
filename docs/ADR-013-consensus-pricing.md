# ADR-013 — Multi-Source Consensus Pricing (PROPOSED)

**Status: PROPOSED 2026-09-11. No code. Decision needed before any merge
engine is built.** Prerequisites from the plan: reviewed connectors running
(R9 ops — connector exists, unwired to cron), source-weighted merge design
(this doc), per-source breakers (SHIPPED: `src/lib/ingestion/circuit.ts`,
3-strikes/5min/half-open, wired into the OpenRouter path).

## Context

Today the catalog reconciles a single live source (OpenRouter) against
curated statics. A second live source makes single-source outages survivable
and provider-vs-provider price disagreement visible — the data moat the
roadmap names. Without a merge rule, two sources means two truths.

## Proposed merge rule (for the decision)

1. **Per-source normalization first:** each connector outputs the canonical
   snapshot shape via its pure `normalize` (R9 pattern) — no source writes
   events directly, ever (audit-proven invariant preserved).
2. **Weighted median per (model, price-field):** weights from trailing-30d
   source reliability (successful polls / attempts, from `ingestion_runs`).
   New sources start at weight 0.5, capped below the incumbent until 30
   clean days.
3. **Disagreement signal, not silent pick:** spread > 5% emits a
   `PRICE_SOURCE_DIVERGED` observation (candidate for the signals surface),
   records both values, and keeps serving the incumbent-weighted median.
4. **Per-source isolation:** existing circuit breakers stay per-source; a
   tripped source contributes weight 0 until half-open succeeds.
5. **Provenance forever:** every snapshot keeps `raw_json.source`; the
   comparator shows which sources agreed (count, not a confidence score).

## Rejected

- **Simple mean:** gameable by one outlier source; median is robust.
- **First-writer-wins:** silently prefers whoever polls first — the exact
  silent-substitution class R10's gateway rules forbid.
- **Manual curation of conflicts:** doesn't scale past two sources.

## Decision needed

Ratify / amend / reject the weighted-median rule + divergence threshold,
 then authorize the merge-engine build (est. M, behind the R9 review gate
 for each new connector).
