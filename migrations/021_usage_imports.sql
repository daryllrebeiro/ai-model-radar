-- R5 — Real usage import & spend reconciliation (Tier C).
-- Private per-user spend data: scoped by user_id, user-deletable, NEVER
-- aggregated into leaderboards without separate explicit consent (see R7
-- case_studies.consent_confirmed, which is a different opt-in entirely).
CREATE TABLE IF NOT EXISTS usage_imports (
    id                  SERIAL PRIMARY KEY,
    user_id             INT REFERENCES users(id) ON DELETE CASCADE,
    owner_email         VARCHAR(255) NOT NULL,
    source              VARCHAR(40) NOT NULL DEFAULT 'csv',
    filename            VARCHAR(255) NOT NULL DEFAULT '',
    period_start        DATE,
    period_end          DATE,
    row_count           INT NOT NULL DEFAULT 0 CHECK (row_count >= 0),
    total_spend_usd     NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (total_spend_usd >= 0),
    rows_json           JSONB NOT NULL DEFAULT '[]',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_imports_user ON usage_imports(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_imports_owner ON usage_imports(owner_email);
