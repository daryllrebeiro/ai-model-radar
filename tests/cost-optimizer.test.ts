import { describe, it, expect } from 'vitest';
import {
  effectivePromptPrice,
  effectiveCompPrice,
  effectiveMonthlyCost,
  monthlyCostRange,
  normalizeScenario,
  DEFAULT_COST_SCENARIO,
  CACHE_READ_FACTOR,
} from '../src/lib/cost-model';
import { calculateStackAdvice } from '../src/lib/advisor';
import { ModelSnapshot } from '../src/types/models';

const mockSnapshots: ModelSnapshot[] = [
  {
    model_id: 'anthropic/claude-3-7-sonnet',
    provider: 'Anthropic',
    name: 'Claude 3.7 Sonnet',
    price_prompt: 0.000003,
    price_completion: 0.000015,
    context_length: 200000,
    modality: 'text->text',
    is_free: false,
    raw_json: {},
    polled_at: new Date().toISOString(),
  },
  {
    model_id: 'deepseek/deepseek-chat',
    provider: 'DeepSeek',
    name: 'DeepSeek V3',
    price_prompt: 0.00000014,
    price_completion: 0.00000028,
    context_length: 64000,
    modality: 'text->text',
    is_free: false,
    raw_json: {},
    polled_at: new Date().toISOString(),
  },
];

describe('Phase 2.2: Cost Model (Cache Hit / Batch Discount)', () => {
  it('1. Effective prompt price blends cache reads at CACHE_READ_FACTOR', () => {
    const base = effectivePromptPrice(3, DEFAULT_COST_SCENARIO);
    expect(base).toBe(3);

    // 50% cache hits: 0.5 at 10% price + 0.5 at full price
    const cached = effectivePromptPrice(3, { ...DEFAULT_COST_SCENARIO, cacheHitRatio: 0.5 });
    expect(cached).toBeCloseTo(3 * (0.5 * CACHE_READ_FACTOR + 0.5), 6);

    // 100% cache hits: 10% of full price
    const fullCache = effectivePromptPrice(3, { ...DEFAULT_COST_SCENARIO, cacheHitRatio: 1 });
    expect(fullCache).toBeCloseTo(3 * CACHE_READ_FACTOR, 6);
  });

  it('2. Batch discount applies to prompt and completion uniformly', () => {
    const batch = { ...DEFAULT_COST_SCENARIO, batchDiscount: 0.5 };
    expect(effectiveCompPrice(15, batch)).toBeCloseTo(7.5, 6);
    expect(effectivePromptPrice(3, batch)).toBeCloseTo(1.5, 6);
  });

  it('3. Cache + batch combine multiplicatively', () => {
    const scenario = { ...DEFAULT_COST_SCENARIO, cacheHitRatio: 0.4, batchDiscount: 0.5 };
    const expected = 3 * (0.4 * CACHE_READ_FACTOR + 0.6) * 0.5;
    expect(effectivePromptPrice(3, scenario)).toBeCloseTo(expected, 6);
  });

  it('4. effectiveMonthlyCost computes USD from 1M-unit prices', () => {
    // 50M prompt at $3/1M, 10M comp at $15/1M, no discounts = $150 + $150 = $300
    const plain = effectiveMonthlyCost(50_000_000, 10_000_000, 3, 15, DEFAULT_COST_SCENARIO);
    expect(plain).toBe(300);

    // With 50% batch discount -> $75 + $75 = $150
    const batched = effectiveMonthlyCost(50_000_000, 10_000_000, 3, 15, {
      ...DEFAULT_COST_SCENARIO,
      batchDiscount: 0.5,
    });
    expect(batched).toBe(150);
  });

  it('5. Confidence interval widens with aggressive discount assumptions', () => {
    const conservative = monthlyCostRange(100, { ...DEFAULT_COST_SCENARIO, cacheHitRatio: 0 });
    const aggressive = monthlyCostRange(100, {
      ...DEFAULT_COST_SCENARIO,
      cacheHitRatio: 0.8,
      batchDiscount: 0.5,
    });
    // aggressive band must be wider than the conservative ±15% band
    expect(aggressive.high - aggressive.low).toBeGreaterThan(conservative.high - conservative.low);
    // low never negative
    expect(conservative.low).toBeGreaterThanOrEqual(0);
  });

  it('6. normalizeScenario clamps to [0,1] and fills defaults', () => {
    expect(normalizeScenario(undefined)).toEqual(DEFAULT_COST_SCENARIO);
    const clamped = normalizeScenario({ cacheHitRatio: 5, batchDiscount: -1 } as any);
    expect(clamped.cacheHitRatio).toBe(1);
    expect(clamped.batchDiscount).toBe(0);
    expect(clamped.confidenceBand).toBe(DEFAULT_COST_SCENARIO.confidenceBand);
  });

  it('7. calculateStackAdvice attaches effective pricing with a scenario', () => {
    const workload = {
      monthlyPromptTokens: 50_000_000,
      monthlyCompTokens: 10_000_000,
      requiredContext: 32000,
      taskType: 'coding' as const,
    };

    const base = calculateStackAdvice(workload, mockSnapshots);
    const optimized = calculateStackAdvice(workload, mockSnapshots, { cacheHitRatio: 1, batchDiscount: 0.5, confidenceBand: 0.15 });

    const basePerf = base.recommendations.find((r) => r.tier === 'performance')!;
    const optPerf = optimized.recommendations.find((r) => r.tier === 'performance')!;

    // Effective prompt price must drop below the face $3/1M
    expect(optPerf.effective_prompt_per_1m!).toBeLessThan(optPerf.prompt_per_1m);
    // Effective monthly cost with discounts must be below the base monthly cost
    expect(optPerf.effective_monthly_cost_usd!).toBeLessThan(optPerf.monthly_cost_usd);
    // Optimized baseline on the AdvisorResult is present & lower
    expect(optimized.effectiveBaselineCostUsd!).toBeLessThan(base.baselineCostUsd);
    // Confidence range produced
    expect(optPerf.monthly_cost_range_low!).toBeLessThan(optPerf.effective_monthly_cost_usd!);
    expect(optPerf.monthly_cost_range_high!).toBeGreaterThan(optPerf.effective_monthly_cost_usd!);
  });

  it('8. Free tier stays $0 under any scenario', () => {
    const workload = {
      monthlyPromptTokens: 50_000_000,
      monthlyCompTokens: 10_000_000,
      requiredContext: 32000,
      taskType: 'coding' as const,
    };
    const advice = calculateStackAdvice(workload, mockSnapshots, { cacheHitRatio: 0.9, batchDiscount: 0.5, confidenceBand: 0.15 });
    const free = advice.recommendations.find((r) => r.tier === 'free_tier')!;
    expect(free.effective_monthly_cost_usd).toBe(0);
    expect(free.monthly_cost_range_low).toBe(0);
  });
});