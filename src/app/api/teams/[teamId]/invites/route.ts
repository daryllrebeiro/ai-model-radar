import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { getTeamRole, getTeam, createTeamInvite } from '@/lib/db/queries';
import { handleApiError } from '@/lib/api-error-handler';
import { createInviteToken, INVITE_TTL_MS } from '@/lib/team-invites';
import { hashInviteToken } from '@/lib/db/team-invites';

export const dynamic = 'force-dynamic';

function parseTeamId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * POST /api/teams/:teamId/invites — mint an expiring invite token (admin
 * only). Admin grants additionally require team ownership, mirroring the
 * members route (one compromised admin must not mint infinite admins).
 * Body: { email, role?: member|admin }.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { teamId: string | string[] } }
) {
  try {
    const { session, error } = await requireFeature(request, 'TEAM_MANAGEMENT');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'teams');
    if (limited) return limited;

    const teamId = parseTeamId(params.teamId);
    if (!teamId) {
      return NextResponse.json({ error: 'Invalid team id' }, { status: 400 });
    }
    const role = await getTeamRole(teamId, session.user.email);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Only team admins can invite members' }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'A valid invitee email is required' }, { status: 400 });
    }
    const wantAdmin = body?.role === 'admin';
    if (wantAdmin) {
      const team = await getTeam(teamId);
      if (!team || team.owner_email.toLowerCase() !== session.user.email.toLowerCase()) {
        return NextResponse.json({ error: 'Only the team owner can invite admins' }, { status: 403 });
      }
    }
    let token: string;
    try {
      token = createInviteToken({ teamId, email, role: wantAdmin ? 'admin' : 'member' });
      // Ledger the mint for single-use redemption (atomic claim on join).
      await createTeamInvite({
        teamId,
        email,
        role: wantAdmin ? 'admin' : 'member',
        tokenHash: hashInviteToken(token),
        createdByEmail: session.user.email,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      });
    } catch (err: any) {
      return NextResponse.json({ error: err.message || 'Invite signing unavailable' }, { status: 503 });
    }
    return NextResponse.json({ invite_token: token, team_id: teamId, email, role: wantAdmin ? 'admin' : 'member' }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'teams/:id/invites POST');
  }
}
