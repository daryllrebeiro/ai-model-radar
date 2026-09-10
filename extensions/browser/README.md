# R1 — Browser extension (Tier A, thin client)

Read-only overlay over the existing public API. No new backend.

- Matches ONLY `allowlist.js` patterns. No browsing-history collection.
- Never rewrites page prices; overlay badge only, dismissible.
- `?utm_source=browser-ext` on the comparator link is the funnel signal.

## Success metric

Extension installs + **overlay→comparator click-through rate**.
Kill rule: CTR ~0 after 30 days → sunset, don't expand.

## Usage threshold (pre-implementation gate)

Ship to stores only after R3/R4 + security gates are green (done).
Measure CTR weekly; no auto-injection of affiliate links ever.
