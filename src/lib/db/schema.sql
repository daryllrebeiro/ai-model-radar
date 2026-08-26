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

-- 6. Current-state view for quick reads
CREATE VIEW IF NOT EXISTS model_current AS
SELECT s.*
FROM model_snapshots s
INNER JOIN (
    SELECT model_id, MAX(polled_at) AS max_polled_at
    FROM model_snapshots
    GROUP BY model_id
) latest ON s.model_id = latest.model_id AND s.polled_at = latest.max_polled_at;
