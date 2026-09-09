import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { getTeamsForUser, createTeam, getTeamDetail } from '@/lib/db/queries';
import { handleApiError } from '@/lib/api-error-handler';
import { teamCreateSchema } from '@/lib/validation/api-schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /api/teams — list team workspaces the caller belongs to.
 * POST /api/teams — create a new team workspace (Enterprise, TEAM_MANAGEMENT).
 */
export async function GET(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'TEAM_MANAGEMENT');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'teams');
    if (limited) return limited;

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

    const limited = await checkSessionRateLimit(session.user.id, 'teams');
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const parsed = teamCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Team name is required',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        { status: 400 }
      );
    }

    const team = await createTeam(parsed.data.name, session.user.email);
    const detail = await getTeamDetail(team.id);
    return NextResponse.json({ team: detail }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'teams POST');
  }
}