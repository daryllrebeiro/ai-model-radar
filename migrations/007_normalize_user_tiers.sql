-- Migration 007: normalize user tiers to the canonical access vocabulary.
--
-- API keys speak free/developer/production while feature flags speak
-- free/pro/enterprise. Rows created via API-key auth before the
-- normalizeTier() cutover may carry raw key-vocabulary values, which
-- hasAccess() denies outright once FEATURE_ENFORCEMENT is on.
-- This backfill rewrites known raw values (case-insensitive) to their
-- canonical equivalents. Unknown values are intentionally left alone:
-- normalizeTier() treats them as 'free' at runtime, and silently
-- rewriting unrecognized data would destroy information.
-- Idempotent: re-running changes zero rows.

UPDATE users SET tier = 'pro', updated_at = NOW()
WHERE LOWER(tier) = 'developer' AND tier <> 'pro';

UPDATE users SET tier = 'enterprise', updated_at = NOW()
WHERE LOWER(tier) = 'production' AND tier <> 'enterprise';

UPDATE users SET tier = 'free', updated_at = NOW()
WHERE LOWER(tier) IN ('anonymous', 'none', 'default') AND tier <> 'free';
