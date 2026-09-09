import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { getTeam, getTeamRole, addTeamMember, removeTeamMember, getTeamMembers } from '@/lib/db/queries';
import { handleApiError } from '@/lib/api-error-handler';
import { teamMemberAddSchema, teamMemberRemoveSchema } from '@/lib/validation/api-schemas';

export const dynamic = 'force-dynamic';

function parseTeamId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * POST /api/teams/:teamId/members — add member by email (admin only).
 * DELETE /api/teams/:teamId/members — remove member by email (admin only).
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
      return NextResponse.json({ error: 'Only team admins can manage members' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const parsed = teamMemberAddSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'A valid member email is required',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        { status: 400 }
      );
    }
    // Membership is keyed by email: a bare userId cannot be resolved to an
    // address here, so it is rejected with the same 400 as a missing email.
    const email = parsed.data.email;
    if (!email) {
      return NextResponse.json({ error: 'A valid member email is required' }, { status: 400 });
    }

    const memberRole = parsed.data.role ?? 'member';
    if (memberRole === 'admin') {
      // Granting admin is ownership transfer-grade: team owner only. Any-admin
      // approval would let one compromised admin mint infinite admins.
      const team = await getTeam(teamId);
      if (!team || team.owner_email.toLowerCase() !== session.user.email.toLowerCase()) {
        return NextResponse.json({ error: 'Only the team owner can grant the admin role' }, { status: 403 });
      }
    }
    const member = await addTeamMember(teamId, email.trim(), memberRole);
    const members = await getTeamMembers(teamId);
    return NextResponse.json({ member, members }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'teams/:id/members POST');
  }
}

export async function DELETE(
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

    const adminRole = await getTeamRole(teamId, session.user.email);
    if (adminRole !== 'admin') {
      return NextResponse.json({ error: 'Only team admins can manage members' }, { status: 403 });
    }

    const team = await getTeam(teamId);
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    const rawEmail = request.nextUrl.searchParams.get('email');
    const parsedQuery = teamMemberRemoveSchema.safeParse({ email: rawEmail });
    if (!parsedQuery.success || !parsedQuery.data.email) {
      return NextResponse.json({ error: 'A valid member email is required' }, { status: 400 });
    }
    const email = parsedQuery.data.email;

    if (email.trim().toLowerCase() === team.owner_email.toLowerCase()) {
      return NextResponse.json({ error: 'The team owner cannot be removed' }, { status: 400 });
    }

    const removed = await removeTeamMember(teamId, email.trim());
    if (!removed) {
      return NextResponse.json({ error: 'Member not found in this team' }, { status: 404 });
    }
    const members = await getTeamMembers(teamId);
    return NextResponse.json({ success: true, removedEmail: email.trim(), members });
  } catch (err: any) {
    return handleApiError(err, 'teams/:id/members DELETE');
  }
}