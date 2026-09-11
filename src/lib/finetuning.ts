import { FineTunePricingRecord, BuildVsBuyInput, BuildVsBuyEstimate } from '@/types/finetuning';
import { RAW_BENCHMARK_DATA } from './benchmarks';

/**
 * S6 — Sourced fine-tuning pricing + pure build-vs-buy estimator.
 * Data owner: finetuning (verify:sources pages this owner on staleness;
 * budget 180d — money stakes). See DATASET_OWNERS in source-verify.ts.
 *
 * Inference prices for the "prompt the large model" side come from tracked
 * benchmark pricing (same sourcing discipline as base pricing).
 */
export const RAW_FINETUNE_PRICING: FineTunePricingRecord[] = [
  {
    provider: 'OpenAI',
    base_model: 'openai/gpt-4o-mini',
    training_per_1m: 3.0,
    hosted_prompt_per_1m: 0.3,
    hosted_comp_per_1m: 1.2,
    hosting_flat_monthly: 0,
    verified_date: '2026-09-10',
    source_name: 'OpenAI Fine-tuning Pricing',
    source_url: 'https://openai.com/api/pricing/',
  },
  {
    provider: 'OpenAI',
    base_model: 'openai/gpt-4o',
    training_per_1m: 25.0,
    hosted_prompt_per_1m: 3.75,
    hosted_comp_per_1m: 15.0,
    hosting_flat_monthly: 0,
    verified_date: '2026-09-10',
    source_name: 'OpenAI Fine-tuning Pricing',
    source_url: 'https://openai.com/api/pricing/',
  },
];

export function findFineTunePricing(modelId: string): FineTunePricingRecord | null {
  const needle = modelId.toLowerCase().replace(/:free$/, '');
  return (
    RAW_FINETUNE_PRICING.find((r) => r.base_model.toLowerCase() === needle) ||
    RAW_FINETUNE_PRICING.find(
      (r) => needle.includes(r.base_model.toLowerCase()) || r.base_model.toLowerCase().includes(needle),
    ) ||
    null
  );
}

function trackedInferencePrices(modelId: string): { prompt: number; comp: number } | null {
  const needle = modelId.toLowerCase().replace(/:free$/, '');
  const row = RAW_BENCHMARK_DATA.find(
    (b) => b.model_id.toLowerCase() === needle || needle.includes(b.model_id.toLowerCase()),
  );
  if (!row || row.pricing_prompt_1m == null || row.pricing_comp_1m == null) return null;
  return { prompt: row.pricing_prompt_1m, comp: row.pricing_comp_1m };
}

/** Pure cost comparison. No quality claim — caller must render the disclaimer. */
export function estimateBuildVsBuy(input: BuildVsBuyInput): BuildVsBuyEstimate | null {
  const large = trackedInferencePrices(input.large_model_id);
  const ft = findFineTunePricing(input.small_model_id);
  if (!large || !ft || ft.hosted_prompt_per_1m == null || ft.hosted_comp_per_1m == null) return null;
  const pm = input.monthly_prompt_tokens / 1_000_000;
  const cm = input.monthly_comp_tokens / 1_000_000;
  const tm = input.training_tokens / 1_000_000;
  const prompt_large_monthly = Math.round((pm * large.prompt + cm * large.comp) * 100) / 100;
  const finetune_training_onetime =
    Math.round(tm * (ft.training_per_1m ?? 0) * 100) / 100;
  const finetune_hosted_monthly =
    Math.round((pm * ft.hosted_prompt_per_1m + cm * ft.hosted_comp_per_1m + ft.hosting_flat_monthly) * 100) / 100;
  const monthly_savings_after_training =
    Math.round((prompt_large_monthly - finetune_hosted_monthly) * 100) / 100;
  const breakeven_months =
    monthly_savings_after_training > 0
      ? Math.round((finetune_training_onetime / monthly_savings_after_training) * 10) / 10
      : null;
  return {
    prompt_large_monthly,
    finetune_training_onetime,
    finetune_hosted_monthly,
    finetune_first_month_total: Math.round((finetune_training_onetime + finetune_hosted_monthly) * 100) / 100,
    monthly_savings_after_training,
    breakeven_months,
  };
}
