import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import { getTeamsForUser, submitEvalRun } from '@/lib/db/queries';
import { validateEvalRun } from '@/lib/evals';
import { BudgetRuleScope } from '@/types/governance';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/evals/runs — submit a BYO benchmark run.
 * Body: { suite, model_id, scores: {metric: 0..100}, samples?, notes?,
 *         scope?: 'personal'|'team', team_id? }.
 * Team runs require team membership. Scores are validated (<=20 metrics,
 * snake_case names, finite 0..100).
 */
export async function POST(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'BENCHMARK_MATRIX');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'evals');
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const checked = validateEvalRun({
      suite: body?.suite,
      model_id: body?.model_id,
      scores: body?.scores,
      samples: body?.samples,
    });
    if (!checked.ok) {
      return NextResponse.json(
        { error: 'Invalid eval run', details: checked.errors },
        { status: 400 }
      );
    }

    const scope: BudgetRuleScope = body?.scope === 'team' ? 'team' : 'personal';
    let teamId: number | null = null;
    if (scope === 'team') {
      teamId = Number(body?.team_id);
      if (!Number.isInteger(teamId) || teamId <= 0) {
        return NextResponse.json({ error: 'A valid team_id is required for team runs' }, { status: 400 });
      }
      const teams = await getTeamsForUser(session.user.email);
      if (!teams.some((t) => Number(t.id) === teamId)) {
        return NextResponse.json({ error: 'You are not a member of that team' }, { status: 403 });
      }
    }

    const run = await submitEvalRun({
      suite: checked.run.suite,
      model_id: checked.run.model_id,
      scope,
      team_id: teamId,
      owner_email: session.user.email,
      scores: checked.run.scores,
      samples: checked.run.samples,
      notes: typeof body?.notes === 'string' ? body.notes : null,
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'evals/runs POST');
  }
}
