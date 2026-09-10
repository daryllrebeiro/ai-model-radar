-- R6 — Compound alert rule builder (Tier C).
-- Fixed, safe condition set combined with AND/OR. Conditions are validated
-- strictly in code (src/lib/compound-rules.ts) — no expression language,
-- no eval. Delivery reuses the existing webhook/email channels.
CREATE TABLE IF NOT EXISTS compound_rules (
    id                  SERIAL PRIMARY KEY,
    user_id             INT REFERENCES users(id) ON DELETE CASCADE,
    owner_email         VARCHAR(255) NOT NULL,
    name                VARCHAR(120) NOT NULL,
    logic               VARCHAR(3) NOT NULL DEFAULT 'and' CHECK (logic IN ('and', 'or')),
    conditions          JSONB NOT NULL DEFAULT '[]',
    channel             VARCHAR(20) NOT NULL DEFAULT 'webhook' CHECK (channel IN ('webhook', 'email')),
    destination         TEXT NOT NULL,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compound_rules_user ON compound_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_compound_rules_active ON compound_rules(active);
