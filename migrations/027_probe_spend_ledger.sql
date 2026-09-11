-- Migration 027: probe spend ledger (P1-1).
--
-- Accounting for paid active-probe cycles (S4+S5 drift + latency). The cycle
-- budget was previously a constant with no runtime witness; every paid cycle
-- now leaves one ledger row per model so spend alerts and the
-- ACTIVE_PROBE_ENABLED kill switch read real data instead of trusting config.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS probe_spend_ledger (
  id            SERIAL PRIMARY KEY,
  cycle_id      VARCHAR(64) NOT NULL,
  model_id      TEXT NOT NULL,
  provider      VARCHAR(64) NOT NULL DEFAULT '',
  calls         INT NOT NULL DEFAULT 0,
  errors        INT NOT NULL DEFAULT 0,
  est_tokens    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_probe_spend_time ON probe_spend_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_probe_spend_cycle ON probe_spend_ledger(cycle_id);
