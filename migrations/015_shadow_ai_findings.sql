-- 015: persistent Shadow-AI Discovery feed.
-- Findings are upserted per (model, scope key): first_seen is preserved
-- across runs while last_seen + spend estimate refresh. Partial unique
-- indexes scope identity: personal findings key on owner_email, team
-- findings key on team_id. Dismissed/acknowledged rows are never
-- re-opened by the discovery runner (status transitions are explicit).
CREATE TABLE IF NOT EXISTS shadow_ai_findings (
  id                    BIGSERIAL PRIMARY KEY,
  model_id              TEXT NOT NULL,
  scope                 VARCHAR(20) NOT NULL DEFAULT 'personal',  -- 'personal' | 'team'
  team_id               INT REFERENCES teams(id) ON DELETE CASCADE,
  owner_email           VARCHAR(255) NOT NULL,
  owner_user_id         INT REFERENCES users(id) ON DELETE SET NULL,
  first_seen            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estimated_monthly_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
  reason                TEXT NOT NULL DEFAULT '',
  status                VARCHAR(20) NOT NULL DEFAULT 'open',  -- 'open' | 'acknowledged' | 'dismissed'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_shadow_personal
  ON shadow_ai_findings (model_id, owner_email) WHERE scope = 'personal';
CREATE UNIQUE INDEX IF NOT EXISTS ux_shadow_team
  ON shadow_ai_findings (model_id, team_id) WHERE scope = 'team';
CREATE INDEX IF NOT EXISTS idx_shadow_status_seen
  ON shadow_ai_findings (status, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_shadow_owner ON shadow_ai_findings (owner_email);
