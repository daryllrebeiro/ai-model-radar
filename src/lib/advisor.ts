import {
  WorkloadProfile,
  AdvisorResult,
  ModelRecommendationOption,
} from '@/types/advisor';
import { ModelSnapshot } from '@/types/models';

/**
 * Computes tailored model recommendations and exact monthly cost projections
 */
export function calculateStackAdvice(
  workload: WorkloadProfile,
  snapshots: ModelSnapshot[]
): AdvisorResult {
  const promptMillions = workload.monthlyPromptTokens / 1_000_000;
  const compMillions = workload.monthlyCompTokens / 1_000_000;

  // Filter models meeting context requirement
  const eligible = snapshots.filter(
    (s) => (s.context_length || 0) >= workload.requiredContext
  );

  const calculateCost = (promptPrice: number | null, compPrice: number | null) => {
    const p1m = promptPrice !== null ? promptPrice * 1_000_000 : 0;
    const c1m = compPrice !== null ? compPrice * 1_000_000 : 0;
    const monthly = (promptMillions * p1m) + (compMillions * c1m);
    const annual = monthly * 12;
    return { p1m, c1m, monthly, annual };
  };

  // 1. Performance Tier (Claude 3.7 Sonnet or GPT-4o or DeepSeek R1)
  let perfModel = eligible.find((s) => s.model_id === 'anthropic/claude-3-7-sonnet') ||
    eligible.find((s) => s.model_id === 'openai/gpt-4o') ||
    eligible.find((s) => s.model_id === 'deepseek/deepseek-r1') ||
    eligible[0];

  const perfCost = calculateCost(perfModel.price_prompt, perfModel.price_completion);

  const perfOption: ModelRecommendationOption = {
    tier: 'performance',
    tierLabel: 'Top Frontier Accuracy',
    model_id: perfModel.model_id,
    model_name: perfModel.name,
    provider: perfModel.provider,
    prompt_per_1m: perfCost.p1m,
    comp_per_1m: perfCost.c1m,
    context_length: perfModel.context_length || 128000,
    monthly_cost_usd: Math.round(perfCost.monthly * 100) / 100,
    annual_cost_usd: Math.round(perfCost.annual * 100) / 100,
    annual_savings_vs_premium: 0,
    key_advantage: 'State-of-the-art SWE-bench & reasoning for complex agentic workflows.',
    benchmark_score_highlight: '70.3% SWE-bench Verified | 1368 Arena Elo',
  };

  // 2. Best Value Tier (DeepSeek V3 or Gemini 2.0 Flash or Qwen 2.5 72B)
  let valueModel = eligible.find((s) => s.model_id === 'deepseek/deepseek-chat') ||
    eligible.find((s) => s.model_id === 'google/gemini-2.0-flash-001') ||
    eligible.find((s) => s.model_id === 'qwen/qwen-2.5-72b-instruct') ||
    eligible[0];

  const valueCost = calculateCost(valueModel.price_prompt, valueModel.price_completion);
  const valueAnnualSavings = Math.max(0, perfCost.annual - valueCost.annual);

  const valueOption: ModelRecommendationOption = {
    tier: 'best_value',
    tierLabel: 'Maximum Cost-Efficiency (Best ROI)',
    model_id: valueModel.model_id,
    model_name: valueModel.name,
    provider: valueModel.provider,
    prompt_per_1m: valueCost.p1m,
    comp_per_1m: valueCost.c1m,
    context_length: valueModel.context_length || 128000,
    monthly_cost_usd: Math.round(valueCost.monthly * 100) / 100,
    annual_cost_usd: Math.round(valueCost.annual * 100) / 100,
    annual_savings_vs_premium: Math.round(valueAnnualSavings * 100) / 100,
    key_advantage: `Over 90% cheaper than frontier pricing with comparable ${workload.taskType} benchmark performance.`,
    benchmark_score_highlight: '75.9% MMLU-Pro | 1318 Arena Elo',
  };

  // 3. Free Tier Option
  let freeModel = eligible.find((s) => s.is_free) ||
    snapshots.find((s) => s.is_free) || {
      model_id: 'meta-llama/llama-3.3-70b-instruct:free',
      name: 'Llama 3.3 70B (Free Tier)',
      provider: 'Meta',
      price_prompt: 0,
      price_completion: 0,
      context_length: 131072,
    };

  const freeCost = calculateCost(0, 0);
  const freeAnnualSavings = Math.max(0, perfCost.annual);

  const freeOption: ModelRecommendationOption = {
    tier: 'free_tier',
    tierLabel: '100% Free / Zero-Cost',
    model_id: freeModel.model_id,
    model_name: freeModel.name,
    provider: freeModel.provider,
    prompt_per_1m: 0,
    comp_per_1m: 0,
    context_length: freeModel.context_length || 131072,
    monthly_cost_usd: 0,
    annual_cost_usd: 0,
    annual_savings_vs_premium: Math.round(freeAnnualSavings * 100) / 100,
    key_advantage: 'Zero-cost inference via subsidized community router rate limits.',
    benchmark_score_highlight: '69.8% MMLU-Pro | 1285 Arena Elo',
  };

  return {
    workload,
    recommendations: [perfOption, valueOption, freeOption],
    baselineCostUsd: Math.round(perfCost.monthly * 100) / 100,
    maxAnnualSavingsUsd: Math.round(valueAnnualSavings * 100) / 100,
  };
}
