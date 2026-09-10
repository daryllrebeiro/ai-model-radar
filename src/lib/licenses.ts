import { ModelLicenseRecord } from '@/types/licenses';

/**
 * R4 — Curated, sourced license records.
 *
 * Conservative by design: commercial_use_allowed is null (unknown) unless the
 * cited source clearly permits/denies it. Always rendered with
 * LICENSE_DISCLAIMER — this is a starting point for legal review, not advice.
 */
export const RAW_LICENSE_DATA: ModelLicenseRecord[] = [
  {
    model_id: 'openai/gpt-4o',
    name: 'GPT-4o (2024-11-20)',
    provider: 'OpenAI',
    license_id: 'Proprietary (API-only)',
    license_name: 'Proprietary — commercial use via OpenAI API terms',
    commercial_use_allowed: true,
    commercial_use_note: 'Via paid API under OpenAI terms; weights not distributable.',
    attribution_required: false,
    verified_date: '2024-11-20',
    source_name: 'OpenAI Evaluations',
    source_url: 'https://openai.com/index/hello-gpt-4o/',
  },
  {
    model_id: 'anthropic/claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'Anthropic',
    license_id: 'Proprietary (API-only)',
    license_name: 'Proprietary — commercial use via Anthropic API terms',
    commercial_use_allowed: true,
    commercial_use_note: 'Via paid API under Anthropic terms; weights not distributable.',
    attribution_required: false,
    verified_date: '2025-02-24',
    source_name: 'Anthropic Official Release',
    source_url: 'https://www.anthropic.com/news/claude-3-7-sonnet',
  },
  {
    model_id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    license_id: 'MIT (code) + DeepSeek Model License',
    license_name: 'Open-weight — commercial use permitted per repo license',
    commercial_use_allowed: true,
    commercial_use_note: 'Repo states MIT for code; model weights permit commercial use and distillation. Verify current repo terms.',
    attribution_required: true,
    verified_date: '2025-01-20',
    source_name: 'DeepSeek-R1 Technical Report',
    source_url: 'https://github.com/deepseek-ai/DeepSeek-R1',
  },
  {
    model_id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    license_id: 'DeepSeek Model License',
    license_name: 'Open-weight — commercial use permitted per repo license',
    commercial_use_allowed: true,
    commercial_use_note: 'Verify current repo terms before shipping.',
    attribution_required: true,
    verified_date: '2024-12-26',
    source_name: 'DeepSeek-V3 Report',
    source_url: 'https://github.com/deepseek-ai/DeepSeek-V3',
  },
  {
    model_id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct',
    provider: 'Meta',
    license_id: 'Llama Community License',
    license_name: 'Llama 3.3 Community License — commercial use with restrictions',
    commercial_use_allowed: true,
    commercial_use_note: 'Commercial use allowed subject to Llama license terms (incl. monthly-active-user threshold for large services).',
    attribution_required: true,
    verified_date: '2024-12-06',
    source_name: 'Meta AI Blog',
    source_url: 'https://ai.meta.com/blog/llama-3-3/',
  },
  {
    model_id: 'qwen/qwen-2.5-72b-instruct',
    name: 'Qwen 2.5 72B Instruct',
    provider: 'Qwen',
    license_id: 'Qwen License',
    license_name: 'Custom Qwen License — review before commercial use',
    commercial_use_allowed: null,
    commercial_use_note: 'Large Qwen releases historically carry custom terms; confirm the exact license file for this checkpoint.',
    attribution_required: null,
    verified_date: '2024-09-19',
    source_name: 'Qwen Blog',
    source_url: 'https://qwenlm.github.io/blog/qwen2.5/',
  },
  {
    model_id: 'google/gemini-2.0-flash-001',
    name: 'Gemini 2.0 Flash',
    provider: 'Google',
    license_id: 'Proprietary (API-only)',
    license_name: 'Proprietary — commercial use via Google AI terms',
    commercial_use_allowed: true,
    commercial_use_note: 'Via paid API under Google terms; weights not distributable.',
    attribution_required: false,
    verified_date: '2025-02-05',
    source_name: 'Google Developers Blog',
    source_url: 'https://blog.google/technology/developers/gemini-2-0-flash-thinking/',
  },
];

/** Case-insensitive lookup that also matches `:free` suffixed variants. */
export function findLicenseForModel(modelId: string): ModelLicenseRecord | null {
  const needle = modelId.toLowerCase().replace(/:free$/, '');
  return (
    RAW_LICENSE_DATA.find((r) => r.model_id.toLowerCase() === needle) ||
    RAW_LICENSE_DATA.find(
      (r) => needle.includes(r.model_id.toLowerCase()) || r.model_id.toLowerCase().includes(needle),
    ) ||
    null
  );
}

/** Filter helper for the "commercial use allowed" model-list filter (R4 success metric). */
export function filterModelIdsByCommercialUse(modelIds: string[]): string[] {
  return modelIds.filter((id) => findLicenseForModel(id)?.commercial_use_allowed === true);
}
