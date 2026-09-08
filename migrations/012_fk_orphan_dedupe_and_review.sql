-- Migration 012: harden the users(id) FK backfill against duplicate variants.
--
-- Problem (found by adversarial audit): if two usage_profiles rows hold
-- case/whitespace variants of one address (e.g. 'Foo@x' and ' foo@x '),
-- the normalized backfill in 009 maps both to the same users.id and the
-- second UPDATE aborts on usage_profiles_user_id_key. The file-level
-- transaction rolls back (loud, no silent corruption), but the migration
-- can never complete while the duplicates exist.
--
-- This migration, in order:
--   1. Creates fk_orphans, a durable review table for rows that cannot be
--      matched to a user (replaces server-log-only RAISE WARNING).
--   2. Merges duplicate-variant usage_profiles rows: data columns of the
--      kept (lowest-id) row are first overwritten with the most recently
--      updated duplicate's values, then higher-id duplicates are deleted
--      (usage_profiles has no child tables, so no repointing is needed).
--   3. Re-runs the normalized backfill for still-NULL FKs (teams,
--      budget_rules, usage_profiles).
--   4. Records any still-unmatchable rows in fk_orphans (idempotent via
--      ON CONFLICT) instead of leaving silent NULLs.
--
-- Idempotent: re-running changes nothing once healed.

-- 1. Durable orphan review table.
CREATE TABLE IF NOT EXISTS fk_orphans (
  id            SERIAL PRIMARY KEY,
  tbl           VARCHAR(64) NOT NULL,
  row_id        VARCHAR(64) NOT NULL,
  email         VARCHAR(255),
  reason        VARCHAR(255) NOT NULL DEFAULT 'no matching users row',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tbl, row_id)
);
CREATE INDEX IF NOT EXISTS idx_fk_orphans_tbl ON fk_orphans(tbl);

-- 2. Merge duplicate-variant profiles. The kept row is the lowest id per
-- normalized email, BUT its data columns are first overwritten with the
-- most recently updated duplicate's values — a newer row may carry fields
-- the older row never had, and deleting it outright would silently drop
-- real data (adversarial audit gate rule 3). usage_profiles has no child
-- tables, so no FK repointing is needed.
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

-- 3. Normalized backfill for still-NULL FKs.
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

-- 4. Record remaining orphans durably (idempotent: skip already-recorded).
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
