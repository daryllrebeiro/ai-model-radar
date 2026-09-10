-- R7 — Community savings leaderboard / case studies (Tier D).
-- Opt-in public sharing ONLY: status starts at 'pending' (moderation queue),
-- goes public only after explicit approval. consent_confirmed records the
-- separate per-submission public-sharing consent — private R5 usage is NEVER
-- consent to share. Takedown = owner DELETE or moderation 'removed'.
CREATE TABLE IF NOT EXISTS case_studies (
    id                  SERIAL PRIMARY KEY,
    user_id             INT REFERENCES users(id) ON DELETE SET NULL,
    owner_email         VARCHAR(255) NOT NULL,
    team_name           VARCHAR(120) NOT NULL DEFAULT '',
    from_model_id       TEXT NOT NULL,
    to_model_id         TEXT NOT NULL,
    savings_usd_per_month NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (savings_usd_per_month >= 0),
    period_label        VARCHAR(60) NOT NULL DEFAULT '',
    story               TEXT NOT NULL DEFAULT '',
    usage_import_id     INT REFERENCES usage_imports(id) ON DELETE SET NULL,
    consent_confirmed   BOOLEAN NOT NULL DEFAULT FALSE,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_studies_status ON case_studies(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_studies_user ON case_studies(user_id);
