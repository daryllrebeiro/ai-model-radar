import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createOrGetUser, createApiKey, createTeam, addTeamMember } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { GET as listTeamsRoute, POST as createTeamRoute } from '../src/app/api/teams/route';
import { GET as teamDetailRoute, PATCH as renameRoute, DELETE as deleteRoute } from '../src/app/api/teams/[teamId]/route';
import { POST as addMemberRoute, DELETE as removeMemberRoute } from '../src/app/api/teams/[teamId]/members/route';
import { GET as getWatchlistRoute, POST as addWatchlistRoute, DELETE as removeWatchlistRoute } from '../src/app/api/teams/[teamId]/watchlist/route';

afterEach(() => {
  delete process.env.FEATURE_ENFORCEMENT;
});

function authReq(path: string, method: string, key: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function createAuthedUser(tier: string, tag: string, email?: string) {
  const addr = email || `team_${tag}_${tier}_${Date.now()}@test.com`;
  const user = await createOrGetUser({ email: addr, tier });
  const { plaintextKey, keyRecord } = generateApiKey(user.email, 'production');
  await createApiKey(keyRecord);
  return { email: user.email, key: plaintextKey, user };
}

function teamParams(id: number) {
  return { params: { teamId: String(id) } };
}

describe('Phase 2.4: Team Workspaces (Enterprise)', () => {
  it('1. Teams list requires authentication (401)', async () => {
    const req = new NextRequest('http://localhost:3000/api/teams');
    const res = await listTeamsRoute(req);
    expect(res.status).toBe(401);
  });

  it('2. Enforcement ON: free user blocked from Team Workspaces (403)', async () => {
    process.env.FEATURE_ENFORCEMENT = 'true';
    const { key } = await createAuthedUser('free', 'blocked');
    const req = authReq('/api/teams', 'POST', key, { name: 'Ghosts' });
    const res = await createTeamRoute(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Upgrade required');
    expect(body.requiredTier).toBe('enterprise');
  });

  it('3. Enterprise-eligible user creates a team and becomes its admin', async () => {
    process.env.FEATURE_ENFORCEMENT = 'true';
    const { key } = await createAuthedUser('enterprise', 'owner');
    const req = authReq('/api/teams', 'POST', key, { name: 'Radar Core Team' });
    const res = await createTeamRoute(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.team.name).toBe('Radar Core Team');
    expect(body.team.members).toHaveLength(1);
    expect(body.team.members[0].role).toBe('admin');
    expect(body.team.members[0].member_email).toBe(body.team.owner_email);
  });

  it('4. Team detail visible to the owner; rejected for non-members', async () => {
    const owner = await createAuthedUser('enterprise', 'detail');
    const team = await createTeam('Detail Workspace', owner.email);

    const stranger = await createAuthedUser('enterprise', 'solo');
    const strangerRes = await teamDetailRoute(
      authReq(`/api/teams/${team.id}`, 'GET', stranger.key),
      teamParams(team.id)
    );
    expect(strangerRes.status).toBe(403);

    const ownerRes = await teamDetailRoute(
      authReq(`/api/teams/${team.id}`, 'GET', owner.key),
      teamParams(team.id)
    );
    expect(ownerRes.status).toBe(200);
    const body = await ownerRes.json();
    expect(body.team.id).toBe(team.id);
    expect(body.role).toBe('admin');
  });

  it('5. Admin invites a member; invited member appears in team detail', async () => {
    const owner = await createAuthedUser('enterprise', 'inviter');
    const team = await createTeam('Invite Workspace', owner.email);

    const addRes = await addMemberRoute(
      authReq(`/api/teams/${team.id}/members`, 'POST', owner.key, {
        email: 'collab@test.com',
        role: 'admin',
      }),
      teamParams(team.id)
    );
    expect(addRes.status).toBe(201);
    const addBody = await addRes.json();
    expect(addBody.members).toHaveLength(2);
    expect(addBody.member.role).toBe('admin');

    const collab = await createAuthedUser('enterprise', 'collab', 'collab@test.com');
    const viewRes = await teamDetailRoute(
      authReq(`/api/teams/${team.id}`, 'GET', collab.key),
      teamParams(team.id)
    );
    expect(viewRes.status).toBe(200);
    expect((await viewRes.json()).role).toBe('admin');
  });

  it('6. Non-admin members cannot manage team members (403)', async () => {
    const owner = await createAuthedUser('enterprise', 'plain');
    const team = await createTeam('Permission Workspace', owner.email);
    await addTeamMember(team.id, 'plainmember@test.com', 'member');
    const member = await createAuthedUser('enterprise', 'pmember', 'plainmember@test.com');

    const res = await addMemberRoute(
      authReq(`/api/teams/${team.id}/members`, 'POST', member.key, { email: 'x@test.com' }),
      teamParams(team.id)
    );
    expect(res.status).toBe(403);
  });

  it('7. Shared watchlist add / list / remove flows per team', async () => {
    const owner = await createAuthedUser('enterprise', 'wl');
    const team = await createTeam('Watchlist Workspace', owner.email);

    const addRes = await addWatchlistRoute(
      authReq(`/api/teams/${team.id}/watchlist`, 'POST', owner.key, { modelId: 'openai/gpt-4o' }),
      teamParams(team.id)
    );
    expect(addRes.status).toBe(200);
    expect((await addRes.json()).watchlist).toContain('openai/gpt-4o');

    const dupRes = await addWatchlistRoute(
      authReq(`/api/teams/${team.id}/watchlist`, 'POST', owner.key, { modelId: 'openai/gpt-4o' }),
      teamParams(team.id)
    );
    expect((await dupRes.json()).watchlist).toHaveLength(1);

    const getRes = await getWatchlistRoute(
      authReq(`/api/teams/${team.id}/watchlist`, 'GET', owner.key),
      teamParams(team.id)
    );
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).count).toBe(1);

    const delRes = await removeWatchlistRoute(
      authReq(
        `/api/teams/${team.id}/watchlist?modelId=${encodeURIComponent('openai/gpt-4o')}`,
        'DELETE',
        owner.key
      ),
      teamParams(team.id)
    );
    expect(delRes.status).toBe(200);
    expect((await delRes.json()).watchlist).toHaveLength(0);
  });

  it('8. Admin can rename; only the owner can delete the team', async () => {
    const owner = await createAuthedUser('enterprise', 'sudo');
    const team = await createTeam('Rename Workspace', owner.email);
    await addTeamMember(team.id, 'sudo-collab@test.com', 'member');

    const renameRes = await renameRoute(
      authReq(`/api/teams/${team.id}`, 'PATCH', owner.key, { name: 'Renamed Workspace' }),
      teamParams(team.id)
    );
    expect(renameRes.status).toBe(200);
    expect((await renameRes.json()).team.name).toBe('Renamed Workspace');

    const collab = await createAuthedUser('enterprise', 'scollab', 'sudo-collab@test.com');
    const deniedDelete = await deleteRoute(
      authReq(`/api/teams/${team.id}`, 'DELETE', collab.key),
      teamParams(team.id)
    );
    expect(deniedDelete.status).toBe(403);

    const deleteRes = await deleteRoute(
      authReq(`/api/teams/${team.id}`, 'DELETE', owner.key),
      teamParams(team.id)
    );
    expect(deleteRes.status).toBe(200);
    expect((await deleteRes.json()).deletedTeamId).toBe(team.id);
  });

  it('9. Owner cannot be removed from their own team (400)', async () => {
    const owner = await createAuthedUser('enterprise', 'ownerguard');
    const team = await createTeam('Owner Guard Workspace', owner.email);

    const removeRes = await removeMemberRoute(
      authReq(
        `/api/teams/${team.id}/members?email=${encodeURIComponent(owner.email)}`,
        'DELETE',
        owner.key
      ),
      teamParams(team.id)
    );
    expect(removeRes.status).toBe(400);
  });
});