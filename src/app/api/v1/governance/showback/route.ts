import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import {
  getTeamsForUser,
  getTeamMembers,
  getUsageProfileByEmail,
  getLatestSnapshotsMap,
} from '@/lib/db/queries';
import { buildShowbackReport, MemberWorkload } from '@/lib/showback';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/governance/showback?team_id=123 — per-member spend attribution
 * for a team (Enterprise, GOVERNANCE). Caller must belong to the team.
 * Spend is projected-monthly from workload profiles x catalog prices, the
 * same basis as governance budget evaluation.
 */
export async function GET(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'governance');
    if (limited) return limited;

    const teamId = Number(new URL(request.url).searchParams.get('team_id'));
    if (!Number.isInteger(teamId) || teamId <= 0) {
      return NextResponse.json({ error: 'A valid team_id is required' }, { status: 400 });
    }

    const teams = await getTeamsForUser(session.user.email);
    const team = teams.find((t) => Number(t.id) === teamId);
    if (!team) {
      return NextResponse.json({ error: 'Team not found or not accessible' }, { status: 404 });
    }

    const [members, snapshotsMap] = await Promise.all([
      getTeamMembers(teamId),
      getLatestSnapshotsMap(),
    ]);
    const snapshots = Array.from(snapshotsMap.values());

    const workloads: MemberWorkload[] = [];
    for (const m of members) {
      const profile = await getUsageProfileByEmail(m.member_email);
      workloads.push({
        email: m.member_email,
        monthly_prompt_tokens: profile?.monthly_prompt_tokens ?? 0,
        monthly_comp_tokens: profile?.monthly_comp_tokens ?? 0,
        primary_model_id: profile?.primary_model_id ?? '',
      });
    }

    const report = buildShowbackReport(teamId, workloads, snapshots);
    return NextResponse.json({ team: { id: team.id, name: team.name }, ...report });
  } catch (err: any) {
    return handleApiError(err, 'governance/showback GET');
  }
}
