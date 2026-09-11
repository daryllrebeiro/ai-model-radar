/**
 * S7 — Regulatory / data-residency tracker.
 *
 * Provider-level metadata first: models inherit their provider's posture by
 * default; per-model overrides exist only where a provider genuinely varies
 * compliance posture by model (rare but real).
 *
 * NOT legal or compliance advice — every claim carries a source URL + sourced
 * date, and every surface must render COMPLIANCE_DISCLAIMER prominently.
 * Unknown = null/undefined, never false.
 */

export type CertificationType = 'SOC2' | 'HIPAA' | 'ISO27001' | 'GDPR' | 'CCPA' | 'EU-AI-ACT' | 'OTHER';

export interface ProviderComplianceRecord {
  provider: string;
  /** Region code or 'global' — e.g. 'EU', 'US', 'global'. */
  region: string;
  /** EU data residency offered (per cited source). Unknown = null. */
  eu_data_residency: boolean | null;
  /** HIPAA-eligible tier offered (per cited source). Unknown = null. */
  hipaa_eligible: boolean | null;
  certifications: CertificationType[];
  /** Certification valid-through date (ISO) where published, else null. */
  certified_through: string | null;
  verified_date: string;
  source_name: string;
  source_url: string;
}

export interface ModelComplianceOverride {
  model_id: string;
  provider: string;
  eu_data_residency?: boolean;
  hipaa_eligible?: boolean;
  note?: string;
  verified_date: string;
  source_name: string;
  source_url: string;
}

export interface ResolvedCompliance {
  provider: string;
  eu_data_residency: boolean | null;
  hipaa_eligible: boolean | null;
  certifications: CertificationType[];
  certified_through: string | null;
  overridden: boolean;
  verified_date: string;
  source_name: string;
  source_url: string;
}

export const COMPLIANCE_DISCLAIMER =
  'Compliance summary only — not legal or compliance advice. Certifications lapse and scope-change. Verify directly with the provider before relying on this for a compliance decision.';
