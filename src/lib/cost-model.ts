/**
 * Effective cost modeling for the Cost Optimizer (Pro tier).
 *
 * Accounts for:
 *  - Provider prompt-cache discounts (cached input tokens are typically 10x cheaper)
 *  - Batch API discounts (Anthropic/OpenAI batch endpoints are typically 50% off)
 *  - Confidence intervals on projected monthly spend based on benchmark variance
 */

export interface CostScenario {
  /** Fraction of prompt tokens served from provider prompt cache (0..1) */
  cacheHitRatio: number;
  /** Fractional discount applied by batch/asynchronous APIs (0..1, e.g. 0.5 = 50% off) */
  batchDiscount: number;
  /** Width of the confidence band around projected spend (0..1, e.g. 0.15 = ±15%) */
  confidenceBand: number;
}

export const DEFAULT_COST_SCENARIO: CostScenario = {
  cacheHitRatio: 0,
  batchDiscount: 0,
  confidenceBand: 0.15,
};

/** Cached input tokens are charged at ~1/10th the uncached rate on most providers. */
export const CACHE_READ_FACTOR = 0.1;

/**
 * Effective per-1M prompt price after cache-hit and batch discounts.
 */
export function effectivePromptPrice(prompt1m: number, scenario: CostScenario): number {
  const cacheFactor = scenario.cacheHitRatio * CACHE_READ_FACTOR + (1 - scenario.cacheHitRatio);
  return prompt1m * cacheFactor * (1 - scenario.batchDiscount);
}

/**
 * Effective per-1M completion price after batch discount (completions are never cached).
 */
export function effectiveCompPrice(comp1m: number, scenario: CostScenario): number {
  return comp1m * (1 - scenario.batchDiscount);
}

/**
 * Effective monthly cost (USD) given volumes in tokens and per-1M prices.
 */
export function effectiveMonthlyCost(
  monthlyPromptTokens: number,
  monthlyCompTokens: number,
  prompt1m: number,
  comp1m: number,
  scenario: CostScenario
): number {
  const promptMillions = monthlyPromptTokens / 1_000_000;
  const compMillions = monthlyCompTokens / 1_000_000;
  const effPrompt = effectivePromptPrice(prompt1m, scenario);
  const effComp = effectiveCompPrice(comp1m, scenario);
  return Math.round((promptMillions * effPrompt + compMillions * effComp) * 100) / 100;
}

export interface CostRange {
  low: number;
  high: number;
  /** Band width as a fraction (e.g. 0.15 = ±15%) */
  pct: number;
}

/**
 * Confidence interval around a projected monthly cost.
 * Wider when extreme discounts are applied (more assumption sensitivity).
 */
export function monthlyCostRange(monthlyUsd: number, scenario: CostScenario): CostRange {
  const sensitivityBoost = scenario.cacheHitRatio + scenario.batchDiscount;
  const pct = Math.min(0.35, scenario.confidenceBand + sensitivityBoost * 0.1);
  const low = Math.max(0, monthlyUsd * (1 - pct));
  const high = monthlyUsd * (1 + pct);
  return { low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100, pct: Math.round(pct * 100) / 100 };
}

/**
 * Sanitizes a raw slider value into a bounded CostScenario.
 */
export function normalizeScenario(input: Partial<CostScenario> | undefined): CostScenario {
  if (!input) return DEFAULT_COST_SCENARIO;
  const clamp = (v: number | undefined, fallback: number) => {
    if (v === undefined || Number.isNaN(v)) return fallback;
    return Math.min(1, Math.max(0, v));
  };
  return {
    cacheHitRatio: clamp(input.cacheHitRatio, DEFAULT_COST_SCENARIO.cacheHitRatio),
    batchDiscount: clamp(input.batchDiscount, DEFAULT_COST_SCENARIO.batchDiscount),
    confidenceBand: clamp(input.confidenceBand, DEFAULT_COST_SCENARIO.confidenceBand),
  };
}