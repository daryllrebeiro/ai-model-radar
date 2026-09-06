import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { handleApiError } from '@/lib/api-error-handler';
import { getLatestSnapshotsMap } from '@/lib/db/queries';
import {
  getBudgetRulesForUser,
  getBudgetAlerts,
  getMigrationApprovals,
  recordBudgetAlert,
} from '@/lib/db/queries';
import {
  resolveRuleUsage,
  evaluateBudgetRule,
  detectShadowAI,
  switchRequiresApproval,
} from '@/lib/governance';
import { GovernanceStatusReport, UsageByModel } from '@/types/governance';

export const dynamic = 'force-dynamic';

function mergeUsage(usageList: UsageByModel[][]): UsageByModel[] {
  const byModel = new Map<string, UsageByModel>();
  for (const list of usageList) {
    for (const u of list) {
      const existing = byModel.get(u.model_id);
      if (existing) {
        existing.monthly_prompt_tokens += u.monthly_prompt_tokens;
        existing.monthly_comp_tokens += u.monthly_comp_tokens;
      } else {
        byModel.set(u.model_id, { ...u });
      }
    }
  }
  return Array.from(byModel.values());
}

/**
 * GET /api/v1/governance/status — live governance report for the caller:
 * per-rule projections, shadow-AI findings, pending approval workflow, alerts.
 */
export async function GET(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

    const email = session.user.email;
    const rules = await getBudgetRulesForUser(email);
    const ruleIds = rules.filter((r) => r.id !== undefined).map((r) => r.id) as number[];

    const snapshots = Array.from((await getLatestSnapshotsMap()).values());

    const scopeUsage: UsageByModel[][] = [];
    for (const rule of rules) {
      scopeUsage.push(await resolveRuleUsage(rule));
    }

    const evaluations = rules.map((rule) => {
      const index = rules.indexOf(rule);
      return evaluateBudgetRule(rule, scopeUsage[index] || [], snapshots);
    });

    const combinedUsage = mergeUsage(scopeUsage);
    const shadowAI = detectShadowAI(combinedUsage, snapshots);

    const [pendingApprovals, recentAlerts] = await Promise.all([
      ruleIds.length > 0 ? getMigrationApprovals({ ruleIds, status: 'pending', limit: 50 }) : Promise.resolve([]),
      ruleIds.length > 0 ? getBudgetAlerts({ ruleIds, sinceHours: 24, limit: 50 }) : Promise.resolve([]),
    ]);

    for (const ev of evaluations) {
      if (!ev.new_alert || ev.rule.id === undefined) continue;
      if (
        ev.new_alert.alert_type === 'threshold' ||
        ev.new_alert.alert_type === 'over_budget'
      ) {
        const dup = recentAlerts.some(
          (a) =>
            a.rule_id === ev.rule.id &&
            a.alert_type === ev.new_alert!.alert_type &&
            a.model_family === ev.new_alert!.model_family
        );
        if (!dup) {
          await recordBudgetAlert({ ...ev.new_alert, rule_id: ev.rule.id });
        }
      }
    }

    const gate = switchRequiresApproval(evaluations);

    const report: GovernanceStatusReport = {
      generated_at: new Date().toISOString(),
      total_budget_usd:
        Math.round(evaluations.filter((e) => e.rule.active).reduce((s, e) => s + e.rule.monthly_budget_usd, 0) * 100) / 100,
      projected_monthly_usd:
        Math.round(evaluations.reduce((s, e) => s + e.projected_monthly_usd, 0) * 100) / 100,
      rules: evaluations,
      shadow_ai: shadowAI,
      pending_approvals: pendingApprovals,
      recent_alerts: evaluations.length > 0 ? recentAlerts : [],
    };

    return NextResponse.json({ ...report, approval_required_now: gate ? gate.rule.id : null });
  } catch (err: any) {
    return handleApiError(err, 'governance/status GET');
  }
}