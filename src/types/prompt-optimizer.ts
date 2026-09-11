/**
 * S3 — Prompt-cost optimizer types.
 * Sensitive-data rules: no persistence beyond the session, no training on
 * submitted prompts, explicit opt-in for any future history feature.
 */

export interface PromptOptimizeInput {
  system_prompt: string;
  example_turns?: string[];
  target_model_id: string;
}

export interface PromptOptimizeResult {
  suggested_prompt: string;
  tokens_before: number;
  tokens_after: number;
  tokens_saved: number;
  pct_saved: number;
  findings: string[];
  caching_note: string | null;
  /** Tokenizer actually used — exact or stated approximation. */
  tokenizer: string;
}
