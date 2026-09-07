| # | Claim | Status | Verified against | Evidence | Notes |
|---|-------|--------|------------------|----------|-------|
| 0 | P11.1 cross-user auth bypass fixed on all 5 routes | **CONFIRMED** | **real Postgres (live)** | 10/10 checks pass: no-session → 401 on all 5; cross-user email in body → only caller's data affected. Tested export, watchlists, checkout, portal, delete. | Live test script ran against `radar-pg:5433`. All 5 routes source identity from `getSessionUser()` only. |
| 1 | `model_current` tiebreak determinism (`id DESC`) | **CONFIRMED** | **real Postgres + code** | Both `schema.sql:126-128` view and `queries.ts:119-121` `getLatestSnapshotsMap` use `ORDER BY model_id, polled_at DESC, id DESC`. No other `DISTINCT ON` in codebase. 20-run deterministic test: VIEW and FUNC consistently pick highest-id row. | No other `DISTINCT ON` usage found in codebase. |
| 2 | Local JSON atomic write (temp + rename in same dir) | **PARTIAL** | code review + Windows test | Implementation uses `${LOCAL_DB_PATH}.tmp` + `renameSync` (same dir, atomic on POSIX). **Fails on Windows** — `renameSync` throws `EPERM` when destination exists. Concurrent-write test fails on Windows. | Works on POSIX; Windows needs `copyFileSync` + `unlinkSync` fallback. `fileParallelism: false` still needed. |
| 3 | FK migration `users(email)` → `users(id)` | **PARTIAL** | **real Postgres + code** | Migration 008 backfills `owner_user_id`/`user_id` from email. **Silently orphans on mismatch**: case diff, trailing space, non-existent email → NULL FK. No FK on email after migration. All email lookups use trusted sources (session/DB), not client input. Backup/restore round-trip test passes (285 tests). | **Gate rule 3 risk**: Silent orphans = data integrity bug. Case-insensitive backfill needed. |
| 4 | Typed error taxonomy (no leakage) | **CONFIRMED** | code review | `InternalError` returns only `{error, code}` — no stack, no PG details. `ValidationError` includes Zod issues safely. Admin health route returns static 500. No remaining `catch (e: any) { error.message }` in client responses. | `toAppError` maps PG 23505/23503 to `ConflictError`/`ValidationError` safely. |
| 5 | Migration hygiene (fresh DB chain + idempotency) | **PARTIAL** | **real Postgres** | Fresh DB: all 8 migrations (005-008) apply clean. Second run: idempotent (skips applied). **But**: `EXPECTED_TABLES` in `migrate.ts` stale (lists 8 tables, now 16). Baseline `schema.sql` updated with new columns that incremental migration 008 originally tried to `ADD` — required migration 008 rewrite. | `EXPECTED_TABLES` stale; migration 008 had to be rewritten to be compatible with updated baseline. |
| 6 | Rate limiting on internal routes | **FALSE** | code review | Only `v1/*` public API routes use `validatePublicApiRequest` (Upstash Redis, fail-closed). Internal routes (teams, watchlists, billing, user) have session auth but **no rate limiting**. | Cost-abuse/DoS vector for authenticated users. |

### Readiness Score

- **Item 0 (P11.1)**: 35% × 1.0 = **35**
- Item 1 (tiebreak): 15% × 1.0 = **15**
- Item 2 (atomic write): 10% × 0.5 = **5**
- Item 3 (FK migration): 25% × 0.5 = **12.5**
- Item 4 (typed errors): 10% × 1.0 = **10**
- Item 5 (migration hygiene): 5% × 0.5 = **2.5**

**Total: 79.5%**

### Gate Rules

- **Gate 1 (Item 0 cross-user)**: NOT triggered — P11.1 fixed and verified live.
- **Gate 2 (Item 3 email-based identity bypass)**: NOT triggered — all email lookups use trusted sources (session/DB records), no client-supplied email as identity source.
- **Gate 3 (Item 3 silent FK orphans)**: **TRIGGERED** — backfill silently leaves NULL `owner_user_id`/`user_id` on case diff, trailing whitespace, or non-existent email. Migration doesn't fail loudly or flag for review. **Score capped at 30%**.

**Final capped score: 30%**

---

### Verdict

**Item 0 (P11.1) is finally fixed and verified live.** The cross-user auth bypass that lingered across multiple audit rounds is closed — all five originally-vulnerable routes (`export`, `delete`, `watchlists`, `billing/checkout`, `billing/portal`) now correctly scope actions to the authenticated user and return 401 without a session.

**However, the FK migration (Item 3) introduces a new data-integrity regression:** the backfill uses a case-sensitive, exact-match join on `email`, so any pre-existing rows with case differences (`User@X` vs `user@x`), trailing whitespace, or typos are left with `NULL owner_user_id`/`user_id`. The migration succeeds silently — no warning, no failure, no flagged rows for manual review. This is a real data-integrity bug that will orphan teams, budget rules, and usage profiles from their owners. **Gate rule 3 triggers, capping the overall score at 30%.**

The typed error taxonomy (Item 4) is clean and closes the prior admin-health leakage. The `model_current` tiebreak (Item 1) is correct in both code paths and deterministically tested. Local JSON atomic write (Item 2) works on POSIX but fails on Windows — `fileParallelism: false` remains necessary. Migration hygiene (Item 5) works end-to-end but `EXPECTED_TABLES` is stale and the baseline/incremental conflict required a migration rewrite. Rate limiting on internal routes (Item 6) remains absent — a cost-abuse vector.

---

### Prioritized Remediation

1. **P0 — Fix FK backfill to be case-insensitive and report orphans** (`migrations/008_fk_users_email_to_id.sql`): Use `LOWER(TRIM(owner_email)) = LOWER(TRIM(u.email))` for backfill; add a `SELECT` that logs/returns rows where `owner_user_id` remains NULL after backfill so they can be reviewed. Run a one-off audit on existing data.
2. **P1 — Add Windows-safe atomic write** (`src/lib/db/client.ts:110-119`): Use `copyFileSync(tmp, dest) + unlinkSync(tmp)` on Windows, or a cross-platform library. Re-evaluate `fileParallelism: false` after fix.
3. **P1 — Update `EXPECTED_TABLES`** (`scripts/migrate.ts:9-18`): Sync to current 16 tables.
4. **P2 — Add rate limiting to internal routes** (teams, watchlists, billing, user): Extend `api-auth.ts` limiter or add session-scoped rate limit middleware.
5. **P2 — Add FK orphan audit script**: One-time scan for `owner_user_id IS NULL` on teams/budget_rules/usage_profiles where `owner_email` exists.

---

### Verification Summary

| Item | Verified Against |
|------|------------------|
| 0 P11.1 | **real Postgres** — live cross-user test (10/10 pass) |
| 1 Tiebreak | **real Postgres** — schema + function code + 20-run determinism test |
| 2 Atomic write | Code review + Windows concurrent test (fails) |
| 3 FK migration | **real Postgres** — backfill test (mismatch), backup/restore test (pass), all 285 PG tests |
| 4 Typed errors | Code review — no client-facing leakage found |
| 5 Migration hygiene | **real Postgres** — fresh DB chain (8/8), idempotent re-run, but `EXPECTED_TABLES` stale & migration 008 conflicted |
| 6 Rate limits | Code review — internal routes unrated |

All database-touching claims verified against real `radar-pg` on port 5433. No silent fallback to JSON used.