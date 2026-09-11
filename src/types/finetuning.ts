/**
 * S6 — Fine-tuning build-vs-buy estimator types.
 *
 * New pricing dimension (training + hosted fine-tuned inference), sourced
 * like base pricing. The estimator NEVER claims quality parity — see
 * FINETUNE_QUALITY_DISCLAIMER, rendered next to every estimate.
 */

export interface FineTunePricingRecord {
  provider: string;
  base_model: string;
  /** Training cost per 1M tokens (USD). Null = unpublished. */
  training_per_1m: number | null;
  /** Hosted fine-tuned inference: prompt per 1M. Null = unpublished. */
  hosted_prompt_per_1m: number | null;
  /** Hosted fine-tuned inference: completion per 1M. Null = unpublished. */
  hosted_comp_per_1m: number | null;
  /** Flat hosting fee USD/month (0 = none published). */
  hosting_flat_monthly: number;
  verified_date: string;
  source_name: string;
  source_url: string;
}

export interface BuildVsBuyInput {
  monthly_prompt_tokens: number;
  monthly_comp_tokens: number;
  /** One-time training token volume. */
  training_tokens: number;
  large_model_id: string;
  small_model_id: string;
}

export interface BuildVsBuyEstimate {
  prompt_large_monthly: number;
  finetune_training_onetime: number;
  finetune_hosted_monthly: number;
  finetune_first_month_total: number;
  monthly_savings_after_training: number;
  breakeven_months: number | null;
}

export const FINETUNE_QUALITY_DISCLAIMER =
  'Cost estimate assumes comparable quality is achievable; this tool cannot verify that. Fine-tuned quality depends on training data and effort this product cannot observe.';
