-- AI Model Radar Database Schema (PostgreSQL only — uses BIGSERIAL, JSONB,
-- TIMESTAMPTZ, and DISTINCT ON, none of which SQLite supports)

-- 1. Immutable log of every poll snapshot per model
CREATE TABLE IF NOT EXISTS model_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    model_id            TEXT NOT NULL,
    provider            TEXT NOT NULL,
    name                TEXT NOT NULL,
    price_prompt        NUMERIC(14, 8),
    price_completion    NUMERIC(14, 8),
    context_length      INTEGER,
    modality            TEXT DEFAULT 'text->text',
    is_free             BOOLEAN DEFAULT FALSE,
    raw_json            JSONB NOT NULL,
    polled_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshots_model_time ON model_snapshots (model_id, polled_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_polled_at ON model_snapshots (polled_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_provider ON model_snapshots (provider);

-- 2. Derived append-only event log (The core product table)
CREATE TABLE IF NOT EXISTS model_events (
    id                  BIGSERIAL PRIMARY KEY,
    model_id            TEXT NOT NULL,
    event_type          TEXT NOT NULL,
    old_value           JSONB,
    new_value           JSONB,
    pct_change          NUMERIC(8, 2),
    source              TEXT NOT NULL DEFAULT 'openrouter',
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_type_time ON model_events (event_type, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_model ON model_events (model_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_detected_at ON model_events (detected_at DESC);

-- 3. Ingestion Runs Observability & Audit Log
CREATE TABLE IF NOT EXISTS ingestion_runs (
    id                  BIGSERIAL PRIMARY KEY,
    source              TEXT NOT NULL,          -- 'openrouter', 'github', 'huggingface'
    started_at          TIMESTAMPTZ NOT NULL,
    finished_at         TIMESTAMPTZ,
    status              TEXT NOT NULL,          -- 'success', 'partial', 'failed'
    models_seen         INTEGER DEFAULT 0,
    events_emitted      INTEGER DEFAULT 0,
    error_detail        TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source_time ON ingestion_runs (source, started_at DESC);

-- 4. Developer API Keys (Hashed SHA-256 Storage & Tiered Quotas)
CREATE TABLE IF NOT EXISTS api_keys (
    id                  BIGSERIAL PRIMARY KEY,
    key_hash            TEXT NOT NULL UNIQUE,   -- SHA-256 hash, never plaintext
    key_prefix          TEXT NOT NULL,          -- e.g. "amr_live_a1b2..." for identification
    owner_email         TEXT NOT NULL,
    tier                TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'developer' | 'production'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at        TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys (owner_email);

-- 5. Webhook Digest Deliveries Audit Log
CREATE TABLE IF NOT EXISTS digest_deliveries (
    id                  BIGSERIAL PRIMARY KEY,
    rule_id             TEXT,
    destination_url     TEXT NOT NULL,
    payload_preview     TEXT,
    http_status         INTEGER,
    attempts            INTEGER NOT NULL DEFAULT 1,
    delivered_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success             BOOLEAN NOT NULL,
    error_message       TEXT
);

CREATE INDEX IF NOT EXISTS idx_deliveries_time ON digest_deliveries (delivered_at DESC);
  CREATE TABLE IF NOT EXISTS webhook_dlq (
      id              BIGSERIAL PRIMARY KEY,
      delivery_id     TEXT NOT NULL UNIQUE,
      rule_id         TEXT,
      destination_url TEXT NOT NULL,
      payload         TEXT NOT NULL,
      attempts        INT NOT NULL DEFAULT 0,
      max_attempts    INT NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
      next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status          VARCHAR(20) NOT NULL DEFAULT 'queued',
      last_error      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE INDEX IF NOT EXISTS idx_webhook_dlq_due
  ON webhook_dlq (status, next_retry_at) WHERE status IN ('queued', 'retrying');
CREATE TABLE IF NOT EXISTS model_eol (
    model_id         TEXT PRIMARY KEY,
    announced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eol_at           TIMESTAMPTZ NOT NULL,
    source           TEXT NOT NULL DEFAULT '',
    notes            TEXT NOT NULL DEFAULT '',
    created_by_email VARCHAR(255) NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (eol_at > announced_at)
);
CREATE INDEX IF NOT EXISTS idx_model_eol_date ON model_eol (eol_at);

-- 6. User Accounts, Stripe Subscriptions & Server-Side Watchlists
CREATE TABLE IF NOT EXISTS users (
    id                  SERIAL PRIMARY KEY,
    email               VARCHAR(255) UNIQUE NOT NULL,
    role                VARCHAR(50) NOT NULL DEFAULT 'user',
    tier                VARCHAR(50) NOT NULL DEFAULT 'free',
    stripe_customer_id  VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

CREATE TABLE IF NOT EXISTS user_watchlists (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_id    VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_user_watchlists_user ON user_watchlists(user_id);
CREATE INDEX IF NOT EXISTS idx_user_watchlists_model ON user_watchlists(model_id);

-- 7. Alert Rules for price-drop / change notifications
CREATE TABLE IF NOT EXISTS alert_rules (
    id                  SERIAL PRIMARY KEY,
    type                VARCHAR(50) NOT NULL DEFAULT 'webhook',
    destination         TEXT NOT NULL,
    active              BOOLEAN NOT NULL DEFAULT true,
    min_price_drop_pct  NUMERIC(8, 2),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_active ON alert_rules(active);

-- 8. Current-state view for quick reads
-- DISTINCT ON with an id tiebreaker guarantees a single deterministic row per
-- model even when multiple snapshots share the same polled_at timestamp. The
-- previous MAX(polled_at) self-join emitted duplicate rows on ties, which
-- propagated into the event-feed join in getEventsBounded.
CREATE OR REPLACE VIEW model_current AS
SELECT DISTINCT ON (model_id) *
FROM model_snapshots
ORDER BY model_id, polled_at DESC, id DESC;

-- 9. Team Workspaces (Enterprise) — collaborative shared watchlists
CREATE TABLE IF NOT EXISTS teams (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(120) NOT NULL,
    slug                VARCHAR(120) UNIQUE NOT NULL,
    owner_email         VARCHAR(255) NOT NULL,  -- retained for display; no FK
    owner_user_id       INT REFERENCES users(id) ON DELETE SET NULL,  -- authoritative ownership
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_email);
CREATE INDEX IF NOT EXISTS idx_teams_owner_user_id ON teams(owner_user_id);

CREATE TABLE IF NOT EXISTS team_members (
    id                  SERIAL PRIMARY KEY,
    team_id             INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    member_email        VARCHAR(255) NOT NULL,
    role                VARCHAR(20) NOT NULL DEFAULT 'member',  -- 'admin' | 'member'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, member_email)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members(member_email);

CREATE TABLE IF NOT EXISTS team_watchlists (
    id                  SERIAL PRIMARY KEY,
    team_id             INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    model_id            VARCHAR(255) NOT NULL,
    added_by_email      VARCHAR(255) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_team_watchlists_team ON team_watchlists(team_id);

-- 10. Usage Profiles (Pro) — workload definition powering migration savings
CREATE TABLE IF NOT EXISTS usage_profiles (
    id                  SERIAL PRIMARY KEY,
    email               VARCHAR(255) UNIQUE NOT NULL,  -- retained for display; no FK
    user_id             INT UNIQUE REFERENCES users(id) ON DELETE SET NULL,  -- authoritative link
    monthly_prompt_tokens BIGINT NOT NULL DEFAULT 0,
    monthly_comp_tokens   BIGINT NOT NULL DEFAULT 0,
    cache_hit_ratio     NUMERIC(4,3) NOT NULL DEFAULT 0,
    batch_discount      NUMERIC(4,3) NOT NULL DEFAULT 0,
    primary_model_id    TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_profiles_email ON usage_profiles(email);
CREATE INDEX IF NOT EXISTS idx_usage_profiles_user_id ON usage_profiles(user_id);

-- 11. Endpoint Probe Telemetry (Pro) — live reliability & latency measurements
CREATE TABLE IF NOT EXISTS endpoint_telemetry (
    id                  BIGSERIAL PRIMARY KEY,
    model_id            TEXT NOT NULL,
    provider            TEXT NOT NULL,
    endpoint_url        TEXT,
    checked_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    online              BOOLEAN NOT NULL DEFAULT FALSE,
    http_status         INTEGER,
    p95_latency_ms      NUMERIC(10, 2),
    avg_latency_ms      NUMERIC(10, 2),
    tokens_per_sec      NUMERIC(10, 2),
    rate_limited        BOOLEAN NOT NULL DEFAULT FALSE,
    rate_limited_count  INTEGER NOT NULL DEFAULT 0,
    retry_after_sec     INTEGER,
    sample_count        INTEGER NOT NULL DEFAULT 0,
    is_free             BOOLEAN NOT NULL DEFAULT FALSE,
    free_tier_active    BOOLEAN,
    error               TEXT
);

CREATE INDEX IF NOT EXISTS idx_endpoint_telemetry_model_time ON endpoint_telemetry (model_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_endpoint_telemetry_checked_at ON endpoint_telemetry (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_endpoint_telemetry_provider ON endpoint_telemetry (provider);

-- 12. Budget Governance Rules (Enterprise) — per-scope spend guardrails
CREATE TABLE IF NOT EXISTS budget_rules (
    id                      SERIAL PRIMARY KEY,
    name                    VARCHAR(160) NOT NULL,
    scope                   VARCHAR(20) NOT NULL DEFAULT 'personal',  -- 'personal' | 'team'
    team_id                 INT REFERENCES teams(id) ON DELETE CASCADE,
    owner_email             VARCHAR(255) NOT NULL,  -- retained for display; no FK
    owner_user_id           INT REFERENCES users(id) ON DELETE SET NULL,  -- authoritative ownership
    monthly_budget_usd      NUMERIC(12, 2) NOT NULL CHECK (monthly_budget_usd > 0),
    alert_threshold_pct     NUMERIC(4, 3) NOT NULL DEFAULT 0.80,
      approval_required       BOOLEAN NOT NULL DEFAULT FALSE,
      hard_cap                BOOLEAN NOT NULL DEFAULT FALSE,
    notify_email            VARCHAR(255),
    active                  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budget_rules_owner ON budget_rules(owner_email);
CREATE INDEX IF NOT EXISTS idx_budget_rules_owner_user_id ON budget_rules(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_budget_rules_team ON budget_rules(team_id);
CREATE INDEX IF NOT EXISTS idx_budget_rules_active ON budget_rules(active);

-- 13. Budget Alert Emissions Log (Enterprise)
CREATE TABLE IF NOT EXISTS budget_alerts (
    id                      BIGSERIAL PRIMARY KEY,
    rule_id                 INT REFERENCES budget_rules(id) ON DELETE CASCADE,
    model_family            TEXT,
    projected_monthly_usd   NUMERIC(12, 2) NOT NULL DEFAULT 0,
    budget_usd              NUMERIC(12, 2) NOT NULL DEFAULT 0,
    pct_used                NUMERIC(6, 4) NOT NULL DEFAULT 0,
    alert_type              VARCHAR(20) NOT NULL,  -- 'threshold' | 'over_budget' | 'shadow_ai'
    message                 TEXT NOT NULL,
    acknowledged            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budget_alerts_rule_time ON budget_alerts (rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_budget_alerts_type ON budget_alerts (alert_type, created_at DESC);
CREATE TABLE IF NOT EXISTS shadow_ai_findings (
      id                    BIGSERIAL PRIMARY KEY,
      model_id              TEXT NOT NULL,
      scope                 VARCHAR(20) NOT NULL DEFAULT 'personal',
      team_id               INT REFERENCES teams(id) ON DELETE CASCADE,
      owner_email           VARCHAR(255) NOT NULL,
      owner_user_id         INT REFERENCES users(id) ON DELETE SET NULL,
      first_seen            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      estimated_monthly_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
      reason                TEXT NOT NULL DEFAULT '',
      status                VARCHAR(20) NOT NULL DEFAULT 'open',
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_shadow_personal
  ON shadow_ai_findings (model_id, owner_email) WHERE scope = 'personal';
CREATE UNIQUE INDEX IF NOT EXISTS ux_shadow_team
  ON shadow_ai_findings (model_id, team_id) WHERE scope = 'team';
CREATE INDEX IF NOT EXISTS idx_shadow_status_seen
  ON shadow_ai_findings (status, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_shadow_owner ON shadow_ai_findings (owner_email);

-- 14. Migration Switch Approvals (Enterprise) — guardrail over F3 recommendations
CREATE TABLE IF NOT EXISTS migration_approvals (
    id                      BIGSERIAL PRIMARY KEY,
    team_id                 INT REFERENCES teams(id) ON DELETE CASCADE,
    rule_id                 INT REFERENCES budget_rules(id) ON DELETE CASCADE,
    from_model_id           TEXT NOT NULL,
    to_model_id             TEXT NOT NULL,
    monthly_savings_usd     NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status                  VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
    requested_by            VARCHAR(255) NOT NULL,
    reviewed_by             VARCHAR(255),
    decision_at             TIMESTAMPTZ,
    quorum_required         INT NOT NULL DEFAULT 1 CHECK (quorum_required >= 1),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_migration_approvals_status ON migration_approvals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_migration_approvals_team ON migration_approvals (team_id);
-- One pending request per (rule, from, to): blocks duplicate-pending spam.
CREATE UNIQUE INDEX IF NOT EXISTS idx_migration_approvals_pending_dedup
  ON migration_approvals (rule_id, from_model_id, to_model_id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS approval_votes (
    id            BIGSERIAL PRIMARY KEY,
    approval_id   BIGINT NOT NULL REFERENCES migration_approvals(id) ON DELETE CASCADE,
    voter_email   VARCHAR(255) NOT NULL,
    voter_user_id INT REFERENCES users(id) ON DELETE SET NULL,
    decision      VARCHAR(20) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (approval_id, voter_email)
);
CREATE INDEX IF NOT EXISTS idx_approval_votes_approval
  ON approval_votes (approval_id);

-- 15. Processed Stripe webhook event ids (idempotency) — one row per
-- delivered event.id; the PK rejects re-deliveries (Stripe retries).
  CREATE TABLE IF NOT EXISTS processed_stripe_event_ids (
      event_id              TEXT PRIMARY KEY,
      event_type            VARCHAR(80),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- 16. FK orphan review queue (migration 012). Rows whose stored email
  -- matches no users row are recorded here instead of rotting as silent NULLs.
  CREATE TABLE IF NOT EXISTS fk_orphans (
      id            SERIAL PRIMARY KEY,
      tbl           VARCHAR(64) NOT NULL,
      row_id        VARCHAR(64) NOT NULL,
      email         VARCHAR(255),
      reason        VARCHAR(255) NOT NULL DEFAULT 'no matching users row',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tbl, row_id)
  );

  CREATE INDEX IF NOT EXISTS idx_fk_orphans_tbl ON fk_orphans(tbl);
