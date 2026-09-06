# AI Model Radar — Product Roadmap: Phases 4–6

**North star:** convert the append-only price/context/changelog archive (the data moat
nobody else keeps) into *money and decisions*: dollar-quantified savings, predictive
intelligence, live endpoint verification, budget governance, and a conversational front
door. The five features below are sequenced to ship the biggest demos first and the
funnel (Ask the Radar) last.

## Why the incumbents lose

| Competitor | What it offers | What it lacks | Our wedge |
|---|---|---|---|
| Artificial Analysis | Static price/benchmark tables | No time-series, no alerts, no predictions | Forecasts (F1), alerts over a real changelog |
| OpenRouter model list | Catalog + current prices | No history, single source | Reconciliation across sources + event diffs |
| LMArena / leaderboards | Benchmarks | No pricing/cost | Cost decision-making (F3/F4) |
| Pricing newsletters | One-way digests | No interactivity, no measurement | Live endpoint probes (F2), Ask (F5) |

---

## Phase 4 — Wave 1 (weeks 1–3): prove individual value

Reuses stored history → near-zero new data cost, immediate dollar/foresight value.

### F1 — RadarForecast: predictive price-drop alerts
- **What**: statistical repricing cadence from the `model_events` archive
  (release→first-cut and cut→cut gaps per line/provider), scored against how overdue
  each paid model is. Emits probability + expected window + typical cut magnitude.
- **MVP landed**: `src/lib/forecast.ts` (deterministic, rule/statistics-based, no ML),
  `src/types/forecast.ts`, `tests/forecast.test.ts` (9 tests), gate via new
  `PRICE_FORECAST` flag (Pro).
- **Still to build**: `GET /api/v1/forecast` (behind `PRICE_FORECAST`), model-detail
  forecast panel, digest preview line ("⏳ next cut likely within N days"), MCP tool
  `get_forecast`, `PRICE_DROP_EXPECTED` signal wired into `src/lib/signals.ts`.
- **COMPLETE**: all boxes above shipped — endpoint, panel, digest line, MCP tool, and
  the `PRICE_DROP_EXPECTED` signal (tests: forecast 14, digest 7, mcp-tools 14).
- **DoD**: v1 endpoint test-covered; UI panel; digest line; 90% precision on a
  held-out slice of historical cuts (calibrated during Phase 6 eval).

### F3 — Deploy-ready migration: "switch and save $N/mo"
- **What**: usage profile (paste usage or connect a provider key, opt-in) × cost engine
  → continuous "your workload on X costs $Y; migrating to Z saves $N/mo" with a
  one-click OpenAI-compatible client config swap + risk factors (context, modality,
  EOL).
- **Build**: usage-profiles table + recommendation engine; `POST /api/v1/recommend`;
  savings badges on deals/arbitrage pages; weekly "you could have saved $N" digest line;
  MCP tool `get_migration_recommendation`. Reuses `cost-model.ts`, `migration-advisor.ts`,
  `arbitrage.ts`, and F1's EOL/forecast output as a risk input.
- **DoD**: recommendation endpoint + tests; digest integration; feature-flagged Pro.
- **Status**: ✅ COMPLETE — `usage_profiles` table + `src/lib/recommendation.ts` engine
  (`buildRecommendations`, `maxMonthlySavingsForProfile`, arbitrage/via_best_switch,
  EOL + PRICE_DROP_EXPECTED risk factors), `POST /api/v1/recommend` (persists + reuses
  stored profiles), `MIGRATION` pro flag, deals/savings badge, weekly digest savings
  callout, `get_migration_recommendation` MCP tool, `restore-db.ts` allowlist includes
  `usage_profiles`. 203 tests / 41 files green, `next build` OK.

---

## Phase 5 — Wave 2 (weeks 4–8): measurement moat + B2B layer

### F2 — Live endpoint intelligence (latency, rate limits, free-tier availability)
- **What**: probe engine (extension of `scripts/poll.ts`) calling each tracked endpoint:
  P95 latency, tokens/sec, 429/`Retry-After` frequency, and whether a free-tier endpoint
  still accepts traffic. New `endpoint_telemetry` table persists the series.
- **Why**: no competitor verifies "free tier works" in near-real-time; also backfeeds
  EOL detection (delisted-but-serving = relisted) and alert rules.
- **Build**: probe worker, migration, tests; reliability card on model pages;
  "degraded endpoint" alert rule; teams watchlist hooks.
- **DoD**: probes on schedule, telemetry surfaced, alert integration tested. **Pro tier**
  (measurement infra is the expensive part).
- **Status**: ✅ COMPLETE — `endpoint_telemetry` table + `src/lib/probe.ts` engine
  (`buildProbeTargets`, `probeEndpoint`, `analyzeProbeResults`, `evaluateEndpointHealth`,
  `runEndpointProbes` with watched/free-tier prioritization, `getDegradedEndpointsForWatchlist`),
  `GET /api/v1/telemetry` (gated APT_PROBE), `scripts/run-probes.ts` worker,
  `evaluateEndpointAlertRules` degraded-endpoint rule, model-page reliability card,
  `get_endpoint_telemetry` MCP tool, backup/restore allowlists updated. 220 tests / 42 files,
  build OK.

### F4 — Usage-aware budget governance & shadow-AI detection (teams)
- **What**: per-team budget over the F3 usage engine; projected spend per model family;
  threshold alerts; flag undocumented endpoints burning budget ("shadow AI"); approval
  workflow for migration switches.
- **Build**: budget rule model + enforcement checks + tests; admin view.
- **DoD**: enforcement + alert tests, admin view, docs. **Enterprise tier.**
- **Status**: ✅ COMPLETE — `budget_rules`/`budget_alerts`/`migration_approvals` tables,
  `src/lib/governance.ts` engine (`collectUsageFromProfiles`, `projectUsageByModelFamily`,
  `evaluateBudgetRule`, `detectShadowAI`, `switchRequiresApproval`), `GET/POST /api/v1/governance/rules`
  + `/status` + approvals create/decide (gated GOVERNANCE), `/governance` admin view,
  `get_budget_status` MCP tool, backup/restore allowlists updated. 236 tests / 43 files,
  build OK.

---

## Phase 6 — Wave 3 (weeks 9–12): the front door

### F5 — Ask the Radar + auto market briefs
- **What**: conversational copilot over all radar data (snapshots, events, signals,
  forecasts, recommendations) with cited answers, plus scheduled per-watchlist **market
  briefs** with citations into the changelog. Reuses `src/lib/mcp/tools.ts` as the
  retrieval surface.
- **Build**: `POST /api/v1/ask` with a protocol-based generator (unit-testable like
  signals); chat UI; brief generator on the existing digest cron.
- **DoD**: ask endpoint + tests, citation validation, briefs shipped, MCP parity.
  Free tier gated (limited), Pro for full.
- **Status**: ✅ COMPLETE — `src/lib/ask-answer.ts` retrieval engine (intent detection +
  `buildTruthIndex`/`validateAnswer` citation re-check), `POST /api/v1/ask` (gated ASK_RADAR),
  `/ask` chat UI with source citations, `src/lib/briefs.ts` market briefs wired into the digest
  cron + email, `ask_radar` MCP tool, `ASK_RADAR` pro flag (inventory 41). 257 tests / 44 files,
  build OK. Recorded in `PHASES_COMPLETED.md`.

---

## Phase map

| Phase | Wave | Features | Why this order |
|---|---|---|---|
| 4 | Weeks 1–3 | F1 Forecast, F3 Migration savings | Reuse stored history; biggest demos, near-zero data cost |
| 5 | Weeks 4–8 | F2 Endpoint probes, F4 Governance | New measurement infra + B2B; F4 depends on F3 usage engine |
| 6 | Weeks 9–12 | F5 Ask Radar + Briefs | Needs F1–F4 to answer well; the funnel for everything above |

## Cross-cutting per feature (all five)

- New `FeatureGate` flag in `src/lib/feature-flags.ts` (F1/F2/F3 → `pro`; F4 →
  `enterprise`; F5 → mixed free-limited/pro).
- Public `api/v1` surface behind `requireFeature` + API-key auth (mirror
  `api/v1/signals/route.ts`).
- MCP tool registered in `scripts/mcp-server.ts` + covered by `tests/mcp-tools.test.ts`.
- Digest integration line + pricing-page line item.
- Pure engine first, route second — every engine module gets deterministic unit tests
  (pattern: `computePriceDropForecasts` takes explicit `asOf` for stable assertions).

## Feature-flag inventory deltas

| Flag | Tier | Feature |
|---|---|---|
| `PRICE_FORECAST` | pro | F1 RadarForecast (shipped in Phase 4 wave 1) |
| `MIGRATION` | pro | F3 usage-based migration recommendations |
| `APT_PROBE` | pro | F2 endpoint intelligence |
| `GOVERNANCE` | enterprise | F4 budget governance & shadow-AI |
| `ASK_RADAR` | pro | F5 Ask the Radar (market briefs ride the free digest) |

## Definition of done (whole roadmap)

- Every P0/P1-era bug surface exercised by endpoint tests.
- `get_forecast`/recommendation/brief outputs verifiable against a fixed `asOf`.
- Terraform/deploy surface ready to host the probe schedule + digest cron.
- Documentation claims in the five features match shipped code.
- Hold-out calibration: forecast precision and migration savings estimates
  retrospectively checked against 30 days of real events after launch.
- **Status (post-Phase 6 hardening)**: `vercel.json` schedules the full cron surface —
  `/api/cron/poll` hourly, `/api/cron/probes` hourly (:15), `/api/cron/digest` daily
  07:00 UTC plus `?timeframe=weekly` Mondays 08:00 UTC. `GET/POST /api/cron/probes`
  (CRON_SECRET-gated like poll/digest, `dry_run=1` for ops checks) feeds the tracked
  catalog into `runEndpointProbes`; `scripts/run-probes.ts` does the same for host cron
  (bare `runEndpointProbes()` resolves zero targets). Brief outputs take an explicit
  `asOf` for fixed-point verification, matching the forecast `asOf` pattern.
  Pricing page carries line items for all five features. Remaining: 30-day post-launch
  hold-out calibration (forecast precision, migration savings) — explicitly after launch.

## Risk watch

- F2 probes are the only capital-heavy build — keep pull-based on the existing poll
  cron; on failure, drop that endpoint's telemetry, never the ingestion run.
- F3/F4 touch user financial data — usage stays opt-in, key-hashed, and behind the same
  access-guard as teams.
- Forecast calibrations must never approach "certainty" — probability is capped at 0.93
  and every forecast ships its factor list for transparency.