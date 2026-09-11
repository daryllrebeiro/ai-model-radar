# AUDIT-S-Features — Hardening & Adversarial Audit of S1–S9

**Authorization & scope:** first-party assessment per standing rule. Disposable
test environment (local JSON backend), synthetic test accounts/data only. No
real user data, no live provider keys, no production traffic. S10 is
explicitly out of scope (HELD per `docs/S10_LIMITATIONS.md` — no code exists
to audit). Every finding has exact repro steps. Every no-finding check states
what was tested.

**Auditor method:** static inspection + live functional tests. New regression
coverage landed as `tests/audit-s-hardening.test.ts` (11 tests, all green).
Full S-surface after audit fixes: **9 files / 45 tests green
(S-suites + r3-r4 + source-verify), `tsc` clean, eslint 0 errors.**

---

## 0. Mandatory prerequisite check — PASSED

The S-spec bars new surface on open hardening gaps. Re-verified before Tier
A–F work:

| Check | Evidence | Result |
|---|---|---|
| Phase 2/3 audit closure | FK heal chain 008→009→012→013 + `fk_orphans` queue; session rate limits wired; Windows atomic write; `TABLE_MANIFEST` | Closed (see prior session) |
| S10 gate | `docs/S10_LIMITATIONS.md` HELD, zero S10 code in tree (`git status` shows no pricing-intel files) | Holds |

---

## Findings table (all FIXED during audit)

| ID | Item | Finding | Severity | Exploitability | Repro steps | Fix |
|---|---|---|---|---|---|---|
| H1 | S1/S4+S5/S6/S3/S8 routes | **5 public S routes had zero rate limiting**: `GET /api/v1/deprecations` (reads up to 5000 events), `GET /api/v1/active-probe`, `POST /api/v1/finetune-estimate`, `POST /api/v1/prompt-optimize`, `POST /api/v1/migrate-code` — unbounded anonymous reads + compute | High | Any anonymous client; deprecations fan-out is the most expensive (5000-row read + Node pairing per hit) | `curl` the route in a loop — 0 429s before fix | **FIXED**: `validatePublicApiRequest` gate (anonymous allowed within tier budget, 429 past it) on all five, same pattern as `v1/models`/`health` |
| H2 | S3/S8/S2 bodies | Compute routes parsed full JSON bodies with **no pre-parse size guard** — Next.js parses synchronously, so a multi-MB payload to the tokenizer/codegen path is a cheap DoS; org-scan schema allowed 500 files × 200KB (~100MB) | Medium | Single large POST per route | POST with `content-length: 10MB` — parsed before any check | **FIXED**: `assertPayloadSize` before `request.json()` — 256KB on optimizer/codegen/finetune, 4MB on org-scan (worker must chunk) |
| H3 | S4 cycle | `runActiveProbeCycle` let **one throwing provider abort the entire paid cycle** (`await generateFn` unguarded) — a hang/failure wastes the whole run's budget window and, worse, a naive catch-and-empty would have read outage as drift | Medium | Any provider 500/timeout during a scheduled cycle | `generateFn` that throws — cycle rejects, zero partial results | **FIXED**: per-call try/catch → `errors` counter, errored calls emit NO sample and NO diff (`src/lib/active-probe.ts`); outage can never present as drift |

No other findings. Gate-rule outcomes: **zero cross-user access successes**
(S2 IDOR inherits session-only identity; S3/S8 persist nothing to scope);
**no paid calls reachable from any GET** (status routes are metadata-only);
**no guessed facts** (422s preserved on all unknown-pricing/unknown-pair paths).

---

## Tier A — S7/S9 (sourced data lanes)

- **Unknown-means-unknown — PASS.** `findComplianceForModel('groq/...')` →
  null; unlisted providers excluded from HIPAA/EU filters (never false).
  `classifyModelCategory` defaults `chat`; curated embeddings win by list
  membership. *Residual Low:* the embedding heuristic is substring-based, so
  a hypothetical chat id containing "embed" would misclassify — no tracked
  model hits this; pinned by test as documented behavior.
- **No composite scores — PASS.** Test-asserted absence of `score` /
  `quality_score` / `overall` fields on all four curated sets.
- **Disclaimer strength — PASS.** S7 disclaimer contains "not legal" +
  "verify directly with the provider" (stronger than R4 per spec).
- **Filter injection — PASS.** `hipaa_eligible`/`eu_residency`/`category`
  are zod-enum validated on v1 (garbage → 400); legacy twin treats unknown
  category as `all` (fail-open to full catalog, never to wrong subset).
- **Source-verify — PASS.** Collector covers all 5 datasets; stale-dataset
  test expectation fixed during review (collector was right).

## Tier B — S1/S6 (reports over lightly-extended data)

- **S1 pairing soundness — PASS.** Announcement→later-removal only; removal-
  before-announcement never pairs (no negative notice); one pair per model;
  maturity gate at 10 pairs with `collecting` state and no-backfill note.
- **S1 event plumbing — PASS.** `DEPRECATION_ANNOUNCED` accepted by compound
  `event_type eq` validation (flows through `COMPOUND_EVENT_TYPES`);
  `new_value {source_url, announced_at}` requires a real https URL.
- **S6 quality firewall — PASS.** Disclaimer on every response; 422 (never
  guess) on unknown pricing; negative volumes → 400; zero-volume edge →
  defined math (no NaN/div-zero — breakeven null unless savings > 0).

## Tier C — S4+S5 (active probing)

- **Budget guard — PASS.** Watched-first selection, per-run call cap,
  skipped counter; cycle test pins `calls_made: 4` with skips on a cap-4
  budget.
- **Failure isolation — FOUND & FIXED (H3).** Post-fix: full outage →
  `errors: 3`, zero samples, zero diffs; partial outage → diffs only for
  successful calls, errored model shows `samples: 0`, null latencies.
- **Evidence-not-scores — PASS.** Diffs are line-level `-/+/ ` text;
  similarity only sets `candidate_for_review`, which no alert path consumes
  (no auto "degraded" verdict exists anywhere in the tree).
- **Scope honesty — PASS.** `ACTIVE_PROBE_SCOPE_NOTE` disclaims
  customer-path guarantees; `PROBE_*` keys inventoried in `docs/SECRETS.md`
  as dedicated, budget-capped, never-reused credentials.

## Tier D — S3 (sensitive user content)

- **Session-only — PASS.** Pure function of the body; `Cache-Control:
  no-store`; privacy notice in-band ("not persisted, not logged, not used
  to improve shared heuristics"). Grep-verified: no `insert*`/logger call
  on the optimizer path.
- **Real-diff savings — PASS.** `tokens_saved === before − after` by
  construction; tokenizer labeled as stated approximation.
- **DoS caps — FOUND & FIXED (H2).** 256KB pre-parse guard + tiered rate
  limit; 10MB spoofed length → 413 (regression-pinned).

## Tier E — S2 (broadest permission grant)

- **Auth — PASS.** No session → 401 with zero data touched (session check
  precedes all parse/scan work — pinned: oversized + anonymous → 401, never
  413-after-work).
- **Minimal retention — PASS.** Stored shape is repo/path/line/matched-line
  only (no `content` key — pinned); no PR creation or modification path
  exists in the module.
- **Audit trail — PASS.** `org-scan.completed` logs org, repo count, match
  count, actor id — no file contents.
- **DoS caps — FOUND & FIXED (H2).** 4MB pre-parse guard + 10/min session
  scope (tightest in the tree, correctly so for the most sensitive route).
- **Remaining (non-code, before ship):** dedicated security/data-handling
  review, App manifest with `contents:read` only, deletion-path test,
  uninstall-revocation verification. The advertised
  `DELETE /api/v1/org-scan` purge endpoint does not exist yet.

## Tier F — S8 (mechanical codegen)

- **Bounded scope — PASS.** 5 supported pairs; unknown pairs → 422 with the
  supported list (never a guessed transform). Behavioral caveat on every
  response.
- **No auto-apply — PASS.** No repo-write, PR, or file-mutation import
  anywhere in the module; output is a string for human review.
- **DoS caps — FOUND & FIXED (H2).** 256KB pre-parse guard + rate limit.
- **Input validation — PASS.** `target_base_url` is `z.string().url()`;
  `code` capped at 20KB; original snippet preserved in-comment for review.

---

## Verdict

- **Prerequisite check: PASSED.** Phase 2/3 closure holds; S10 untouched.
- **Tier A (S7/S9): PASS.** Sourced-data discipline intact, one documented Low residual.
- **Tier B (S1/S6): PASS.** Pairing math and quality firewall both exact.
- **Tier C (S4+S5): PASS with one fixed Medium (H3).** Failure isolation is now fail-safe per call.
- **Tier D (S3): PASS with one fixed Medium (H2).** Session-only + bounded.
- **Tier E (S2): CONDITIONAL PASS (code-complete, review-gated).** All mechanical controls hold; the dedicated permission review + purge endpoint remain before ship.
- **Tier F (S8): PASS with one fixed Medium (H2).** Bounded, review-only, loud refusals.
- **Overall: NO CRITICAL findings. Ship Tiers A–D + F (with the three audit fixes, all landed and regression-tested in `tests/audit-s-hardening.test.ts`, 11/11). S2 stays review-gated. S10 stays HELD.**

## Prioritized remediation (real-world impact order)

1. ~~Unthrottled S routes (H1)~~ — DONE (`validatePublicApiRequest` × 5 routes).
2. ~~Pre-parse body guards (H2)~~ — DONE (256KB × 3, 4MB org-scan).
3. ~~Probe per-call failure isolation (H3)~~ — DONE (`errors` counter, no outage-as-drift).
4. S2 ship-gates (High, non-code): dedicated review, `contents:read`-only manifest, `DELETE /api/v1/org-scan` implementation, uninstall-revocation proof.
5. Spend ledger + `ACTIVE_PROBE_ENABLED` kill switch before the first scheduled paid cycle (P0 from the architectural review — code is ready, the account is not).
6. Residual Low: replace the embedding substring heuristic with curated-list + provider-prefix matching when the next false positive appears; currently zero tracked models affected.
