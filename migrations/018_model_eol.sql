-- 018: model EOL registry.
-- Teams register announced retirement dates for models they depend on;
-- the tracker reports countdown status (active / approaching <= 90d /
-- expired) alongside removals actually observed in the event stream.
-- One row per model: re-announcements update the existing row.
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
