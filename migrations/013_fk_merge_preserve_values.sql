-- Migration 013: apply the 012 merge-with-values fix to databases where the
-- original keep-lowest-id 012 already ran.
--
-- Background: 012 was corrected (same release cycle) so duplicate-variant
-- usage_profiles merges first copy the most recently updated duplicate's
-- data columns into the kept row. Databases that already applied the old
-- 012 may have (a) lost newer field values on merge, and (b) a drift flag,
-- since 012's file checksum changed. This migration replays the corrected
-- merge for any duplicate groups still present (no-op where 012 already
-- merged), re-runs the normalized backfill, and re-records orphans — all
-- idempotent. Rows whose newer values were already deleted by old-012
-- cannot be recovered by SQL; they are reported via fk_orphans only if
-- still unlinked, and the loss is documented here, not hidden.
--
-- Idempotent: safe to re-run.

-- 1. Merge-with-values for any remaining duplicate groups.
UPDATE usage_profiles AS kept SET
  monthly_prompt_tokens = src.monthly_prompt_tokens,
  monthly_comp_tokens = src.monthly_comp_tokens,
  cache_hit_ratio = src.cache_hit_ratio,
  batch_discount = src.batch_discount,
  primary_model_id = src.primary_model_id,
  updated_at = src.updated_at
FROM (
  SELECT DISTINCT ON (LOWER(TRIM(email)))
    LOWER(TRIM(email)) AS norm_email,
    monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio,
    batch_discount, primary_model_id, updated_at
  FROM usage_profiles
  ORDER BY LOWER(TRIM(email)), updated_at DESC, id DESC
) AS src
WHERE LOWER(TRIM(kept.email)) = src.norm_email
  AND EXISTS (
    SELECT 1 FROM usage_profiles AS other
    WHERE other.id <> kept.id
      AND LOWER(TRIM(other.email)) = src.norm_email
  );

DELETE FROM usage_profiles a
USING usage_profiles b
WHERE a.id > b.id
  AND LOWER(TRIM(a.email)) = LOWER(TRIM(b.email));

-- 2. Normalized backfill for still-NULL FKs.
UPDATE teams SET owner_user_id = u.id
FROM users u
WHERE teams.owner_user_id IS NULL
  AND LOWER(TRIM(teams.owner_email)) = LOWER(TRIM(u.email));

UPDATE budget_rules SET owner_user_id = u.id
FROM users u
WHERE budget_rules.owner_user_id IS NULL
  AND LOWER(TRIM(budget_rules.owner_email)) = LOWER(TRIM(u.email));

UPDATE usage_profiles SET user_id = u.id
FROM users u
WHERE usage_profiles.user_id IS NULL
  AND LOWER(TRIM(usage_profiles.email)) = LOWER(TRIM(u.email));

-- 3. Record remaining orphans durably (idempotent).
INSERT INTO fk_orphans (tbl, row_id, email, reason)
SELECT 'teams', id::TEXT, owner_email, 'no matching users row'
FROM teams WHERE owner_user_id IS NULL AND owner_email IS NOT NULL
ON CONFLICT (tbl, row_id) DO NOTHING;

INSERT INTO fk_orphans (tbl, row_id, email, reason)
SELECT 'budget_rules', id::TEXT, owner_email, 'no matching users row'
FROM budget_rules WHERE owner_user_id IS NULL AND owner_email IS NOT NULL
ON CONFLICT (tbl, row_id) DO NOTHING;

INSERT INTO fk_orphans (tbl, row_id, email, reason)
SELECT 'usage_profiles', id::TEXT, email, 'no matching users row'
FROM usage_profiles WHERE user_id IS NULL AND email IS NOT NULL
ON CONFLICT (tbl, row_id) DO NOTHING;
