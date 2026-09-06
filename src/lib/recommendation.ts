import { ModelSnapshot } from '@/types/models';
import { MarketSignal } from '@/types/signals';
import { findMigrationAlternatives } from './migration-advisor';
import { effectiveMonthlyCost, monthlyCostRange, normalizeScenario, DEFAULT_COST_SCENARIO } from './cost-model';
import { computeArbitrageOpportunities } from './arbitrage';

/**
 * Usage-aware migration recommendations (Pro feature, gated via MIGRATION).
 *
 * Combines a user's workload (monthly token volumes + cache/batch discounts)
 * with migration alternatives, arbitrage clusters, EOL risk, and forecast risk
 * to produce "switch and save $N/mo" recommendations with rationale.
 */

export interface UsageProfileInput {
  primary_model_id: string;
  monthly_prompt_tokens: number;
  monthly_comp_tokens: number;
  cache_hit_ratio?: number;
  batch_discount?: number;
}

export interface MigrationRecommendation {
  model_id: string;
  model_name: string;
  provider: string;
  prompt_per_1m: number;
  comp_per_1m: number;
  current_monthly_usd: number;
  new_monthly_usd: number;
  monthly_savings_usd: number;
  annual_savings_usd: number;
  savings_pct: number;
  cost_range_low: number;
  cost_range_high: number;
  is_direct_drop_in: boolean;
  risk_factors: string[];
  compare_url: string;
}

export interface RecommendationReport {
  generated_at: string;
  primary_model: {
    model_id: string;
    model_name: string;
    provider: string;
    current_monthly_usd: number;
  };
  total_monthly_savings_usd: number;
  best_switch: MigrationRecommendation | null;
  recommendations: MigrationRecommendation[];
  flags: {
    primary_eol: boolean;
    primary_forecast_drop: boolean;
    via_arbitrage: boolean;
  };
}

function clamp01(v: number | undefined): number {
  if (v === undefined || Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildRecommendations(opts: {
  profile: UsageProfileInput;
  snapshots: ModelSnapshot[];
  signals?: MarketSignal[];
}): RecommendationReport {
  const { profile, snapshots, signals = [] } = opts;
  const scenario = normalizeScenario({
    cacheHitRatio: clamp01(profile.cache_hit_ratio),
    batchDiscount: clamp01(profile.batch_discount),
    confidenceBand: DEFAULT_COST_SCENARIO.confidenceBand,
  });

  const primary = snapshots.find(
    (s) => s.model_id.toLowerCase().includes(profile.primary_model_id.toLowerCase())
  );
  const primaryPrompt1m = primary?.price_prompt !== null && primary?.price_prompt !== undefined
    ? primary.price_prompt * 1_000_000
    : 3.0;
  const primaryComp1m = primary?.price_completion !== null && primary?.price_completion !== undefined
    ? primary.price_completion * 1_000_000
    : 15.0;

  const currentMonthly = effectiveMonthlyCost(
    profile.monthly_prompt_tokens,
    profile.monthly_comp_tokens,
    primaryPrompt1m,
    primaryComp1m,
    scenario
  );

  const eolPrimary = signals.some(
    (s) => s.signal_type === 'MODEL_EOL' &&
      s.model_id.toLowerCase().includes(profile.primary_model_id.toLowerCase())
  );
  const forecastPrimary = signals.find(
    (s) => s.signal_type === 'PRICE_DROP_EXPECTED' &&
      s.model_id.toLowerCase().includes(profile.primary_model_id.toLowerCase())
  );

  const arbitrage = computeArbitrageOpportunities(snapshots);
  const primaryArbitrage = arbitrage.find(
    (c) => c.all_options.some((o) => o.model_id.toLowerCase().includes(profile.primary_model_id.toLowerCase()))
  );

  const report = findMigrationAlternatives(profile.primary_model_id, snapshots);
  const recommendations: MigrationRecommendation[] = [];

  if (report) {
    for (const alt of report.alternatives) {
      const newMonthly = effectiveMonthlyCost(
        profile.monthly_prompt_tokens,
        profile.monthly_comp_tokens,
        alt.prompt_per_1m,
        alt.comp_per_1m,
        scenario
      );
      const savings = currentMonthly - newMonthly;
      if (savings <= 0) continue;

      const range = monthlyCostRange(newMonthly, scenario);
      const risk: string[] = [];
      if (eolPrimary) risk.push('Primary model flagged EOL — the endpoint may be delisted; migrate soon.');
      if (forecastPrimary) {
        const probPct = Math.round((forecastPrimary.strength ?? 10) * 5);
        risk.push(
          `Primary model is forecast to cut price ~${probPct}% soon — waiting may beat switching now.`
        );
      }
      const altForecast = signals.find(
        (s) => s.signal_type === 'PRICE_DROP_EXPECTED' &&
          s.model_id.toLowerCase().includes(alt.model_id.toLowerCase())
      );
      if (altForecast) risk.push('Candidate model itself is forecast for a near-term price cut — hold for a better deal.');

      recommendations.push({
        model_id: alt.model_id,
        model_name: alt.model_name,
        provider: alt.provider,
        prompt_per_1m: round2(alt.prompt_per_1m),
        comp_per_1m: round2(alt.comp_per_1m),
        current_monthly_usd: round2(currentMonthly),
        new_monthly_usd: round2(newMonthly),
        monthly_savings_usd: round2(savings),
        annual_savings_usd: round2(savings * 12),
        savings_pct: currentMonthly > 0 ? Math.round((savings / currentMonthly) * 100) : 0,
        cost_range_low: range.low,
        cost_range_high: range.high,
        is_direct_drop_in: alt.is_direct_drop_in,
        risk_factors: risk,
        compare_url: `/compare?models=${encodeURIComponent([primary?.model_id || profile.primary_model_id, alt.model_id].join(','))}`,
      });
    }
  }

  // Arbitrage flag: same family, cheaper endpoint available today
  let viaArbitrage = false;
  if (primaryArbitrage && primaryArbitrage.cheapest_option) {
    const cheapest = primaryArbitrage.cheapest_option;
    const skip = primary?.model_id &&
      cheapest.model_id.toLowerCase() === primary.model_id.toLowerCase();
    if (!skip && cheapest && cheapest.prompt_per_1m >= 0) {
      const cheapestMonthly = effectiveMonthlyCost(
        profile.monthly_prompt_tokens,
        profile.monthly_comp_tokens,
        cheapest.prompt_per_1m,
        cheapest.comp_per_1m,
        scenario
      );
      if (cheapestMonthly < currentMonthly) {
        viaArbitrage = true;
        recommendations.push({
          model_id: cheapest.model_id,
          model_name: cheapest.model_id.split('/').pop() || cheapest.model_id,
          provider: cheapest.provider,
          prompt_per_1m: round2(cheapest.prompt_per_1m),
          comp_per_1m: round2(cheapest.comp_per_1m),
          current_monthly_usd: round2(currentMonthly),
          new_monthly_usd: round2(cheapestMonthly),
          monthly_savings_usd: round2(currentMonthly - cheapestMonthly),
          annual_savings_usd: round2((currentMonthly - cheapestMonthly) * 12),
          savings_pct: currentMonthly > 0 ? Math.round(((currentMonthly - cheapestMonthly) / currentMonthly) * 100) : 0,
          cost_range_low: round2(cheapestMonthly * (1 - 0.15)),
          cost_range_high: round2(cheapestMonthly * (1 + 0.15)),
          is_direct_drop_in: true,
          risk_factors: ['Same model family on a cheaper endpoint — zero migration effort.'],
          compare_url: `/compare?models=${encodeURIComponent([primary?.model_id || profile.primary_model_id, cheapest.model_id].join(','))}`,
        });
      }
    }
  }

  recommendations.sort((a, b) => b.monthly_savings_usd - a.monthly_savings_usd);
  const top = recommendations.slice(0, 3);
  const best = top[0];

  return {
    generated_at: new Date().toISOString(),
    primary_model: {
      model_id: primary?.model_id || profile.primary_model_id,
      model_name: primary?.name || primary?.model_id || profile.primary_model_id,
      provider: primary?.provider || 'Unknown',
      current_monthly_usd: round2(currentMonthly),
    },
    total_monthly_savings_usd: round2(top.reduce((sum, r) => sum + r.monthly_savings_usd, 0)),
    best_switch: best || null,
    recommendations: top,
    flags: {
      primary_eol: eolPrimary,
      primary_forecast_drop: Boolean(forecastPrimary),
      via_arbitrage: viaArbitrage,
    },
  };
}

/**
 * Returns the max monthly savings available to a user's profile across the
 * current market, used for digest "you could have saved $N" and deals badges.
 */
export function maxMonthlySavingsForProfile(
  profile: UsageProfileInput,
  snapshots: ModelSnapshot[],
  signals?: MarketSignal[]
): { monthly_savings_usd: number; best: MigrationRecommendation | null } {
  const report = buildRecommendations({ profile, snapshots, signals });
  const best = report.best_switch;
  return { monthly_savings_usd: best ? best.monthly_savings_usd : 0, best };
}