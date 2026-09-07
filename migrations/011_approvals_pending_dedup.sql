-- Migration 011: prevent duplicate pending migration approvals.
--
-- createMigrationApproval allowed unlimited identical pending rows for the
-- same (rule, from, to). One pending request per triple; decided rows
-- (approved/rejected) are unaffected so re-requests after a decision work.
-- Idempotent: safe to re-run (IF NOT EXISTS).

CREATE UNIQUE INDEX IF NOT EXISTS idx_migration_approvals_pending_dedup
  ON migration_approvals (rule_id, from_model_id, to_model_id) WHERE status = 'pending';
