-- 016: M-of-N quorum approvals for migration switches.
-- quorum_required on the request (default 1 = legacy single-decider path);
-- individual ballots in approval_votes, one per voter per request.
-- A request leaves 'pending' when approvals OR rejections reach quorum
-- (symmetric M-of-N: M rejections actively reject, abstentions don't block).
ALTER TABLE migration_approvals
  ADD COLUMN IF NOT EXISTS quorum_required INT NOT NULL DEFAULT 1
    CHECK (quorum_required >= 1);

CREATE TABLE IF NOT EXISTS approval_votes (
  id            BIGSERIAL PRIMARY KEY,
  approval_id   BIGINT NOT NULL REFERENCES migration_approvals(id) ON DELETE CASCADE,
  voter_email   VARCHAR(255) NOT NULL,
  voter_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  decision      VARCHAR(20) NOT NULL,  -- 'approved' | 'rejected'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (approval_id, voter_email)
);

CREATE INDEX IF NOT EXISTS idx_approval_votes_approval
  ON approval_votes (approval_id);
