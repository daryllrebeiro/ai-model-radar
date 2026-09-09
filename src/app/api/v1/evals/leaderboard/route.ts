import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import { getTeamsForUser, getEvalRuns } from '@/lib/db/queries';
import { buildLeaderboard } from '@/lib/evals';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/evals/leaderboard?suite=sql-gen&team_id=123&weights={"sql_gen":2}
 * Aggregated means per model for a suite. team_id scopes to one member team
 * (membership required); without it, the caller's personal + member-team
 * runs are aggregated. weights is an optional JSON object of metric ->
 * positive weight for a weighted composite.
 */
export async function GET(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'BENCHMARK_MATRIX');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'evals');
    if (limited) return limited;

    const params = new URL(request.url).searchParams;
    const suite = (params.get('suite') || '').trim().slice(0, 120);
    if (!suite) {
      return NextResponse.json({ error: 'suite is required' }, { status: 400 });
    }

    const teamRaw = params.get('team_id');
    let teamId: number | undefined;
    if (teamRaw !== null) {
      teamId = Number(teamRaw);
      if (!Number.isInteger(teamId) || teamId <= 0) {
        return NextResponse.json({ error: 'team_id must be a positive integer' }, { status: 400 });
      }
      const teams = await getTeamsForUser(session.user.email);
      if (!teams.some((t) => Number(t.id) === teamId)) {
        return NextResponse.json({ error: 'Team not found or not accessible' }, { status: 404 });
      }
    }

    let weights: Record<string, number> | undefined;
    const weightsRaw = params.get('weights');
    if (weightsRaw !== null) {
      try {
        const parsed: unknown = JSON.parse(weightsRaw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('bad weights');
        }
        weights = parsed as Record<string, number>;
      } catch {
        return NextResponse.json({ error: 'weights must be a JSON object of metric -> weight' }, { status: 400 });
      }
    }

    const runs = teamId !== undefined
      ? await getEvalRuns({ suite, teamId })
      : await getEvalRuns({ suite, email: session.user.email });
    const leaderboard = buildLeaderboard(
      runs.map((r) => ({ model_id: r.model_id, scores: r.scores, samples: r.samples })),
      weights
    );
    return NextResponse.json({
      suite,
      team_id: teamId ?? null,
      runs: runs.length,
      leaderboard,
    });
  } catch (err: any) {
    return handleApiError(err, 'evals/leaderboard GET');
  }
}
