import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import {
  getTeamRole,
  getTeamWatchlist,
  addToTeamWatchlist,
  removeFromTeamWatchlist,
} from '@/lib/db/queries';
import { handleApiError } from '@/lib/api-error-handler';

export const dynamic = 'force-dynamic';

function parseTeamId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * GET  /api/teams/:teamId/watchlist     — shared watchlist
 * POST /api/teams/:teamId/watchlist     — { modelId } add
 * DELETE /api/teams/:teamId/watchlist?modelId=... — remove
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

    const watchlist = await getTeamWatchlist(teamId);
    return NextResponse.json({ watchlist, teamId, count: watchlist.length });
  } catch (err: any) {
    return handleApiError(err, 'teams/:id/watchlist GET');
  }
}

export async function POST(
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

    const body = await request.json().catch(() => null);
    const modelId = body?.modelId;
    if (!modelId || typeof modelId !== 'string' || modelId.trim().length === 0) {
      return NextResponse.json({ error: 'modelId is required' }, { status: 400 });
    }

    await addToTeamWatchlist(teamId, modelId.trim(), session.user.email);
    const watchlist = await getTeamWatchlist(teamId);
    return NextResponse.json({ success: true, modelId: modelId.trim(), watchlist });
  } catch (err: any) {
    return handleApiError(err, 'teams/:id/watchlist POST');
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

    const role = await getTeamRole(teamId, session.user.email);
    if (!role) {
      return NextResponse.json({ error: 'Not a member of this team' }, { status: 403 });
    }

    const modelId = request.nextUrl.searchParams.get('modelId');
    if (!modelId || modelId.trim().length === 0) {
      return NextResponse.json({ error: 'modelId query param is required' }, { status: 400 });
    }

    const removed = await removeFromTeamWatchlist(teamId, modelId.trim());
    if (!removed) {
      return NextResponse.json({ error: 'Model not found in team watchlist' }, { status: 404 });
    }
    const watchlist = await getTeamWatchlist(teamId);
    return NextResponse.json({ success: true, removedModelId: modelId.trim(), watchlist });
  } catch (err: any) {
    return handleApiError(err, 'teams/:id/watchlist DELETE');
  }
}