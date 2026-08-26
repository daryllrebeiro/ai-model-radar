# AI Model Radar — Feature Spec & Implementation Plan

**A changelog for the AI model market.** One feed of every price drop, free tier, new release, and removal — with full history, across providers.

Scope is deliberately narrow for v1. Everything here is sequenced so each phase ships something usable on its own; nothing depends on a feature that doesn't exist yet.

---

## 1. Product Principles (read before building anything)

1. **The database is the product.** The UI is a thin window onto an event-sourced history table. If you're ever unsure whether to spend a day on a UI feature vs. a day on ingestion reliability, spend it on ingestion.
2. **No fabricated confidence scores.** Never show a percentage ("84% confidence") unless it's a documented, backtested calculation. Show raw evidence instead of synthesized certainty.
3. **One source of truth per fact.** Don't average or invent composite "value scores" across incompatible benchmarks in v1. Show sourced numbers, dated, with a link.
4. **Diffs, not snapshots.** Every table that can change over time is append-only. Never `UPDATE` a price in place — insert a new row and derive an event from the delta.
5. **Alert sparingly.** The fastest way to lose users is a noisy feed. Every event type needs an explicit significance threshold before it's allowed to push a notification.

---

## 2. Phased Roadmap

| Phase | Goal | Timeframe (solo/small team) |
|---|---|---|
| **V0 — Ingestion spike** | Prove you can reliably pull & diff one source | 2–4 days |
| **V1 — MVP** | Public feed + model pages, one data source, six event types | 2–3 weeks |
| **V2 — Breadth** | Second data source (Hugging Face), arbitrage view, saved filters | 3–4 weeks |
| **V3 — Intelligence** | Personalized alerts, benchmark comparison (not scoring), public API | 4–6 weeks |
| **V4 — Advanced** | Stealth/anomaly signals (evidence-based, no fake confidence), recommendation engine | Ongoing, only after real usage data exists |

Do not start V2 until V1 has been live and diffing correctly for at least a week of real polling cycles — you need to see how noisy the raw data actually is before adding a second source.

---

## 3. V1 Feature Spec (build this first)

### 3.1 Data source
**OpenRouter's public models API** (`GET https://openrouter.ai/api/v1/models`) is the only source for V1. It already returns normalized: model id, name, provider/author, pricing (prompt/completion, per-token), context length, modality, and description — across hundreds of models and dozens of providers. No auth needed for the public listing endpoint. Confirm current field names against their docs at build time, since APIs evolve.

### 3.2 Ingestion & diffing
- Poll the endpoint on a schedule (start hourly; tune later based on how often data actually changes).
- Each poll produces a full snapshot. Compare it field-by-field against the most recent stored snapshot **per model id**.
- Emit an `model_event` row for each detected change, plus one `NEW_MODEL` event for ids never seen before, and one `MODEL_REMOVED` event for ids that disappear from the current snapshot but existed in the last one.

**V1 event types (six, no more):**

| Event | Trigger |
|---|---|
| `NEW_MODEL` | Model id not seen in any prior snapshot |
| `MODEL_REMOVED` | Model id present in last snapshot, absent in current one |
| `PRICE_CHANGE` | prompt or completion price differs from last snapshot (store both old/new, compute % delta) |
| `BECAME_FREE` | price was > 0, now == 0 |
| `LEFT_FREE` | price was 0, now > 0 |
| `CONTEXT_CHANGED` | context length differs from last snapshot |

Store the raw API response for every poll (even unchanged ones) in cold storage for a rolling window (e.g. 30 days), so you can replay/debug diffing logic without re-fetching history you don't have.

### 3.3 Data model

```sql
-- immutable log of every poll, per model, per cycle
CREATE TABLE model_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    model_id        TEXT NOT NULL,          -- e.g. "openai/gpt-5.6-sol"
    provider        TEXT NOT NULL,
    name            TEXT NOT NULL,
    price_prompt    NUMERIC(12,8),          -- per-token, nullable if unknown
    price_completion NUMERIC(12,8),
    context_length  INTEGER,
    modality        TEXT,                   -- "text", "text+image", etc.
    is_free         BOOLEAN GENERATED ALWAYS AS (price_prompt = 0 AND price_completion = 0) STORED,
    raw_json        JSONB NOT NULL,          -- full source payload for that model, that poll
    polled_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_snapshots_model_time ON model_snapshots (model_id, polled_at DESC);

-- derived, append-only event log — this table is the product
CREATE TABLE model_events (
    id              BIGSERIAL PRIMARY KEY,
    model_id        TEXT NOT NULL,
    event_type      TEXT NOT NULL,           -- enum: NEW_MODEL, PRICE_CHANGE, etc.
    old_value       JSONB,
    new_value       JSONB,
    pct_change      NUMERIC(6,2),            -- null unless applicable (price/context)
    source          TEXT NOT NULL DEFAULT 'openrouter',
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_type_time ON model_events (event_type, detected_at DESC);
CREATE INDEX idx_events_model ON model_events (model_id, detected_at DESC);

-- current-state view, always derivable from snapshots, cached for read speed
CREATE MATERIALIZED VIEW model_current AS
SELECT DISTINCT ON (model_id) *
FROM model_snapshots
ORDER BY model_id, polled_at DESC;
```

Key design choice: `model_snapshots` is never edited or deleted (except cold-storage pruning of `raw_json` after N days to control storage cost — keep the structured columns forever, they're cheap). `model_events` is derived and could theoretically be recomputed from `model_snapshots` if you ever change your diffing logic.

### 3.4 UI — three screens only

**Feed (home page)**
- Reverse-chronological list of `model_events`, newest first.
- Filter chips: event type, provider, free-only.
- Each row: icon by event type, model name, one-line summary ("GPT-5.6 Sol dropped 22%, now $X/1M"), relative timestamp, link to model detail.
- No infinite personalization in V1 — one global feed for everyone.

**Model Detail**
- Current stats (price, context, provider, modality).
- Price history as a simple line chart.
- Full event log for that model.
- Link out to the model's page on OpenRouter.

**Deals / Free** (a filtered view of the feed, not a separate data path)
- Currently-free models.
- Biggest price drops in the last 7/30 days (computed from `model_events` where `event_type = 'PRICE_CHANGE'`).

### 3.5 Explicitly out of scope for V1
Stealth detection, benchmark scoring, GitHub/Hugging Face ingestion, personalized alerts, family trees, AI Stack Advisor, public API. All revisited in later phases below.

---

## 4. V2 — Breadth

- **Second source: Hugging Face** (trending models / new repos via their public API) — surfaced as a separate, clearly-labeled "Community Activity" feed, not merged into the pricing event stream. Different data, different confidence level, keep them visually distinct.
- **Price arbitrage view**: for models available through multiple providers on OpenRouter, show a comparison table sorted by price. This is pure aggregation of data you already have — no new ingestion needed, just a new query and view.
- **Saved filters / watchlists** (no auth yet — store in browser local state or a shareable URL query string) before building full accounts.
- **RSS/webhook output** of the feed so power users can pipe it into their own tools without you building notification infrastructure yet.

## 5. V3 — Intelligence

- **Accounts + personalized alerts**: users pick providers/categories they care about, get filtered digest (daily email or in-app), not per-event pings.
- **Benchmark comparison (not scoring)**: pick 2–3 well-known public benchmark sources, show raw sourced numbers per model side-by-side with publish date. Explicitly no synthesized composite score. Let users apply their own weighting client-side if they want a sortable "my priorities" view — the math happens in the browser, not as a claim you publish.
- **Public read API**: `GET /models`, `GET /models/{id}/history`, `GET /events`, `GET /events?type=BECAME_FREE`. Rate-limited, API-key gated, thin wrapper over the same Postgres queries the UI uses.

## 6. V4 — Advanced (only after real usage data exists)

- **GitHub org activity monitor** for the handful of labs where it's genuinely informative (config file changes, new repos), shown as raw evidence with timestamps — never as a "confidence %" prediction.
- **Stealth/anomaly signals**: only build this once you have enough historical false-positive/true-positive data to say something calibrated. Until then, keep it as a manually-curated "notable activity" list, not an automated confidence score.
- **AI Stack Advisor / recommendation engine**: needs real usage and feedback data to be worth anything — building it on zero users is guessing at requirements.

---

## 7. Tech Stack

Chosen for: small team/solo buildability, low operating cost pre-revenue, and minimizing time spent on infrastructure vs. the actual diff engine.

| Layer | Choice | Why |
|---|---|---|
| **Database** | **PostgreSQL** (managed — Supabase, Neon, or RDS) | Everything in this spec is relational and append-only with a materialized view for current-state reads. JSONB columns handle the raw API payloads without needing a separate document store. Avoid adding a second database (e.g. Mongo) purely for the JSON blobs — Postgres's JSONB does this fine at this scale. |
| **Scheduler / ingestion jobs** | **A cron-triggered serverless function** (Vercel Cron, Supabase Edge Functions + `pg_cron`, or a simple GitHub Actions scheduled workflow hitting an endpoint) | Hourly polling of one API is not a workload that justifies a dedicated job queue (Celery/Sidekiq/etc.) or a message broker in V1. Reach for a real queue (e.g. a Postgres-backed queue, or Redis + BullMQ) only once you're polling multiple sources on different cadences with retries/backoff logic worth isolating. |
| **Backend / API** | **Next.js API routes (or a small Fastify/Express service) in TypeScript**, or **FastAPI in Python** if the team is more Python-native | Either is fine — the actual complexity here is the SQL and diffing logic, not framework choice. Pick whichever language your ingestion scripts are already in, so you're not maintaining two stacks for a project this size. |
| **Frontend** | **Next.js (React) + Tailwind** | Three screens (feed, detail, deals), server-rendered for the feed (good for freshness + SEO on model pages, which double as long-tail search landing pages — "GPT-5.6 Sol pricing history" is a real search query). |
| **Charts** | **Recharts or Chart.js** | Simple line charts for price/context history — no need for a heavier viz library at this stage. |
| **Diffing logic** | **Plain SQL / a typed diff function in your backend language**, not a generic diffing library | The diff rules are simple enough (six event types, explicit field comparisons) that a bespoke function is more maintainable and testable than a generic object-diff library, and keeps the event-derivation logic auditable. |
| **Hosting** | **Vercel (frontend + API routes) + managed Postgres (Supabase/Neon)** | Minimizes ops for a small team; both have generous free tiers sufficient for V1–V2 traffic. Move to a dedicated VM/container setup only if/when a scheduled ingestion job needs to run longer than serverless function time limits allow (unlikely at one-source, hourly polling). |
| **Notifications (V3+)** | **Resend or Postencilog for email digests; skip push/SMS entirely until there's demonstrated demand** | Don't build multi-channel notification infra before you have users asking for a channel beyond email/RSS. |
| **Monitoring** | **A simple uptime check on the cron endpoint (e.g. Healthchecks.io) + Postgres query logging** | You need to know immediately if a poll silently fails and events stop being generated — this is the single most important piece of ops tooling for a project whose entire value is "the data is current." |

### Explicitly avoid, for V1–V2
- A dedicated job queue / message broker (overkill at one source, hourly cadence).
- A vector database or embeddings pipeline (nothing here needs semantic search yet).
- Kubernetes or any container orchestration (a single scheduled function and a managed Postgres instance cover this entire roadmap through V3).
- Building your own benchmark-scoring model (V3 stays explicitly non-synthesized, per principle #3).

---

## 8. Immediate Next Steps

1. Spike: write the polling script against OpenRouter's models endpoint, store one raw snapshot in a local Postgres table. Confirm what actually changes poll-to-poll over a 48-hour window before writing any diff logic — this tells you if hourly polling is even the right cadence.
2. Implement the schema in Section 3.3 and the six-event diff function.
3. Ship the Feed screen against real data before building Model Detail or Deals — validate that the event stream itself is interesting before investing in secondary views.
4. Only after a week of stable, correctly-diffing data: move to V2.