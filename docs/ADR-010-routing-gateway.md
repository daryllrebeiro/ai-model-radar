# ADR-010 — Inference Routing Gateway (R10): Go/No-Go

**Status:** CONDITIONAL GO (pilot only) — granted by explicit product-owner order
("complete all remaining features R5 to R10", 2026-09-10). This record is the
sign-off the R10 spec requires; it does NOT authorize general availability.

## Why this is a separate category

- Changes the product from "market intelligence" to "market participant" —
  a proxy routing real production LLM calls.
- Competes with the primary data source (OpenRouter) — strategy question,
  answered here as: pilot-only, OpenRouter-compatible upstream by default,
  no undercut positioning until pilot reliability clears the bar.
- Bug blast radius is a customer's live application, not our UI.

## Prerequisites (all met before engineering)

- [x] Security hardening backlog closed and verified both backends
      (P11.1 regression, CORS fallback, cookie wire contract — 12/12 local,
      12/12 Postgres).
- [x] Incident-response plan written: `docs/ROUTING_INCIDENT_PLAN.md`.
- [x] Pilot gating implemented: deny-by-default, allowlist + per-user opt-in.

## Explicit decisions (tested, not accidental)

1. **No silent substitution, ever.** A request carrying `model` and no
   `routing_policy` uses that model verbatim. Substitution happens ONLY with
   an explicit per-request `routing_policy` (`cheapest` | `benchmark` |
   `fallback_chain`). No-model + no-policy → 400 (no default smart routing).
2. **Fail-closed default.** Upstream failure with
   `on_failure: 'fail_closed'` (default) → 502/503, structured error, attempt
   logged. `fail_open_original` is opt-in per request and NEVER substitutes:
   it returns a shape-compatible fallback naming the ORIGINAL model with
   `proxy_fallback: true` — explicit, never silent.
3. **Reliability before usage.** `routing_attempts` logs every decision
   (requested/selected/policy/upstream status/latency/success). The success
   metric is successful-routing rate + added-latency overhead FIRST; usage
   growth counts only after the bar clears (≥99% success, p95 overhead
   < 250ms over 7 pilot days — see incident plan).
4. **Pilot only.** `ROUTING_ENABLED=true` AND caller in
   `ROUTING_PILOT_ALLOWLIST` AND a `routing_pilot_optins` row. Missing any
   → 403/503. No GA path exists in this change.

## Consequences

- Upstream forwarding needs `ROUTING_UPSTREAM_KEY`; without it the endpoint
  answers 503 "no upstream configured" (fail-closed, explicit) — the pilot
  cannot accidentally run unconfigured.
- Spend circuit breaker (existing) still applies first.
