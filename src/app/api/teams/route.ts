import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { getTeamsForUser, createTeam, getTeamDetail } from '@/lib/db/queries';
import { handleApiError } from '@/lib/api-error-handler';

export const dynamic = 'force-dynamic';

/**
 * GET /api/teams — list team workspaces the caller belongs to.
 * POST /api/teams — create a new team workspace (Enterprise, TEAM_MANAGEMENT).
 */
export async function GET(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'TEAM_MANAGEMENT');
    if (error) return error;

    const teams = await getTeamsForUser(session.user.email);
    return NextResponse.json({ teams, count: teams.length });
  } catch (err: any) {
    return handleApiError(err, 'teams GET');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'TEAM_MANAGEMENT');
    if (error) return error;

    const body = await request.json().catch(() => null);
    const name = body?.name;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Team name is required' }, { status: 400 });
    }
    if (name.trim().length > 120) {
      return NextResponse.json({ error: 'Team name must be 120 characters or fewer' }, { status: 400 });
    }

    const team = await createTeam(name.trim(), session.user.email);
    const detail = await getTeamDetail(team.id);
    return NextResponse.json({ team: detail }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'teams POST');
  }
}