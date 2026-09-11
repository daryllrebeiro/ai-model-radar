-- Migration 029: metric events sink (next-steps N1).
--
-- Success-metric sink for S surfaces (completions, votes, decisions). The
-- first threshold review found every metric at zero with no way to observe
-- otherwise; handlers now emit fire-and-forget rows and reviews read SUMs.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS metric_events (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(64) NOT NULL,
  value         INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metric_events_name_time ON metric_events(name, created_at DESC);
