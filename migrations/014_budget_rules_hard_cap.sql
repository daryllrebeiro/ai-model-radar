-- 014: hard-cap enforcement flag for budget rules.
-- Rules with hard_cap = TRUE trip the Spend Circuit Breaker: when the
-- projected monthly spend reaches 100% of monthly_budget_usd, proxied
-- Radar Router calls for the rule's scope are rejected with 429 until
-- the next calendar month. Defaults to FALSE (alert-only, legacy behavior).
ALTER TABLE budget_rules
  ADD COLUMN IF NOT EXISTS hard_cap BOOLEAN NOT NULL DEFAULT FALSE;
