# ADR-011 — Connection Pooling (PgBouncer / Managed Pooler)

**Status:** EVALUATED — no pooler yet. **Date:** 2026-09-11. **Owner:** backend.

## Context

Postgres pool is process-global per serverless instance (`max: 10`,
5s acquire timeout, 15s statement timeout — `src/lib/db/client.ts:28-34`).
Under Vercel burst cold-starts, N warm instances × 10 connections can
exhaust a small Postgres `max_connections`. No exhaustion has been
observed; pool-gauge metrics do not exist yet, so this decision is
conservative by necessity, not by data.

## Decision

Defer a pooler. Revisit when ANY trigger fires:

1. **Observed pressure:** `pg_stat_activity` peak backend count ≥ 70% of
   `max_connections` sustained over any 1h window, or any
   `connectionTimeoutMillis` (5s acquire) timeout in production logs.
2. **Scale event:** traffic step-change (launch, R10 pilot expansion past
   25 users, or digest recipient growth past the 500/tick cap twice in a
   month).
3. **First incident:** any cold-start connection-exhaustion 5xx.

## Options (pre-evaluated, in preference order)

1. **Managed pooler first** (Supabase pooler / Neon pooled endpoint /
   Vercel Postgres pooling): zero new infrastructure, transaction mode,
   no code change beyond `DATABASE_URL`. Default choice when triggered.
2. **Self-hosted PgBouncer**: only if the managed pooler proves
   incompatible (e.g., prepared-statement or `LISTEN` needs — neither
   used today; all queries are parameterized simple-protocol compatible).
3. **Per-instance `max` tuning + graceful shutdown**: already partially
   done (timeouts + `closePool` wiring); the stopgap if a pooler cannot
   ship fast during an incident — NOT the steady state.

## Consequences

- Until triggered, the highest-value pooling work is observability, not
  infrastructure: add a pool-gauge (total/idle/waiting) to logs or
  `/admin/health` so trigger #1 is measurable instead of anecdotal.
- `statement_timeout: 15000` stays as the backstop against a wedged
  holder pinning an instance regardless of pooler choice.
