import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { handleApiError } from '@/lib/api-error-handler';
import {
  createBudgetRule,
  getBudgetRulesForUser,
  getTeamsForUser,
  getTeamRole,
  BudgetRuleInput,
} from '@/lib/db/queries';
import { BudgetRuleScope } from '@/types/governance';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/v1/governance/rules — list caller-visible budget rules.
 * POST /api/v1/governance/rules — create a budget rule (Enterprise, GOVERNANCE).
 */
export async function GET(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

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

    const body = await request.json().catch(() => null);
    const email = (session.user.email || '').trim();

    const scope: BudgetRuleScope = body?.scope === 'team' ? 'team' : 'personal';
    let teamId: number | null = null;
    if (body?.team_id !== undefined && body?.team_id !== null) {
      teamId = Number(body.team_id);
      if (!Number.isInteger(teamId) || teamId <= 0) {
        return NextResponse.json({ error: 'Invalid team_id' }, { status: 400 });
      }
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

    const budget = Number(body?.monthly_budget_usd);
    if (!Number.isFinite(budget) || budget <= 0) {
      return NextResponse.json({ error: 'monthly_budget_usd must be a positive number' }, { status: 400 });
    }

    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : 'Unnamed budget';
    if (name.length > 160) {
      return NextResponse.json({ error: 'Rule name must be 160 characters or fewer' }, { status: 400 });
    }

    const notifyEmailRaw = body?.notify_email;
    let notifyEmail: string | null = null;
    if (notifyEmailRaw !== undefined && notifyEmailRaw !== null && String(notifyEmailRaw).trim() !== '') {
      if (!EMAIL_RE.test(String(notifyEmailRaw).trim())) {
        return NextResponse.json({ error: 'notify_email is not a valid email address' }, { status: 400 });
      }
      notifyEmail = String(notifyEmailRaw).trim();
    }

    const input: BudgetRuleInput = {
      name,
      scope,
      team_id: teamId,
      owner_email: email,
      monthly_budget_usd: budget,
      alert_threshold_pct: Number(body?.alert_threshold_pct ?? 0.8),
      approval_required: Boolean(body?.approval_required),
      notify_email: notifyEmail,
    };

    const rule = await createBudgetRule(input);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'governance/rules POST');
  }
}