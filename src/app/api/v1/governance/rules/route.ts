import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import {
  createBudgetRule,
  getBudgetRulesForUser,
  getTeamsForUser,
  getTeamRole,
  BudgetRuleInput,
} from '@/lib/db/queries';
import { governanceRuleCreateSchema } from '@/lib/validation/api-schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/governance/rules — list caller-visible budget rules.
 * POST /api/v1/governance/rules — create a budget rule (Enterprise, GOVERNANCE).
 */
export async function GET(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'governance');
    if (limited) return limited;

    const rules = await getBudgetRulesForUser(session.user.email);
    return NextResponse.json({ rules, count: rules.length });
  } catch (err: any) {
    return handleApiError(err, 'governance/rules GET');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'governance');
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const email = (session.user.email || '').trim();

    const parsed = governanceRuleCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid budget rule',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        { status: 400 }
      );
    }
    const data = parsed.data;

    const scope = data.scope;
    let teamId: number | null = null;
    if (data.team_id !== undefined && data.team_id !== null) {
      teamId = data.team_id;
      const teams = await getTeamsForUser(email);
      const isMember = teams.some((t) => t.id === teamId);
      if (!isMember) {
        return NextResponse.json({ error: 'You are not a member of that team' }, { status: 403 });
      }
      const role = await getTeamRole(teamId, email);
      if (role !== 'admin') {
        return NextResponse.json({ error: 'Only team admins can create team budget rules' }, { status: 403 });
      }
    }

    const budget = data.monthly_budget_usd;
    const name = data.name && data.name.length > 0 ? data.name : 'Unnamed budget';

    const input: BudgetRuleInput = {
      name,
      scope,
      team_id: teamId,
      owner_email: email,
      monthly_budget_usd: budget,
      alert_threshold_pct: data.alert_threshold_pct ?? 0.8,
      approval_required: data.approval_required ?? false,
      hard_cap: data.hard_cap === true,
      notify_email: data.notify_email ?? null,
    };

    const rule = await createBudgetRule(input);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'governance/rules POST');
  }
}
