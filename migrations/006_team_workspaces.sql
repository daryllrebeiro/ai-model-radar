-- Migration 006: Team Workspaces (Enterprise) — collaborative shared watchlists

CREATE TABLE IF NOT EXISTS teams (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    slug        VARCHAR(120) UNIQUE NOT NULL,
    owner_email VARCHAR(255) NOT NULL REFERENCES users(email),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_email);

CREATE TABLE IF NOT EXISTS team_members (
    id           SERIAL PRIMARY KEY,
    team_id      INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    member_email VARCHAR(255) NOT NULL,
    role         VARCHAR(20) NOT NULL DEFAULT 'member',  -- 'admin' | 'member'
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, member_email)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members(member_email);

CREATE TABLE IF NOT EXISTS team_watchlists (
    id             SERIAL PRIMARY KEY,
    team_id        INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    model_id       VARCHAR(255) NOT NULL,
    added_by_email VARCHAR(255) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_team_watchlists_team ON team_watchlists(team_id);