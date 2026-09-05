export type WorkloadTaskType =
  | 'coding'
  | 'reasoning'
  | 'general'
  | 'customer_support'
  | 'data_extraction';

export interface WorkloadProfile {
  monthlyPromptTokens: number; // e.g. 50,000,000
  monthlyCompTokens: number; // e.g. 10,000,000
  requiredContext: number; // e.g. 64,000
  taskType: WorkloadTaskType;
  maxMonthlyBudget?: number; // USD
}

export interface ModelRecommendationOption {
  tier: 'performance' | 'best_value' | 'free_tier';
  tierLabel: string;
  model_id: string;
  model_name: string;
  provider: string;
  prompt_per_1m: number;
  comp_per_1m: number;
  context_length: number;
  monthly_cost_usd: number;
  annual_cost_usd: number;
  annual_savings_vs_premium: number;
  key_advantage: string;
  benchmark_score_highlight: string;
  // Cost Optimizer (Pro): effective pricing after cache-hit / batch discounts
  effective_prompt_per_1m?: number;
  effective_comp_per_1m?: number;
  effective_monthly_cost_usd?: number;
  effective_annual_cost_usd?: number;
  effective_annual_savings_vs_premium?: number;
  monthly_cost_range_low?: number;
  monthly_cost_range_high?: number;
}

export interface AdvisorResult {
  workload: WorkloadProfile;
  recommendations: ModelRecommendationOption[];
  baselineCostUsd: number;
  maxAnnualSavingsUsd: number;
  // Cost Optimizer (Pro): effective baseline after discounts
  effectiveBaselineCostUsd?: number;
  effectiveMaxAnnualSavingsUsd?: number;
}
