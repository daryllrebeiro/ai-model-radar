/**
 * R3 — Feature/capability support matrix (Tier B).
 *
 * Sourced attribute set, same pattern as benchmarks: every record carries a
 * source URL + verification date. A missing (undefined) flag means UNKNOWN —
 * never render it as "not supported". No inferred/guessed flags.
 */

export interface ModelCapabilityRecord {
  model_id: string;
  name: string;
  provider: string;
  /** Unknown = undefined. Never infer from model names/descriptions. */
  vision?: boolean;
  audio_input?: boolean;
  audio_output?: boolean;
  tool_calling?: boolean;
  structured_output?: boolean;
  prompt_caching?: boolean;
  batch_api?: boolean;
  fine_tuning?: boolean;
  max_output_tokens?: number | null;
  verified_date: string;
  source_name: string;
  source_url: string;
}

export type CapabilityFlagKey =
  | 'vision'
  | 'audio_input'
  | 'audio_output'
  | 'tool_calling'
  | 'structured_output'
  | 'prompt_caching'
  | 'batch_api'
  | 'fine_tuning';

export const CAPABILITY_FLAGS: { key: CapabilityFlagKey; label: string }[] = [
  { key: 'vision', label: 'Vision' },
  { key: 'tool_calling', label: 'Tool calling' },
  { key: 'structured_output', label: 'Structured output / JSON mode' },
  { key: 'prompt_caching', label: 'Prompt caching' },
  { key: 'batch_api', label: 'Batch API' },
  { key: 'fine_tuning', label: 'Fine-tuning' },
  { key: 'audio_input', label: 'Audio input' },
  { key: 'audio_output', label: 'Audio output' },
];
