-- Migration 009: heal FK backfill orphans left by 008.
--
-- 008 used an exact case-sensitive email match, so rows whose stored email
-- differed in case or surrounding whitespace from users.email (or pointed at
-- a deleted/nonexistent user) were silently left with NULL user FKs.
-- This migration re-backfills ONLY still-NULL rows using a normalized match,
-- then loudly reports any rows that still cannot be matched so they get
-- manual review instead of becoming silent orphans.
--
-- Idempotent: re-running matches zero rows and reports the same orphans.

-- 1. Re-backfill NULL FK rows with normalized (trimmed, case-insensitive) match.
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

-- 2. Report any rows that still cannot be matched. These stay NULL
-- deliberately (the FK columns are nullable) and must be reviewed manually.
DO $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT 'teams' AS tbl, id::TEXT AS row_id, owner_email AS email
      FROM teams WHERE owner_user_id IS NULL AND owner_email IS NOT NULL
    UNION ALL
    SELECT 'budget_rules' AS tbl, id::TEXT AS row_id, owner_email AS email
      FROM budget_rules WHERE owner_user_id IS NULL AND owner_email IS NOT NULL
    UNION ALL
    SELECT 'usage_profiles' AS tbl, id::TEXT AS row_id, email AS email
      FROM usage_profiles WHERE user_id IS NULL AND email IS NOT NULL
  LOOP
    n := n + 1;
    RAISE WARNING 'migration 009 orphan: %.id=% email=% has no matching users row; left NULL for manual review',
      r.tbl, r.row_id, r.email;
  END LOOP;
  IF n > 0 THEN
    RAISE NOTICE 'migration 009: % orphan row(s) left NULL (see warnings above)', n;
  ELSE
    RAISE NOTICE 'migration 009: no orphan rows; all user FKs resolved';
  END IF;
END $$;
