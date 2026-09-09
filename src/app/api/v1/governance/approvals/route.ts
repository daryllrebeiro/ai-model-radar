import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import { getBudgetRulesForUser, createMigrationApproval, getTeamRole } from '@/lib/db/queries';
import { validateQuorum } from '@/lib/quorum';
import { approvalCreateSchema } from '@/lib/validation/api-schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/governance/approvals — open a migration-switch approval request
 * (Enterprise, GOVERNANCE). The request is bound to the budget rule it gates.
 */
export async function POST(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'governance');
    if (limited) return limited;

    const email = session.user.email;
    const body = await request.json().catch(() => null);
    const parsed = approvalCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'from_model_id and to_model_id are required',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        { status: 400 }
      );
    }
    const ruleId = parsed.data.rule_id;
    const fromModel = parsed.data.from_model_id;
    const toModel = parsed.data.to_model_id;
    const savings = parsed.data.monthly_savings_usd ?? 0;

    const accessible = await getBudgetRulesForUser(email);
    const rule = accessible.find((r) => r.id === ruleId);
    if (!rule) {
      return NextResponse.json({ error: 'Rule not found or not accessible' }, { status: 404 });
    }

    // Quorum: personal rules always resolve single-decider (quorum 1);
    // team rules may request M-of-N (1..10) but only a team admin can raise
    // the bar above 1.
    let quorumForRule = 1;
    if (rule.scope === 'team') {
      const rawQuorum = parsed.data.quorum_required;
      if (rawQuorum !== undefined && rawQuorum !== null) {
        const q = rawQuorum;
        if (!validateQuorum(q)) {
          return NextResponse.json(
            { error: 'quorum_required must be an integer between 1 and 10' },
            { status: 400 }
          );
        }
        if (q > 1 && rule.team_id !== null && rule.team_id !== undefined) {
          const role = await getTeamRole(rule.team_id, email);
          if (role !== 'admin') {
            return NextResponse.json(
              { error: 'Only team admins can require multi-approver quorum' },
              { status: 403 }
            );
          }
        }
        quorumForRule = q;
      }
    }

    const approval = await createMigrationApproval({
      team_id: rule.team_id,
      rule_id: ruleId,
      from_model_id: fromModel,
      to_model_id: toModel,
      monthly_savings_usd: Number.isFinite(savings) && savings > 0 ? savings : 0,
      requested_by: email,
      quorum_required: quorumForRule,
    });

    return NextResponse.json({ approval }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'governance/approvals POST');
  }
}
