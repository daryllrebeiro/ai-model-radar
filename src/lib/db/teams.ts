/**
 * Team workspaces: teams, memberships with roles, shared watchlists,
 * team detail aggregation.
 * Split out of queries.ts (god-module remediation) - same logic, new home.
 */
import { Team, TeamMember, TeamRole, TeamDetail } from '@/types/teams';
import { isPostgres, getPgPool, getLocalState, saveLocalState } from './client';
import { getUserByEmail } from './users';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return base || `team-${Date.now().toString(36)}`;
}

/**
 * Creates a team and adds the owner as an admin member.
 */
export async function createTeam(name: string, ownerEmail: string): Promise<Team> {
  const slug = slugify(name);
  const now = new Date().toISOString();
  const normalizedEmail = ownerEmail.trim().toLowerCase();

    if (isPostgres()) {
      const pool = getPgPool();
      // Look up the user's id for the authoritative owner_user_id FK
      const user = await getUserByEmail(normalizedEmail);
      const ownerUserId = user?.id || null;

      // Single transaction: a crash between the two inserts must not leave
      // an orphan team with no admin member (owner locked out).
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `INSERT INTO teams (name, slug, owner_email, owner_user_id, created_at)
           VALUES ($1, $2, $3, $4, NOW())
           RETURNING *`,
          [name, slug, normalizedEmail, ownerUserId]
        );
        const team = inserted.rows[0];
        await client.query(
          `INSERT INTO team_members (team_id, member_email, role, created_at)
           VALUES ($1, $2, 'admin', NOW())
           ON CONFLICT (team_id, member_email) DO NOTHING`,
          [team.id, normalizedEmail]
        );
        await client.query('COMMIT');
        return team;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
    const state = getLocalState();
    if (!state.teams) state.teams = [];
    // Local backend: find user by email to get their id
    const user = (state.users || []).find((u: any) => u.email === normalizedEmail);
    const ownerUserId = user?.id || null;
    const team: Team = {
      id: state.teams.length + 1,
      name,
      slug,
      owner_email: normalizedEmail,
      owner_user_id: ownerUserId,
      created_at: now,
    };
    state.teams.push(team);
    if (!state.team_members) state.team_members = [];
    state.team_members.push({
      id: state.team_members.length + 1,
      team_id: team.id,
      member_email: normalizedEmail,
      role: 'admin',
      created_at: now,
    });
    saveLocalState(state);
    return team;
  }
}

/**
 * Lists teams the user can access (as owner or member).
 */
export async function getTeamsForUser(email: string, limit = 500): Promise<Team[]> {
  const normalized = email.toLowerCase().trim();
  const max = Math.min(5000, Math.max(1, Math.floor(limit)));
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT DISTINCT t.*
       FROM teams t
       LEFT JOIN team_members m ON m.team_id = t.id AND m.member_email = $1
       WHERE t.owner_email = $1 OR m.member_email = $1
       ORDER BY t.created_at DESC
       LIMIT $2`,
      [normalized, max]
    );
    return res.rows;
  } else {
    const state = getLocalState();
    const memberTeamIds = new Set(
      (state.team_members || [])
        .filter((m: any) => m.member_email === normalized)
        .map((m: any) => m.team_id)
    );
    return (state.teams || [])
      .filter((t: any) => t.owner_email === normalized || memberTeamIds.has(t.id))
      .slice(0, max);
  }
}

/**
 * Gets a single team by id.
 */
export async function getTeam(teamId: number): Promise<Team | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`SELECT * FROM teams WHERE id = $1`, [teamId]);
    return res.rows[0] || null;
  } else {
    const state = getLocalState();
    return (state.teams || []).find((t: any) => t.id === teamId) || null;
  }
}

/**
 * Resolves the caller's role within a team, or null when not a member.
 */
export async function getTeamRole(teamId: number, email: string): Promise<TeamRole | null> {
  const normalized = email.toLowerCase().trim();
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT role FROM team_members WHERE team_id = $1 AND member_email = $2`,
      [teamId, normalized]
    );
    if (res.rows.length > 0) return res.rows[0].role as TeamRole;
  } else {
    const state = getLocalState();
    const member = (state.team_members || []).find(
      (m: any) => m.team_id === teamId && m.member_email === normalized
    );
    if (member) return member.role as TeamRole;
  }
  return null;
}

/**
 * Adds (or re-activates) a member in a team workspace.
 */
export async function addTeamMember(
  teamId: number,
  memberEmail: string,
  role: TeamRole = 'member'
): Promise<TeamMember> {
  const normalized = memberEmail.toLowerCase().trim();
  const now = new Date().toISOString();

  if (isPostgres()) {
    const pool = getPgPool();
    const inserted = await pool.query(
      `INSERT INTO team_members (team_id, member_email, role, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (team_id, member_email) DO UPDATE SET role = EXCLUDED.role
       RETURNING *`,
      [teamId, normalized, role]
    );
    return inserted.rows[0];
  } else {
    const state = getLocalState();
    if (!state.team_members) state.team_members = [];
    const existing = state.team_members.find(
      (m: any) => m.team_id === teamId && m.member_email === normalized
    );
    if (existing) {
      existing.role = role;
      saveLocalState(state);
      return existing;
    }
    const member: TeamMember = {
      id: state.team_members.length + 1,
      team_id: teamId,
      member_email: normalized,
      role,
      created_at: now,
    };
    state.team_members.push(member);
    saveLocalState(state);
    return member;
  }
}

/**
 * Removes a member from a team workspace.
 */
export async function removeTeamMember(teamId: number, memberEmail: string): Promise<boolean> {
  const normalized = memberEmail.toLowerCase().trim();
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `DELETE FROM team_members WHERE team_id = $1 AND member_email = $2`,
      [teamId, normalized]
    );
    return (res.rowCount || 0) > 0;
  } else {
    const state = getLocalState();
    const before = (state.team_members || []).length;
    state.team_members = (state.team_members || []).filter(
      (m: any) => !(m.team_id === teamId && m.member_email === normalized)
    );
    saveLocalState(state);
    return state.team_members.length < before;
  }
}

/**
 * Lists members of a team.
 */
export async function getTeamMembers(teamId: number): Promise<TeamMember[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT * FROM team_members WHERE team_id = $1 ORDER BY created_at ASC`,
      [teamId]
    );
    return res.rows;
  } else {
    const state = getLocalState();
    return (state.team_members || [])
      .filter((m: any) => m.team_id === teamId)
      .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));
  }
}

/**
 * Renames a team (slug preserved).
 */
export async function renameTeam(teamId: number, newName: string): Promise<Team | null> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `UPDATE teams SET name = $1 WHERE id = $2 RETURNING *`,
      [newName, teamId]
    );
    return res.rows[0] || null;
  } else {
    const state = getLocalState();
    const team = (state.teams || []).find((t: any) => t.id === teamId);
    if (team) {
      team.name = newName;
      saveLocalState(state);
    }
    return team || null;
  }
}

/**
 * Deletes a team and all cascaded members/shared watchlists.
 */
export async function deleteTeam(teamId: number): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
    return (res.rowCount || 0) > 0;
  } else {
    const state = getLocalState();
    const before = (state.teams || []).length;
    state.teams = (state.teams || []).filter((t: any) => t.id !== teamId);
    state.team_members = (state.team_members || []).filter((m: any) => m.team_id !== teamId);
    state.team_watchlists = (state.team_watchlists || []).filter((w: any) => w.team_id !== teamId);
    saveLocalState(state);
    return state.teams.length < before;
  }
}

/**
 * Fetches shared watchlist model IDs for a team.
 */
export async function getTeamWatchlist(teamId: number): Promise<string[]> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `SELECT model_id FROM team_watchlists WHERE team_id = $1 ORDER BY created_at DESC`,
      [teamId]
    );
    return res.rows.map((r: any) => r.model_id);
  } else {
    const state = getLocalState();
    return (state.team_watchlists || [])
      .filter((w: any) => w.team_id === teamId)
      .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
      .map((w: any) => w.model_id);
  }
}

/**
 * Adds a model to the team's shared watchlist.
 */
export async function addToTeamWatchlist(
  teamId: number,
  modelId: string,
  addedByEmail: string
): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    await pool.query(
      `INSERT INTO team_watchlists (team_id, model_id, added_by_email, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (team_id, model_id) DO NOTHING`,
      [teamId, modelId, addedByEmail]
    );
    return true;
  } else {
    const state = getLocalState();
    if (!state.team_watchlists) state.team_watchlists = [];
    const exists = state.team_watchlists.some(
      (w: any) => w.team_id === teamId && w.model_id === modelId
    );
    if (!exists) {
      state.team_watchlists.push({
        id: state.team_watchlists.length + 1,
        team_id: teamId,
        model_id: modelId,
        added_by_email: addedByEmail,
        created_at: new Date().toISOString(),
      });
      saveLocalState(state);
    }
    return true;
  }
}

/**
 * Removes a model from the team's shared watchlist.
 */
export async function removeFromTeamWatchlist(teamId: number, modelId: string): Promise<boolean> {
  if (isPostgres()) {
    const pool = getPgPool();
    const res = await pool.query(
      `DELETE FROM team_watchlists WHERE team_id = $1 AND model_id = $2`,
      [teamId, modelId]
    );
    return (res.rowCount || 0) > 0;
  } else {
    const state = getLocalState();
    const before = (state.team_watchlists || []).length;
    state.team_watchlists = (state.team_watchlists || []).filter(
      (w: any) => !(w.team_id === teamId && w.model_id === modelId)
    );
    saveLocalState(state);
    return state.team_watchlists.length < before;
  }
}

/**
 * Full team detail: members + shared watchlist.
 */
export async function getTeamDetail(teamId: number): Promise<TeamDetail | null> {
  const team = await getTeam(teamId);
  if (!team) return null;
  const [members, sharedWatchlist] = await Promise.all([
    getTeamMembers(teamId),
    getTeamWatchlist(teamId),
  ]);
  return { ...team, members, sharedWatchlist };
}
