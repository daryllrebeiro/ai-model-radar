# R9 — Connector submission & review process

The event-sourced history (`model_snapshots` → `model_events`) is the product
moat. Anything that writes into it is a trust-boundary decision, not just code.
This document is the process gate every new ingestion source passes through.

## What a submission must contain

1. **One module** under `src/lib/ingestion/<key>.ts` implementing the
   `SourceConnector` interface (`src/lib/ingestion/connectors.ts`):
   `key`, `displayName`, `fetchRaw`, and a pure `normalize` mapping.
2. **Strict output**: `normalize` returns ONLY `ConnectorRecord` fields
   (`model_id`, `name`, `provider`, `price_prompt`, `price_completion`,
   `context_length`, `modality`). Unknown values are `null` — never `0`
   (zero means *free*, a factual claim needing evidence), never guessed
   from names or descriptions.
3. **Registry entry** in `CONNECTOR_REGISTRY` with `review.status` starting
   at `'example-pending-review'`. Only reviewers flip it to `'reviewed'`.
4. **Tests**: mapping fixtures (including hostile ones — missing ids,
   string prices, absurd context lengths) proving the schema rejects garbage.
5. **Maintenance statement**: who keeps it working when the upstream changes,
   and what happens when they stop (connector is removed, not left rotting —
   an abandoned connector is a liability, not a win).

## Review bar (reviewers check all of these)

- [ ] Every emitted field has upstream evidence (field-level, not vibes).
- [ ] Failure modes are throw-and-isolate (one slow source never stalls a run).
- [ ] No credentials required for the initial version (authed upstreams are a
      separate secrets-handling decision).
- [ ] Bounded output (cap respected), no unbounded pagination.
- [ ] No PII in `raw_json` beyond what the public listing already exposes.

## What is explicitly NOT granted by a merge

- **No automatic polling.** Merged connectors run only via explicit,
  human-operated invocation AND a `CONNECTORS_ALLOWLIST` entry. The hourly
  poll cron stays fixed-source.
- **No history writes.** `runConnector()` returns validated snapshots; it
  does not persist. Persistence is a separate, reviewed step.
- **No runtime plugin loading.** There is no marketplace, no dynamic import
  of third-party code, no config-driven code execution. A connector ships
  only as reviewed source in this repo.

## Removal

A connector that breaks twice without a maintainer fix, or whose upstream
kills the listing endpoint, is removed in a normal PR. The history it already
contributed stays (append-only); no backfill rewriting, ever.
