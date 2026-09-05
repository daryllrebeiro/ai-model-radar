-- AI Model Radar Database Schema (PostgreSQL & SQLite compatible)

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
CREATE OR REPLACE VIEW model_current AS
SELECT s.*
FROM model_snapshots s
INNER JOIN (
    SELECT model_id, MAX(polled_at) AS max_polled_at
    FROM model_snapshots
    GROUP BY model_id
) latest ON s.model_id = latest.model_id AND s.polled_at = latest.max_polled_at;

-- 9. Team Workspaces (Enterprise) — collaborative shared watchlists
CREATE TABLE IF NOT EXISTS teams (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(120) NOT NULL,
    slug                VARCHAR(120) UNIQUE NOT NULL,
    owner_email         VARCHAR(255) NOT NULL REFERENCES users(email),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_email);

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
