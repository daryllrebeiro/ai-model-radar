# Public API v2 + Usage Tiers — Plan (P3)

**Status: PLANNED. Shipped in this round: legacy sunset headers (machine-
readable freeze).** Full v2 versioning follows the quota work below.

## Shipped now

- `GET /api/models` (legacy twin) returns `Deprecation: true`,
  `Sunset: <2026-07-01>`, and `Link: </api/v1/models>; rel="successor-version"`
  on every response (ADR-4 freeze, re-affirmed). Pinned by test.

## v2 design (authorized for next build)

1. **Versioning:** `/api/v2/*` mirrors v1 handlers with envelope
   `version: 'v2'`; v1 keeps byte-compat for 12 months post-v2 GA.
2. **Breaking changes batched into v2:** `latency_scope` promotion to a
   first-class field, compliance/embedding fields stable (already additive
   in v1 enrichment — no break), cursor-only pagination (offset
   deprecated but honored).
3. **Usage tiers:** S compute routes (finetune-estimate, prompt-optimize,
   migrate-code) map to key quotas via the existing `validatePublicApiRequest`
   tier budgets (already enforced post-H1); v2 adds per-route monthly caps
   in the quotas response (`GET /api/v1/quotas` gains an `s_routes` section).
4. **Sunset policy:** legacy `/api/*` (non-v1) removed 12 months after v2
   GA; v1 maintained indefinitely for reads, frozen for new fields.

## Test plan (for the v2 build)

- Sunset headers present on every legacy response (SHIPPED + pinned).
- v1/v2 parity suite: same fixtures, same data, envelope version differs.
- Quota mapping: S-route consumption decrements key budget (integration).
