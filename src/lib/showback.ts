/**
 * Team Showback (pure attribution + report builder): splits a team's
 * projected monthly inference spend across members, with per-member model
 * mix and share percentages.
 *
 * Inputs are caller-assembled (team roster, workload profiles, catalog
 * snapshots) so the math stays side-effect-free and unit-testable; the
 * route is a thin adapter. Spend uses the same effective-cost model as
 * governance projections (raw token volumes x catalog per-1M prices).
 */

import type { ModelSnapshot } from '@/types/models';
import { effectiveMonthlyCost } from './cost-model';
import { DEFAULT_1M_PRICES } from './governance';

export interface MemberWorkload {
  email: string;
  monthly_prompt_tokens: number;
  monthly_comp_tokens: number;
  primary_model_id: string;
}

export interface MemberShowback {
  email: string;
  monthly_prompt_tokens: number;
  monthly_comp_tokens: number;
  primary_model_id: string | null;
  projected_monthly_usd: number;
  share_pct: number;
}

export interface ShowbackReport {
  team_id: number;
  generated_at: string;
  member_count: number;
  members_with_usage: number;
  total_monthly_prompt_tokens: number;
  total_monthly_comp_tokens: number;
  total_projected_monthly_usd: number;
  members: MemberShowback[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pricesFor(
  modelId: string,
  snapshots: ModelSnapshot[]
): { prompt1m: number; comp1m: number } {
  const snap = snapshots.find((s) => s.model_id.toLowerCase() === modelId.toLowerCase());
  if (snap) {
    return {
      prompt1m:
        snap.price_prompt !== null && snap.price_prompt !== undefined
          ? snap.price_prompt * 1_000_000
          : DEFAULT_1M_PRICES.prompt1m,
      comp1m:
        snap.price_completion !== null && snap.price_completion !== undefined
          ? snap.price_completion * 1_000_000
          : DEFAULT_1M_PRICES.comp1m,
    };
  }
  return { ...DEFAULT_1M_PRICES };
}

export function spendForWorkload(
  w: Pick<MemberWorkload, 'monthly_prompt_tokens' | 'monthly_comp_tokens' | 'primary_model_id'>,
  snapshots: ModelSnapshot[]
): number {
  if (!w.primary_model_id || !w.primary_model_id.trim()) return 0;
  const { prompt1m, comp1m } = pricesFor(w.primary_model_id, snapshots);
  return effectiveMonthlyCost(
    Math.max(0, Math.floor(w.monthly_prompt_tokens) || 0),
    Math.max(0, Math.floor(w.monthly_comp_tokens) || 0),
    prompt1m,
    comp1m,
    { cacheHitRatio: 0, batchDiscount: 0, confidenceBand: 0 }
  );
}

export function buildShowbackReport(
  teamId: number,
  workloads: MemberWorkload[],
  snapshots: ModelSnapshot[]
): ShowbackReport {
  const perMember = workloads.map((w) => ({
    email: w.email,
    monthly_prompt_tokens: Math.max(0, Math.floor(w.monthly_prompt_tokens) || 0),
    monthly_comp_tokens: Math.max(0, Math.floor(w.monthly_comp_tokens) || 0),
    primary_model_id: w.primary_model_id?.trim() ? w.primary_model_id.trim() : null,
    projected_monthly_usd: spendForWorkload(w, snapshots),
  }));

  const total = round2(perMember.reduce((s, m) => s + m.projected_monthly_usd, 0));
  const members: MemberShowback[] = perMember
    .map((m) => ({
      ...m,
      projected_monthly_usd: round2(m.projected_monthly_usd),
      share_pct: total > 0 ? round2((m.projected_monthly_usd / total) * 100) : 0,
    }))
    .sort((a, b) => b.projected_monthly_usd - a.projected_monthly_usd);

  return {
    team_id: teamId,
    generated_at: new Date().toISOString(),
    member_count: workloads.length,
    members_with_usage: perMember.filter(
      (m) => m.monthly_prompt_tokens > 0 || m.monthly_comp_tokens > 0
    ).length,
    total_monthly_prompt_tokens: perMember.reduce((s, m) => s + m.monthly_prompt_tokens, 0),
    total_monthly_comp_tokens: perMember.reduce((s, m) => s + m.monthly_comp_tokens, 0),
    total_projected_monthly_usd: total,
    members,
  };
}
