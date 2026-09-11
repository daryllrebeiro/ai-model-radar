-- Audit follow-up (team invites replay): invite tokens are single-use.
-- The HMAC proves mint authority; this table proves non-consumption.
-- Redemption claims atomically (UPDATE ... WHERE consumed_at IS NULL);
-- replays, expired, and unknown tokens share one rejection (no oracle).
CREATE TABLE IF NOT EXISTS team_invites (
    id                  SERIAL PRIMARY KEY,
    team_id             INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    email               VARCHAR(255) NOT NULL,
    role                VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    token_hash          TEXT NOT NULL UNIQUE,
    created_by_email    VARCHAR(255) NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL,
    consumed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(team_id);
CREATE INDEX IF NOT EXISTS idx_team_invites_hash ON team_invites(token_hash);
