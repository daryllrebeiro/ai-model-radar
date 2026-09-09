-- 019: SSO identity linkage + SCIM deprovisioning on users.
-- sso_subject/sso_issuer record the upstream IdP identity for JIT-linked
-- accounts (one IdP active at a time; re-link overwrites). deprovisioned
-- marks SCIM-deactivated accounts: sign-in is refused and API keys are
-- revoked at deactivation time (revocation itself is the enforcement;
-- this flag is the auditable state).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sso_subject TEXT,
  ADD COLUMN IF NOT EXISTS sso_issuer TEXT,
  ADD COLUMN IF NOT EXISTS deprovisioned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_sso_subject ON users (sso_subject);
