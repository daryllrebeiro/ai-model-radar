# AUDIT10Features — Hardening & Adversarial Audit of R1–R10

**Authorization & scope:** first-party assessment per standing rule. Disposable
test environment (local JSON backend + real Postgres `radar-pg:5433`),
synthetic test accounts/data only. No real user data, no live financial
connections, no production traffic. Every finding has exact repro steps.
Every no-finding check states what was tested.

**Auditor method:** static inspection + live functional tests. New regression
coverage landed as `tests/audit10-tier-{a,b,c,d,e,f}.test.ts` (42 tests, all
green both backends where DB-touching). Full suite after audit fixes:
**78 files / 464 tests pass locally, `tsc` clean, eslint 0 errors,
`next build` green.** Targeted suites re-run on real Postgres: prerequisites
12/12, Tier C 7/7, Tiers D+E 13/13, Tier F 6/6, plus digest/scim/router/R3/R4/P11.1.

---

## 0. Mandatory prerequisite check — PASSED

The R1–R10 spec bars new surface on open hardening gaps. Re-verified live
this session, **before** any Tier A–F work:

| Check | Evidence | Local | Postgres |
|---|---|---|---|
| P11.1 permanent regression | `tests/p11-1-cross-user.test.ts` — 401s, spoofed `X-User-Email`, cross-user body smuggling on all 5 routes | 4/4 | 4/4 |
| CORS fallback clarification | `src/lib/api-auth.ts:246-257` + `tests/audit-fixes.test.ts` allowlisted-echo vs `*` | 6/6 file | 6/6 file |
| Cookie wire-check | `src/lib/auth.config.ts:154` + `tests/auth-cookies.test.ts` (`__Secure-`+Secure prod-only, Lax/httpOnly always) | 2/2 | 2/2 |

**Result: all three genuinely closed. Audit of new surface proceeds.**
(Pre-existing `012` migration drift on the dev DB noted, untouched, unrelated.)

---

## Findings table

| Tier | Item | Finding | Severity | Exploitability | Repro steps | Fix recommendation |
|---|---|---|---|---|---|---|
| A | R1 slug detection | `detectModelId()` regex `[^/?#]+` truncated OpenRouter `provider/model` slugs at the first slash → overlay fetched/displayed the WRONG model (`anthropic` for `anthropic/claude-x`) | Medium | Any OpenRouter model page; deterministic | Visit `openrouter.ai/models/anthropic/claude-x` (stub-DOM test with `location.pathname=/models/anthropic/claude-x`): outbound fetch went to `/api/v1/models/anthropic` | **FIXED during audit** (`extensions/browser/content.js`: match `[^?#]+`, strip trailing slash) + regression test asserting full-slug fetch |
| B | R3 DeepSeek-R1 flags | `tool_calling:true` + `structured_output:true` pinned to the Jan-2025 R1 technical report, which predates function-calling support (added in R1-0528, May 2025 — confirmed against DeepSeek release notes). Exact "inferred flag" violation class the spec forbids | High | Comparator/API consumers shown an unsourced capability | Inspect `RAW_CAPABILITY_DATA` deepseek-r1 entry vs `https://api-docs.deepseek.com/news/news250528` | **FIXED during audit**: record re-sourced to R1-0528 release, `verified_date` 2025-05-28 + traceability pin test |
| B | R3 Gemini tuning flag | `fine_tuning:true` asserted beyond what the cited Feb-2025 launch source documents | Medium | Same as above | Inspect gemini-2.0-flash-001 entry vs cited blog | **FIXED during audit**: flag removed (unknown/—) + pin test |
| E | R8 credential storage | `export_connectors.secret` stored **plaintext** at rest (DB rows + JSON backups). Inconsistent with first-party API keys (SHA-256 hashed). Backup/dump read = lateral movement into users' Datadog/Notion/Airtable | High | `SELECT secret FROM export_connectors` / read any backup JSON | **FIXED during audit**: AES-256-GCM envelope (`src/lib/secret-store.ts`, key `EXPORT_CONNECTOR_KEY`), fail-closed creation without key, legacy-plaintext refusal. Direct-row test asserts `enc:v1:` ciphertext |
| E | R8 crypto self-bug | First version of `decryptSecret` split `enc:v1:iv:ct:tag` as `[,iv,ct,tag]`, taking `v1` as the IV → every delivery ran secretless | Medium (functional; caught pre-ship) | Any connector run with a secret | Audit round-trip test failed with auth-tag error | **FIXED during audit**: slice prefix before split + round-trip/wrong-key/legacy tests |

No other findings. Gate-rule outcomes: **zero cross-user access successes
(R5/R6/R8 IDOR all blocked)** → no Criticals; **R9 review gate is technical,
not social** → no Critical; **R10 gates all enforced** → no Critical.

---

## Tier A — R1/R2 (all tested, 9/9 `audit10-tier-a`)

- **Manifest scope — PASS.** No `<all_urls>`; 7 explicit `https://` matches;
  no `history`/`tabs`/`webNavigation`; `host_permissions` radar-backend only.
- **Overlay injection — PASS.** Badge is a new appended node; existing page
  content untouched (static) — *limitation: no real browser in this env, so
  DOM-diff proven under stub DOM instead of a live page.*
- **Overlay XSS — PASS.** Functional test: `<script>`/`<img onerror>` model
  name renders as `&lt;script&gt;`/`&quot;&gt;` — `escapeHtml` covers all
  interpolation sites including the encoded comparator href.
- **Non-allowlisted inert — PASS.** `evil.example`, bare `openrouter.ai/`,
  `openrouter.ai.evil.com`, `http://` downgrade → 0 fetches, 0 DOM writes;
  lookalike rejection unit-tested in `allowlist.js`.
- **Data minimization — PASS.** Exactly one fetch per matched page carrying
  only the matched model id (query-param `model=zzz` correctly ignored in
  favor of path slug after A1 fix).
- **R2 telemetry — PASS.** Single outbound call (`/api/v1/models/<id>`),
  only `m[2]` transmitted; adjacent `"sk-ant-secret-xyz"` unmatchable by the
  real pattern (extracted from source and executed); no `workspace.fs` /
  `findFiles` / telemetry APIs; package.json declares no workspace trust.
- **R2 hint XSS — PASS.** Matched ids cannot contain `()[]"`/spaces (proven
  against the real regex), link built with `encodeURIComponent`.

## Tier B — R3/R4 (7/7 `audit10-tier-b`, plus corrections above)

- **Spot-checks (10+ flags, all 7 license rows):** GPT-4o audio/tuning,
  Claude omissions (audio/fine-tuning correctly *absent*), V3/Qwen/Llama
  tool-use, Llama MAU-threshold note, Qwen `null`-conservative — all
  traceable. Two over-claims found and fixed (B1, B2).
- **No silent inference — PASS.** `undefined` renders `—`, never `false`
  (both pages); `?tool_calling=false` matches only sourced-false (currently
  empty set — by design, documented); unknown models enrich to `null`.
- **Disclaimer — PASS.** Rendered on both license surfaces (grep-pinned).
- **Filters — PASS.** Boundary test: explicit-false never matches unknowns;
  license denial requires an evidence note.

## Tier C — R5/R6 (7/7 `audit10-tier-c`, both backends)

- **R5 IDOR — PASS.** B vs A's upload: direct GET 404, list excludes,
  DELETE 404 with A's row intact, smuggled `owner_email`/`user_id` body
  fields ignored (schema strips unknowns; identity session-only).
- **R5 formula injection — PASS.** `=HYPERLINK(...)`/`@SUM` cells round-trip
  as inert data; route-tree walk proves **no** `text/csv`/`content-disposition`
  sink under usage/savings — only sink is auto-escaped React.
- **R5 upload validation — PASS.** Garbage/binary/no-header → 400;
  5001 rows → 400; ~2MB+ payload → 400/413; no archive/decompression path.
- **R5 retention — PASS.** Delete → GET 404 **and direct Postgres
  `SELECT COUNT(*)` = 0** for the id.
- **R5→R7 boundary — PASS.** R5-only data absent from public savings list;
  exactly one `INSERT INTO case_studies`, reachable only via consented route.
- **OAuth billing — N/A (does not exist).** Explicitly out of coverage; any
  future token path needs its own audit (storage/scope/revocation).
- **R6 injection — PASS.** SQL/HTML payloads validate as inert literals,
  match nothing; writes are `$`-parameterized (only dynamic SQL is a
  code-controlled PATCH column allowlist); table-intact check post-attack.
- **R6 cross-user — PASS.** B GET/test on A's rule id → 404/404.
- **R6 boundaries — PASS.** `gte`/`lte` inclusive at exactly 15%,
  `context_min` inclusive at exactly 100k, `eq` exact, `BECAME_FREE`=100%,
  unknown context fails `context_min`.

## Tier D — R7 (3/3 `audit10-tier-d` + prior `r7-savings` moderation/takedown)

- **Double opt-in — PASS.** R5 use alone never surfaces; single writer
  hard-codes `consent_confirmed` post-`consent:true`+session.
- **Moderation gate real — PASS.** Pending absent from public list AND no
  public per-id GET route exists (`[id]/route.ts` is DELETE-only).
- **Takedown real — PASS.** Approved → owner DELETE → absent from list with
  no alternate fetch path.
- **XSS — PASS.** Payload stored verbatim (correct for a data API), all
  render sinks JSX-interpolated, zero `dangerouslySetInnerHTML` on the page.
- Note: moderation auth is shared `ADMIN_SECRET` (pre-existing pattern;
  unset → fail-closed 401).

## Tier E — R8/R9 (10/10 `audit10-tier-e`, both backends)

- **R8 credentials — FOUND & FIXED (E1 above).** Residual: key lifecycle is
  env-var based — rotation procedure should be documented for prod (Low).
- **R8 IDOR — PASS.** B run/delete/list on A's connector → 404/404/excluded.
- **R8 payload scope — PASS.** Datadog body key-set asserted exact
  (`title/text/tags/alert_type/source_type_name`); no ids/emails/secrets in
  body; secret header-only; logger redacts secret-shaped keys anyway.
- **R9 review gate technical — PASS.** `runConnector` requires
  `status==='reviewed'` **and** allowlist (pending-review blocked even when
  allowlisted); call-graph walk proves **zero** non-test callers in
  `src/`+`scripts/` (poll cron untouched); snapshot/event counts unchanged
  after a hostile run — **no persistence path exists**.
- **R9 fuzz — PASS.** Wrong types/missing/absurd rejected; 5001-record and
  non-array payloads throw; SQL-in-name accepted as inert data only.
- **R9 authority — PASS.** Hostile `price_prompt:0` claim for an
  OpenRouter-sourced model returned as data, never written (counts proven).
- **R9 backdating — PASS by construction.** No writer; `polledAt` server-set;
  events derivable only by the diff engine.
- **R9 abandonment — documented manual** (`CONNECTOR_REVIEW.md` Removal +
  allowlist kill path; single reviewed connector, unwired to cron). Residual Low.

## Tier F — R10 (6/6 `audit10-tier-f`)

- **Built this round: yes** → full gate verification applied.
- **Sign-off — PASS.** `docs/ADR-010-routing-gateway.md` (conditional-go,
  pilot-only, no-GA clause) + `docs/ROUTING_INCIDENT_PLAN.md` (kill switch,
  no-retries, recovery bar) — content-asserted in tests.
- **Prerequisites — PASS.** Re-run this session, both backends (see §0).
- **Fail behavior — PASS.** Unknown chain → 503 + logged attempt; unreachable
  upstream → 502 with overhead header, `X-Radar-Routed-Model` absent;
  explicit fail-open names the ORIGINAL model with `proxy_fallback:true` +
  header, never substitutes (r10 suite).
- **No silent routing — PASS.** No-model + no-policy → 400; explicit model +
  policy on unknown id → 404 for that id (policy does not rescue/substitute).
- **Pilot gating — PASS.** Anonymous/outsider → 403; kill-switch off → 503;
  stats endpoint gated; opt-in recorded per user. (Audit also fixed a latent
  `hasAccess(auth.tier)` vocabulary bug that denied every real key.)
- Recommendation (Medium): no alerting yet on `routing/stats` degradation —
  kill switch + stats exist, paging does not.

---

## Verdict

- **Prerequisite check: PASSED** (first line, as required).
- **Tier A (R1/R2): PASS with one fixed Medium** (slug truncation). Thin clients are最小-privilege, inert off-allowlist, XSS-safe.
- **Tier B (R3/R4): PASS with one fixed High + one fixed Medium** (sourcing over-claims). Post-fix data is traceable; unknown-means-unknown holds end to end.
- **Tier C (R5/R6): PASS.** Financial-data IDOR blocked, deletion real (DB-proven), injection inert, boundaries exact.
- **Tier D (R7): PASS.** Consent, moderation, and takedown are all mechanically real, not cosmetic; UGC XSS-safe.
- **Tier E (R8/R9): PASS with one fixed High** (plaintext secrets → AES-GCM). Review gate is code-enforced; connector output cannot reach history.
- **Tier F (R10): CONDITIONAL PASS (pilot-only).** All strategic gates hold in code; GA remains unauthorized by ADR-010.
- **Overall: NO CRITICAL findings. Ship Tiers A–E (with the three audit fixes, all landed and regression-tested). R10 stays pilot-gated.**

## Prioritized remediation (real-world impact order)

1. ~~R8 plaintext connector secrets~~ — DONE (AES-256-GCM, fail-closed, ciphertext proven at rest). Remaining ops work: set `EXPORT_CONNECTOR_KEY` in every deploy env; confirm zero pre-fix plaintext rows outside test data (none found).
2. ~~R3 sourcing over-claims (R1 tool flags, Gemini tuning)~~ — DONE + pin tests. Remaining: calendar re-spot-check of flags as providers ship (cheap, periodic).
3. ~~R1 slug truncation~~ — DONE + regression test. Remaining: real-browser DOM-diff test when browser infra exists (Low).
4. R10 stats alerting (Medium): page on 1h success < 99% or p95 overhead > 250ms before adding pilot users; document `EXPORT_CONNECTOR_KEY`-style rotation for `ROUTING_*` vars (Low).
5. Process (Low): export-key rotation runbook; R9 second-connector review drill to exercise `CONNECTOR_REVIEW.md` before real submissions arrive.
