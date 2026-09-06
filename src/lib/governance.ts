import { ModelSnapshot } from '@/types/models';
import { getUsageProfileByEmail, getTeamMembers, UsageProfile } from '@/lib/db/queries';
import {
  BudgetRule,
  BudgetRuleEvaluation,
  BudgetRuleStatus,
  BudgetAlertRecord,
  FamilySpend,
  ShadowAiFinding,
  UsageByModel,
} from '@/types/governance';
import { toFamily } from './forecast';
import { effectiveMonthlyCost } from './cost-model';

/**
 * Usage-aware budget governance (Enterprise feature, gated via GOVERNANCE).
 *
 * Layers per-scope spend guardrails over the F3 usage engine:
 *  - projects monthly spend per model family from member workload profiles
 *  - scores each budget rule (ok / approaching / over) against the projection
 *  - flags "shadow AI" — spend on model endpoints outside the tracked catalog
 *  - gates migration switches behind an approval workflow when a rule requires it
 */

/** Fallback per-1M prices used when a model is not in the tracked catalog. */
export const DEFAULT_1M_PRICES = { prompt1m: 3.0, comp1m: 15.0 };

/**
 * Resolves the workload usage a rule governs: the owner's profile for personal
 * rules, or the union of all team members' profiles for team rules.
 */
export async function resolveRuleUsage(rule: BudgetRule): Promise<UsageByModel[]> {
  if (rule.scope === 'personal') {
    const profile = await getUsageProfileByEmail(rule.owner_email);
    return profile ? collectUsageFromProfiles([profile]) : [];
  }
  if (rule.team_id !== null && rule.team_id !== undefined) {
    const members = await getTeamMembers(rule.team_id);
    const profiles = [];
    for (const m of members) {
      const p = await getUsageProfileByEmail(m.member_email);
      if (p) profiles.push(p);
    }
    return collectUsageFromProfiles(profiles);
  }
  return [];
}

export function collectUsageFromProfiles(
  profiles: Pick<UsageProfile, 'primary_model_id' | 'monthly_prompt_tokens' | 'monthly_comp_tokens'>[]
): UsageByModel[] {
  return profiles
    .filter((p) => p.primary_model_id && p.primary_model_id.trim().length > 0)
    .map((p) => ({
      model_id: p.primary_model_id,
      monthly_prompt_tokens: Math.floor(p.monthly_prompt_tokens) || 0,
      monthly_comp_tokens: Math.floor(p.monthly_comp_tokens) || 0,
    }));
}

function pricesFor(
  modelId: string,
  snapshots: ModelSnapshot[]
): { prompt1m: number; comp1m: number } {
  const snap = snapshots.find((s) =>
    s.model_id.toLowerCase() === modelId.toLowerCase()
  );
  if (snap) {
    return {
      prompt1m: snap.price_prompt !== null && snap.price_prompt !== undefined
        ? snap.price_prompt * 1_000_000
        : DEFAULT_1M_PRICES.prompt1m,
      comp1m: snap.price_completion !== null && snap.price_completion !== undefined
        ? snap.price_completion * 1_000_000
        : DEFAULT_1M_PRICES.comp1m,
    };
  }
  return { ...DEFAULT_1M_PRICES };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Projects a usage set into a per-model-family monthly spend map, reusing the F3
 * effective-cost model (cache/batch discounts are not applied here because usage
 * engines are raw token volumes; the profile-level discounts shape recommendations).
 */
export function projectUsageByModelFamily(
  usage: UsageByModel[],
  snapshots: ModelSnapshot[]
): FamilySpend[] {
  const byFamily = new Map<string, { monthly_usd: number; models: Set<string> }>();
  for (const u of usage) {
    if (u.monthly_prompt_tokens <= 0 && u.monthly_comp_tokens <= 0) continue;
    const { prompt1m, comp1m } = pricesFor(u.model_id, snapshots);
    const spend = effectiveMonthlyCost(
      u.monthly_prompt_tokens,
      u.monthly_comp_tokens,
      prompt1m,
      comp1m,
      { cacheHitRatio: 0, batchDiscount: 0, confidenceBand: 0 }
    );
    if (spend <= 0) continue;
    const family = toFamily(u.model_id);
    const entry = byFamily.get(family);
    if (entry) {
      entry.monthly_usd += spend;
      entry.models.add(u.model_id);
    } else {
      byFamily.set(family, { monthly_usd: spend, models: new Set([u.model_id]) });
    }
  }
  return Array.from(byFamily.entries())
    .map(([family, { monthly_usd, models }]) => ({
      family,
      monthly_usd: round2(monthly_usd),
      models: Array.from(models),
    }))
    .sort((a, b) => b.monthly_usd - a.monthly_usd);
}

export function evaluateBudgetRule(
  rule: BudgetRule,
  usage: UsageByModel[],
  snapshots: ModelSnapshot[],
  nowIso?: string
): BudgetRuleEvaluation {
  const family_breakdown = projectUsageByModelFamily(usage, snapshots);
  const projected_monthly_usd = round2(
    family_breakdown.reduce((sum, f) => sum + f.monthly_usd, 0)
  );
  const budget = rule.monthly_budget_usd;
  const pct_used = budget > 0 ? round2(projected_monthly_usd / budget) : 0;

  let status: BudgetRuleStatus = 'ok';
  if (projected_monthly_usd >= budget) status = 'over';
  else if (pct_used >= Math.min(1, Math.max(0, rule.alert_threshold_pct))) status = 'approaching';

  let new_alert: BudgetAlertRecord | null = null;
  if (status !== 'ok') {
    const alertType = status === 'over' ? 'over_budget' : 'threshold';
    const biggest = family_breakdown[0];
    new_alert = {
      rule_id: rule.id,
      model_family: biggest ? biggest.family : null,
      projected_monthly_usd,
      budget_usd: budget,
      pct_used,
      alert_type: alertType,
      message:
        status === 'over'
          ? `Budget "${rule.name}" exceeded — projected $${projected_monthly_usd}/mo vs $${budget}/mo budget.`
          : `Budget "${rule.name}" approaching — projected $${projected_monthly_usd}/mo is ${Math.round(pct_used * 100)}% of the $${budget}/mo budget.`,
      created_at: nowIso || new Date().toISOString(),
    };
  }

  return { rule, projected_monthly_usd, pct_used, status, family_breakdown, new_alert };
}

/**
 * Flags "shadow AI": usage on model endpoints not present in the tracked
 * catalog — i.e. spend flowing to undocumented/delisted models.
 */
export function detectShadowAI(
  usage: UsageByModel[],
  snapshots: ModelSnapshot[],
  approvedModelIds: string[] = []
): ShadowAiFinding[] {
  const tracked = new Set(snapshots.map((s) => s.model_id.toLowerCase()));
  const approved = new Set(approvedModelIds.map((m) => m.toLowerCase()));
  const findings: ShadowAiFinding[] = [];
  for (const u of usage) {
    const trackedHit = tracked.has(u.model_id.toLowerCase());
    const approvedHit = approved.size > 0 && approved.has(u.model_id.toLowerCase());
    if (trackedHit || approvedHit) continue;
    const { prompt1m, comp1m } = pricesFor(u.model_id, snapshots);
    const spend = effectiveMonthlyCost(
      u.monthly_prompt_tokens,
      u.monthly_comp_tokens,
      prompt1m,
      comp1m,
      { cacheHitRatio: 0, batchDiscount: 0, confidenceBand: 0 }
    );
    findings.push({
      model_id: u.model_id,
      estimated_monthly_usd: round2(spend),
      reason: approved.size > 0
        ? 'Model not on the approved list — undocumented AI spend.'
        : 'Model not tracked in the radar catalog — undocumented endpoint spend.',
    });
  }
  return findings;
}

/**
 * A migration switch to `toModelId` is allowed immediately only if no active
 * over-budget rule requires approval; otherwise it must go through the approval
 * workflow. Returns the evaluation that triggered the gate, if any.
 */
export function switchRequiresApproval(
  evaluations: BudgetRuleEvaluation[],
  toModelId?: string
): BudgetRuleEvaluation | null {
  const relevant = evaluations.filter(
    (e) =>
      e.status === 'over' &&
      e.rule.approval_required &&
      (toModelId === undefined ||
        e.family_breakdown.some((f) =>
          f.models.some((m) => m.toLowerCase() === toModelId.toLowerCase())
        ))
  );
  return relevant.length > 0 ? relevant[0] : null;
}

export function totalProjected(usage: UsageByModel[], snapshots: ModelSnapshot[]): number {
  return round2(
    projectUsageByModelFamily(usage, snapshots).reduce((s, f) => s + f.monthly_usd, 0)
  );
}