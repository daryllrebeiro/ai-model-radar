import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { addTeamMember, getTeam } from '@/lib/db/queries';
import { handleApiError } from '@/lib/api-error-handler';
import { verifyInviteToken } from '@/lib/team-invites';
import { claimTeamInvite, hashInviteToken } from '@/lib/db/team-invites';

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
    // Single-use: atomic ledger claim. Replays, expired, and unknown tokens
    // share one rejection (no oracle). The LEDGER row — not the token —
    // is authoritative for team/role, so a crafted payload can never
    // escalate even if signature verification were ever bypassed.
    const claimed = await claimTeamInvite(hashInviteToken(token));
    if (!claimed || claimed.team_id !== invite.teamId || claimed.email !== invite.email) {
      return NextResponse.json({ error: 'Invalid or expired invite token' }, { status: 400 });
    }
    const team = await getTeam(claimed.team_id);
    if (!team) {
      return NextResponse.json({ error: 'Team no longer exists' }, { status: 404 });
    }
    const member = await addTeamMember(claimed.team_id, claimed.email, claimed.role);
    return NextResponse.json({ member, team_id: claimed.team_id }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'teams/join POST');
  }
}
