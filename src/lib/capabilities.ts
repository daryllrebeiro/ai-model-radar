import { ModelCapabilityRecord, CapabilityFlagKey } from '@/types/capabilities';

/**
 * R3 — Curated, sourced capability records.
 *
 * Each flag was set only where the cited provider source documents it.
 * Anything uncertain is left undefined (unknown) — never guessed.
 * No synthesized "capability score".
 */
export const RAW_CAPABILITY_DATA: ModelCapabilityRecord[] = [
  {
    model_id: 'openai/gpt-4o',
    name: 'GPT-4o (2024-11-20)',
    provider: 'OpenAI',
    vision: true,
    audio_input: true,
    audio_output: true,
    tool_calling: true,
    structured_output: true,
    prompt_caching: true,
    batch_api: true,
    fine_tuning: true,
    verified_date: '2026-09-10',
    source_name: 'OpenAI Evaluations',
    source_url: 'https://openai.com/index/hello-gpt-4o/',
  },
  {
    model_id: 'anthropic/claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'Anthropic',
    vision: true,
    tool_calling: true,
    structured_output: true,
    prompt_caching: true,
    batch_api: true,
    // audio + fine-tuning: not documented for this model -> unknown (omitted)
    verified_date: '2026-09-10',
    source_name: 'Anthropic Official Release',
    source_url: 'https://www.anthropic.com/news/claude-3-7-sonnet',
  },
  {
    model_id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    tool_calling: true,
    structured_output: true,
    // vision/audio/caching/batch/fine-tuning: not documented -> unknown
    verified_date: '2026-09-10',
    source_name: 'DeepSeek-R1-0528 Release',
    source_url: 'https://api-docs.deepseek.com/news/news250528',
  },
  {
    model_id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    tool_calling: true,
    structured_output: true,
    verified_date: '2026-09-10',
    source_name: 'DeepSeek-V3 Report',
    source_url: 'https://github.com/deepseek-ai/DeepSeek-V3',
  },
  {
    model_id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct',
    provider: 'Meta',
    tool_calling: true,
    structured_output: true,
    // vision/audio/caching/batch/fine-tuning availability varies by host ->
    // unknown at the model level, omit rather than guess
    verified_date: '2026-09-10',
    source_name: 'Meta Llama 3.3 model card (documents builtin tool calling)',
    source_url: 'https://developer.meta.com/ai/docs/model-cards-and-prompt-formats/llama3_3/',
  },
  {
    model_id: 'qwen/qwen-2.5-72b-instruct',
    name: 'Qwen 2.5 72B Instruct',
    provider: 'Qwen',
    tool_calling: true,
    structured_output: true,
    verified_date: '2026-09-10',
    source_name: 'Qwen Blog',
    source_url: 'https://qwenlm.github.io/blog/qwen2.5/',
  },
  {
    model_id: 'google/gemini-2.0-flash-001',
    name: 'Gemini 2.0 Flash',
    provider: 'Google',
    vision: true,
    audio_input: true,
    // audio_output: FALSE per the cited model page ("Audio generation: Not
    // supported"). A sourced false is evidence, not inference.
    audio_output: false,
    tool_calling: true,
    structured_output: true,
    prompt_caching: true,
    batch_api: true,
    // fine-tuning: tuning support post-dates the cited launch source — omit
    // (unknown) rather than assert without evidence.
    verified_date: '2026-09-10',
    source_name: 'Gemini 2.0 Flash model docs',
    source_url: 'https://ai.google.dev/gemini-api/docs/models/gemini-2.0-flash',
  },
];

/** Case-insensitive lookup that also matches `:free` suffixed variants. */
export function findCapabilityForModel(modelId: string): ModelCapabilityRecord | null {
  const needle = modelId.toLowerCase().replace(/:free$/, '');
  return (
    RAW_CAPABILITY_DATA.find((r) => r.model_id.toLowerCase() === needle) ||
    RAW_CAPABILITY_DATA.find(
      (r) => needle.includes(r.model_id.toLowerCase()) || r.model_id.toLowerCase().includes(needle),
    ) ||
    null
  );
}

/** Filter helper for the model-list / comparator attribute filters (R3 success metric). */
export function filterModelIdsByCapability(
  modelIds: string[],
  flag: CapabilityFlagKey,
  value = true,
): string[] {
  return modelIds.filter((id) => findCapabilityForModel(id)?.[flag] === value);
}

