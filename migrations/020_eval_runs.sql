-- 020: BYO eval harness runs.
-- Users and teams record their own benchmark results per (suite, model);
-- the leaderboard aggregates means client-side of the DB (portable across
-- backends, small volumes). scores is a JSON object {metric: 0..100}
-- validated in the app layer. One row per submitted run (no dedup —
-- repeated runs are the sample).
CREATE TABLE IF NOT EXISTS eval_runs (
  id                BIGSERIAL PRIMARY KEY,
  suite             VARCHAR(120) NOT NULL,
  model_id          TEXT NOT NULL,
  scope             VARCHAR(20) NOT NULL DEFAULT 'personal',  -- 'personal' | 'team'
  team_id           INT REFERENCES teams(id) ON DELETE CASCADE,
  owner_email       VARCHAR(255) NOT NULL,
  owner_user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  scores            TEXT NOT NULL DEFAULT '{}',
  samples           INT NOT NULL DEFAULT 1 CHECK (samples >= 1),
  notes             TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_suite_model ON eval_runs (suite, model_id);
CREATE INDEX IF NOT EXISTS idx_eval_runs_team ON eval_runs (team_id);
CREATE INDEX IF NOT EXISTS idx_eval_runs_owner ON eval_runs (owner_email);
