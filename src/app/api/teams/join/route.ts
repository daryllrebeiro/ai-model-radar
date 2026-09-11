import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { addTeamMember, getTeam } from '@/lib/db/queries';
import { handleApiError } from '@/lib/api-error-handler';
import { verifyInviteToken } from '@/lib/team-invites';

export const dynamic = 'force-dynamic';

/**
 * POST /api/teams/join — redeem an invite token. The caller's session email
 * must match the invited email (tokens are non-transferable). No new table:
 * authority lives in the HMAC signature + expiry.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const limited = await checkSessionRateLimit(session.user.id, 'teams-join');
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const token = typeof body?.token === 'string' ? body.token : '';
    const invite = verifyInviteToken(token);
    if (!invite) {
      return NextResponse.json({ error: 'Invalid or expired invite token' }, { status: 400 });
    }
    if (invite.email !== session.user.email.toLowerCase()) {
      return NextResponse.json({ error: 'Invite is bound to a different email' }, { status: 403 });
    }
    const team = await getTeam(invite.teamId);
    if (!team) {
      return NextResponse.json({ error: 'Team no longer exists' }, { status: 404 });
    }
    const member = await addTeamMember(invite.teamId, invite.email, invite.role);
    return NextResponse.json({ member, team_id: invite.teamId }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'teams/join POST');
  }
}
