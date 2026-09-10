-- R10 — Inference routing gateway (Tier F, separately gated).
-- Reliability-first telemetry: every proxied decision is logged here so the
-- successful-routing rate and latency overhead can be measured BEFORE usage
-- growth is treated as success. The pilot opt-in table records explicit
-- per-user consent — routing is deny-by-default (ROUTING_ENABLED + allowlist).
CREATE TABLE IF NOT EXISTS routing_attempts (
    id                  BIGSERIAL PRIMARY KEY,
    key_prefix          VARCHAR(64),
    owner_email_hash    VARCHAR(64),
    requested_model     TEXT NOT NULL,
    selected_model      TEXT NOT NULL,
    policy              VARCHAR(40) NOT NULL DEFAULT '',
    upstream_status     INT,
    latency_ms          INT,
    success             BOOLEAN NOT NULL,
    error               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routing_attempts_time ON routing_attempts(created_at DESC);

CREATE TABLE IF NOT EXISTS routing_pilot_optins (
    id                  SERIAL PRIMARY KEY,
    owner_email         VARCHAR(255) UNIQUE NOT NULL,
    approved            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
