# Completed Roadmap Phases

This file records every roadmap phase that has been implemented, verified and marked
COMPLETE, in order. All phases below pass the full test suite, type-check cleanly for
`src/` + `scripts/`, pass `eslint` on touched files, and produce a green `next build`.

## Phase 4 — F1 RadarForecast ✅ COMPLETE
Statistical price-drop forecasting.
- Forecast engine `src/lib/forecast.ts` + `ForecastOptions` (asOf / minProbability / maxForecasts).
- `GET /api/v1/forecast` (Pro flag `PRICE_FORECAST`).
- Shared `getPriceDropForecasts` used across the digest cron, model pages, MCP and alerts.
- `PRICE_DROP_EXPECTED` market signal wired into the signal engine.
- MCP tool `get_forecast`.
- UI: RadarForecast cards on the model detail page and in the daily/weekly email digest.
- Feature flag inventory: `PRICE_FORECAST` (pro).

## Phase 4 — F3 Deploy-Ready Migration ✅ COMPLETE
Usage-aware migration recommendations.
- Usage profile persistence + `buildRecommendations` / `maxMonthlySavingsForProfile` engine.
- `GET /api/v1/recommend` (Pro flag `MIGRATION`).
- MCP tool `get_migration_recommendation`.
- Deals & free-models UI + weekly digest "you could save" line.
- Feature flag inventory: `MIGRATION` (pro).

## Phase 5 — F2 Live Endpoint Intelligence ✅ COMPLETE
Live endpoint reliability telemetry.
- `endpoint_telemetry` Postgres table (#11) + `LocalDbState` mirror + backup/restore allowlists.
- Probe engine `src/lib/probe.ts` incl. `evaluateEndpointHealth` (healthy/degraded/down).
- `GET /api/v1/telemetry` (Pro flag `APT_PROBE`).
- Degraded-endpoint alert rule + reliability card UI on the model page.
- MCP tool `get_endpoint_telemetry`.
- Feature flag inventory: `APT_PROBE` (pro).

## Phase 5 — F4 Usage-Aware Budget Governance ✅ COMPLETE
Enterprise budget & shadow-AI governance.
- Types `src/types/governance.ts`: rules, alerts, approvals, usage, shadow-AI, status report.
- Postgres tables #12 `budget_rules`, #13 `budget_alerts`, #14 `migration_approvals` + mirrors/allowlists.
- Governance engine `src/lib/governance.ts`: usage resolution, family projections, rule evaluation
  (ok/approaching/over), shadow-AI detection, approval gating, `DEFAULT_1M_PRICES` fallback.
- APIs: `GET/POST /api/v1/governance/rules`, `GET /api/v1/governance/status`,
  `POST /api/v1/governance/approvals`, `POST /api/v1/governance/approvals/[id]`.
- Admin UI at `/governance` (KPI cards, rule builder, family breakdown, shadow-AI table, approvals).
- MCP tool `get_budget_status`.
- Feature flag inventory: `GOVERNANCE` (enterprise).

## Phase 6 — F5 Ask the Radar ✅ COMPLETE
Conversational copilot over the full radar dataset with cited answers, plus scheduled per-watchlist market briefs.
- Types `src/types/ask.ts`: intents, citations, answers, briefs.
- Retrieval engine `src/lib/ask-answer.ts`: deterministic intent detection + answer generation over
  snapshots, events, signals, forecasts and telemetry; `buildTruthIndex` / `validateAnswer` re-check
  every citation against the source context before it can ship.
- `POST /api/v1/ask` (Pro flag `ASK_RADAR`); answers include full citation set, `source: 'protocol'`,
  `citations_validated: true`; supports an optional usage profile for savings questions.
- Chat UI at `/ask` with suggestion chips, per-source citation links, and an upgrade gate.
- Market briefs `src/lib/briefs.ts` (free tier: per-watchlist history + diff) wired into the existing
  digest cron and the email HTML (`📊 Your Market Brief` section) with citations into the changelog.
- MCP tool `ask_radar` (MCP parity).
- Feature flag inventory: `ASK_RADAR` (pro). Total inventory 41 (17 free / 16 pro / 8 enterprise).

---

**Validation reference:** 47 test files / 279 tests passing in **both** persistence modes
(local JSON and real Postgres); `tsc --noEmit` clean for the whole repo including tests;
`touched files pass eslint with zero errors repo-wide; `next build` green.

## Phase 1 stabilization — top-5 highest-leverage items ✅ COMPLETE
- Item 1 (P0 tier vocabulary): `normalizeTier()` canonical mapping at all auth boundaries,
  monotonic stored-tier upgrades, versioned backfill (`migrations/007_*` + `scripts/backfill-tiers.ts`),
  6-test enforcement matrix incl. the staging-equivalent `FEATURE_ENFORCEMENT=true` regression test.
- Item 2 (P0 bounded reads): `getEvents` Postgres path rewritten to SQL-side predicates +
  keyset pagination over a `model_current` join (no in-memory full-table pagination); 100k-row
  benchmark on real Postgres: 2114ms/100k-rows/+63MB → 567ms/50-rows (3.7x). Also fixed a latent
  PG-only `interval '1 7d'` syntax bug in price-history ranges found by dual-mode runs.
- Item 3 (email injection): `escapeHtml` on every upstream-derived string in the digest
  template + payload-injection test proving inert output.
- Item 4 (secret timing): Edge-safe `secretsEqual()` helper applied to middleware, admin
  surface, and all four cron routes; unit + route tests; grep-verified zero `===` secret
  comparisons remain.
- Item 5 (CI + drift): `.github/workflows/ci.yml` (typecheck, lint, tests in local **and**
  Postgres-service modes, build); all 15 accepted `tsc` errors fixed; full-repo eslint zero
  errors; gate verified to bite on a planted type error. Dual-mode runs additionally forced
  governance FK-correct fixtures and unique team names in tests.

## Post-Phase 6 hardening (whole-roadmap Definition of Done)
- Deploy surface (`vercel.json`): `/api/cron/poll` hourly, `/api/cron/probes` hourly (:15),
  `/api/cron/digest` daily 07:00 UTC + `?timeframe=weekly` Mondays 08:00 UTC.
- `GET/POST /api/cron/probes` (CRON_SECRET-gated, `dry_run=1` for ops checks) feeds the tracked
  catalog into `runEndpointProbes`; `scripts/run-probes.ts` fixed to do the same for host cron.
- Brief outputs accept an explicit `asOf` for fixed-point verification (forecast `asOf` pattern).
- Pricing page carries line items for all five features (forecasts, migration recommendations,
  endpoint probes, Ask copilot, budget governance).
