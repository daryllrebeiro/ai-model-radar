-- Migration 008: migrate FKs from users(email) to users(id)
-- The teams, budget_rules, and usage_profiles tables currently FK to
-- users(email) which is mutable. This migration backfills the user_id columns
-- (already present in baseline schema.sql), adds indexes, and drops the email FKs.
-- The email columns are retained for display purposes.

-- 1. Backfill user_id from email (columns already exist in baseline schema.sql)
UPDATE teams SET owner_user_id = u.id
FROM users u WHERE teams.owner_email = u.email;

UPDATE budget_rules SET owner_user_id = u.id
FROM users u WHERE budget_rules.owner_email = u.email;

UPDATE usage_profiles SET user_id = u.id
FROM users u WHERE usage_profiles.email = u.email;

-- 2. Add indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_teams_owner_user_id ON teams(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_budget_rules_owner_user_id ON budget_rules(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_usage_profiles_user_id ON usage_profiles(user_id);

-- 3. Drop the old email FK constraints (keep the email columns for display)
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_owner_email_fkey;
ALTER TABLE budget_rules DROP CONSTRAINT IF EXISTS budget_rules_owner_email_fkey;
ALTER TABLE usage_profiles DROP CONSTRAINT IF EXISTS usage_profiles_email_fkey;

-- Note: The email columns are kept for display/backwards compatibility.
-- New code should use owner_user_id / user_id for joins and ownership checks.