-- Migration 028: drift review queue (P3).
--
-- Human decision surface for S4 drift candidates. Stores ONLY diffs flagged
-- candidate_for_review, with full before/after text (evidence, not scores).
-- Status moves pending -> confirmed/dismissed by reviewer action only; no
-- automated verdict path exists by design.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS drift_reviews (
  id                SERIAL PRIMARY KEY,
  cycle_id          VARCHAR(64) NOT NULL,
  model_id          TEXT NOT NULL,
  prompt_id         VARCHAR(64) NOT NULL,
  prompt_version    INT NOT NULL DEFAULT 1,
  prev_output       TEXT NOT NULL DEFAULT '',
  curr_output       TEXT NOT NULL DEFAULT '',
  diff_lines        JSONB NOT NULL DEFAULT '[]',
  changed_lines     INT NOT NULL DEFAULT 0,
  status            VARCHAR(16) NOT NULL DEFAULT 'pending',
  reviewed_by       VARCHAR(255),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, model_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_drift_reviews_status ON drift_reviews(status, created_at DESC);
