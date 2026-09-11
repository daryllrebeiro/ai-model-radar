import {
  ProviderComplianceRecord,
  ModelComplianceOverride,
  ResolvedCompliance,
} from '@/types/compliance';

/**
 * S7 — Curated, sourced provider compliance records.
 *
 * Data owner: compliance (verify:sources pages this owner on staleness;
 * budget 180d — regulatory stakes). See DATASET_OWNERS in source-verify.ts.
 *
 * Provider-level by design (see types/compliance.ts). Every claim carries a
 * source URL + verified date. Unknown = null, never false. No legal advice.
 */
export const RAW_COMPLIANCE_DATA: ProviderComplianceRecord[] = [
  {
    provider: 'OpenAI',
    region: 'global',
    eu_data_residency: true,
    hipaa_eligible: true,
    certifications: ['SOC2', 'ISO27001', 'GDPR'],
    certified_through: null,
    verified_date: '2026-09-10',
    source_name: 'OpenAI Security & Privacy',
    source_url: 'https://openai.com/security/',
  },
  {
    provider: 'Anthropic',
    region: 'global',
    eu_data_residency: true,
    hipaa_eligible: true,
    certifications: ['SOC2', 'ISO27001', 'GDPR', 'HIPAA'],
    certified_through: null,
    verified_date: '2026-09-10',
    source_name: 'Anthropic Security',
    source_url: 'https://www.anthropic.com/security',
  },
  {
    provider: 'Google',
    region: 'global',
    eu_data_residency: true,
    hipaa_eligible: true,
    certifications: ['SOC2', 'ISO27001', 'GDPR', 'HIPAA'],
    certified_through: null,
    verified_date: '2026-09-10',
    source_name: 'Google Cloud Compliance',
    source_url: 'https://cloud.google.com/security/compliance',
  },
  {
    provider: 'Meta',
    region: 'global',
    eu_data_residency: null,
    hipaa_eligible: null,
    certifications: [],
    certified_through: null,
    verified_date: '2026-09-10',
    source_name: 'Meta Llama License & Use',
    source_url: 'https://github.com/meta-llama/llama-models/blob/main/models/llama3_3/LICENSE',
  },
  {
    provider: 'DeepSeek',
    region: 'global',
    eu_data_residency: null,
    hipaa_eligible: null,
    certifications: [],
    certified_through: null,
    verified_date: '2026-09-10',
    source_name: 'DeepSeek API Docs',
    source_url: 'https://api-docs.deepseek.com/',
  },
  {
    provider: 'Qwen',
    region: 'global',
    eu_data_residency: null,
    hipaa_eligible: null,
    certifications: [],
    certified_through: null,
    verified_date: '2026-09-10',
    source_name: 'Qwen Blog',
    source_url: 'https://qwenlm.github.io/blog/qwen2.5/',
  },
];

/**
 * Rare per-model overrides — only where a provider genuinely varies posture
 * by model. Empty by default; populated only with a sourced record.
 */
export const RAW_COMPLIANCE_OVERRIDES: ModelComplianceOverride[] = [];

function providerFromModelId(modelId: string): string | null {
  const needle = modelId.toLowerCase().replace(/:free$/, '');
  const slash = needle.indexOf('/');
  if (slash > 0) {
    const prefix = needle.slice(0, slash);
    const hit = RAW_COMPLIANCE_DATA.find((r) => r.provider.toLowerCase() === prefix);
    if (hit) return hit.provider;
    // Known prefix aliases
    if (prefix === 'openai') return 'OpenAI';
    if (prefix === 'anthropic') return 'Anthropic';
    if (prefix === 'google') return 'Google';
    if (prefix === 'meta-llama' || prefix === 'meta') return 'Meta';
    if (prefix === 'deepseek') return 'DeepSeek';
    if (prefix === 'qwen') return 'Qwen';
  }
  return null;
}

export function findProviderCompliance(provider: string): ProviderComplianceRecord | null {
  const needle = provider.toLowerCase();
  return RAW_COMPLIANCE_DATA.find((r) => r.provider.toLowerCase() === needle) || null;
}

function findOverride(modelId: string): ModelComplianceOverride | null {
  const needle = modelId.toLowerCase().replace(/:free$/, '');
  return (
    RAW_COMPLIANCE_OVERRIDES.find((r) => r.model_id.toLowerCase() === needle) ||
    RAW_COMPLIANCE_OVERRIDES.find(
      (r) => needle.includes(r.model_id.toLowerCase()) || r.model_id.toLowerCase().includes(needle),
    ) ||
    null
  );
}

/** Models inherit provider posture; per-model override wins where present. */
export function findComplianceForModel(modelId: string): ResolvedCompliance | null {
  const override = findOverride(modelId);
  const providerName = override?.provider || providerFromModelId(modelId);
  if (!providerName) return null;
  const base = findProviderCompliance(providerName);
  if (!base) return null;
  if (!override) {
    return {
      provider: base.provider,
      eu_data_residency: base.eu_data_residency,
      hipaa_eligible: base.hipaa_eligible,
      certifications: base.certifications,
      certified_through: base.certified_through,
      overridden: false,
      verified_date: base.verified_date,
      source_name: base.source_name,
      source_url: base.source_url,
    };
  }
  return {
    provider: base.provider,
    eu_data_residency: override.eu_data_residency ?? base.eu_data_residency,
    hipaa_eligible: override.hipaa_eligible ?? base.hipaa_eligible,
    certifications: base.certifications,
    certified_through: base.certified_through,
    overridden: true,
    verified_date: override.verified_date,
    source_name: override.source_name,
    source_url: override.source_url,
  };
}

/** Filter helpers — only explicit true matches (unknown never matches). */
export function filterModelIdsByHipaa(modelIds: string[]): string[] {
  return modelIds.filter((id) => findComplianceForModel(id)?.hipaa_eligible === true);
}

export function filterModelIdsByEuResidency(modelIds: string[]): string[] {
  return modelIds.filter((id) => findComplianceForModel(id)?.eu_data_residency === true);
}
