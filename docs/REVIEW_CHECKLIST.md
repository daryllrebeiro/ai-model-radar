# Code Review Checklist (5 lines — each prevents a repeat finding)

Pasted from three audit rounds. Every PR touching `src/` answers all five;
a "no" is a request-changes vote, not a nit.

1. **New suites use `ns()` ids and self-sufficient seeds** — no positional
   reads on shared ids, no dependence on another file's rows (AUDIT-S flake
   class; ADR-012).
2. **New routes open via `withPublicGuards()` (or the session variant)** —
   never a bare handler on a public path, auth before parse, cap before
   `request.json()` (H1/H2).
3. **Route files export handlers + config only** — helpers live in lib
   (`next build` rejects anything else; P2-2 lesson in `probe-overlap.ts`).
4. **New event types get a `EVENT_NEW_VALUE_SCHEMAS` entry + `insertEvents`
   enforcement** — no third undocumented JSONB shape (P1-5).
5. **New tables get all six touches** — `schema.sql` + migration +
   `TABLE_MANIFEST` + `LocalDbState` (interface, empty, hydrate) + barrel
   export; the drift-guard test proves it (`table-manifest.test.ts`).
