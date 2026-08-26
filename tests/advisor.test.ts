import { describe, it, expect } from 'vitest';
import { calculateStackAdvice } from '../src/lib/advisor';
import { ModelSnapshot } from '../src/types/models';

describe('Phase V4: AI Stack Advisor Engine', () => {
  const mockSnapshots: ModelSnapshot[] = [
    {
      model_id: 'anthropic/claude-3-7-sonnet',
      provider: 'Anthropic',
      name: 'Claude 3.7 Sonnet',
      price_prompt: 0.000003, // $3.00 / 1M
      price_completion: 0.000015, // $15.00 / 1M
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
      price_prompt: 0.00000014, // $0.14 / 1M
      price_completion: 0.00000028, // $0.28 / 1M
      context_length: 64000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
    {
      model_id: 'meta-llama/llama-3.3-70b:free',
      provider: 'Meta',
      name: 'Llama 3.3 70B (Free Tier)',
      price_prompt: 0,
      price_completion: 0,
      context_length: 131072,
      modality: 'text->text',
      is_free: true,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
  ];

  it('1. Computes exact monthly costs and highlights annual savings for best value tier', () => {
    const workload = {
      monthlyPromptTokens: 50_000_000, // 50M
      monthlyCompTokens: 10_000_000,   // 10M
      requiredContext: 32000,
      taskType: 'coding' as const,
    };

    const advice = calculateStackAdvice(workload, mockSnapshots);

    expect(advice.recommendations).toHaveLength(3);

    const perf = advice.recommendations.find((r) => r.tier === 'performance')!;
    // 50 * 3.00 = 150; 10 * 15.00 = 150; Total = $300/mo
    expect(perf.monthly_cost_usd).toBe(300);
    expect(perf.annual_cost_usd).toBe(3600);

    const value = advice.recommendations.find((r) => r.tier === 'best_value')!;
    // 50 * 0.14 = 7; 10 * 0.28 = 2.8; Total = $9.80/mo
    expect(value.monthly_cost_usd).toBeCloseTo(9.80, 2);
    expect(value.annual_savings_vs_premium).toBeGreaterThan(3400);

    const free = advice.recommendations.find((r) => r.tier === 'free_tier')!;
    expect(free.monthly_cost_usd).toBe(0);
  });
});
