import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import {
  getTeam,
  getTeamRole,
  getTeamDetail,
  renameTeam,
  deleteTeam,
} from '@/lib/db/queries';
import { handleApiError } from '@/lib/api-error-handler';

export const dynamic = 'force-dynamic';

function parseTeamId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * GET /api/teams/:teamId — team detail (members + shared watchlist).
 * PATCH /api/teams/:teamId — rename (owner or admin).
 * DELETE /api/teams/:teamId — delete (owner only).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { teamId: string | string[] } }
) {
  try {
    const { session, error } = await requireFeature(request, 'TEAM_MANAGEMENT');
    if (error) return error;

    const teamId = parseTeamId(params.teamId);
    if (!teamId) {
      return NextResponse.json({ error: 'Invalid team id' }, { status: 400 });
    }

    const role = await getTeamRole(teamId, session.user.email);
    if (!role) {
      return NextResponse.json({ error: 'Not a member of this team' }, { status: 403 });
    }

    const detail = await getTeamDetail(teamId);
    if (!detail) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    return NextResponse.json({ team: detail, role });
  } catch (err: any) {
    return handleApiError(err, 'teams/:id GET');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { teamId: string | string[] } }
) {
  try {
    const { session, error } = await requireFeature(request, 'TEAM_MANAGEMENT');
    if (error) return error;

    const teamId = parseTeamId(params.teamId);
    if (!teamId) {
      return NextResponse.json({ error: 'Invalid team id' }, { status: 400 });
    }

    const role = await getTeamRole(teamId, session.user.email);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Only team admins can rename the workspace' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const name = body?.name;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Team name is required' }, { status: 400 });
    }

    const updated = await renameTeam(teamId, name.trim());
    if (!updated) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    return NextResponse.json({ team: updated });
  } catch (err: any) {
    return handleApiError(err, 'teams/:id PATCH');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { teamId: string | string[] } }
) {
  try {
    const { session, error } = await requireFeature(request, 'TEAM_MANAGEMENT');
    if (error) return error;

    const teamId = parseTeamId(params.teamId);
    if (!teamId) {
      return NextResponse.json({ error: 'Invalid team id' }, { status: 400 });
    }

    const team = await getTeam(teamId);
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    if (team.owner_email.toLowerCase() !== session.user.email.toLowerCase()) {
      return NextResponse.json({ error: 'Only the team owner can delete the workspace' }, { status: 403 });
    }

    await deleteTeam(teamId);
    return NextResponse.json({ success: true, deletedTeamId: teamId });
  } catch (err: any) {
    return handleApiError(err, 'teams/:id DELETE');
  }
}