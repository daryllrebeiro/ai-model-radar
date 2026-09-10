/**
 * R4 — Licensing & commercial-use tracker (Tier B).
 *
 * Summary only — NOT legal advice (see LICENSE_DISCLAIMER, rendered next to
 * every license surface). Every record carries a source URL + verification
 * date, same pattern as benchmarks/capabilities. Unknown = null, never false.
 */

export type CommercialUse = boolean | null;

export interface ModelLicenseRecord {
  model_id: string;
  name: string;
  provider: string;
  /** e.g. 'Apache-2.0' | 'MIT' | 'Llama Community License' | 'Qwen License' | 'Proprietary (API-only)' */
  license_id: string;
  license_name: string;
  /** true = commercial use allowed (per cited source); false = not allowed; null = unknown / needs legal review */
  commercial_use_allowed: CommercialUse;
  commercial_use_note?: string;
  attribution_required: boolean | null;
  verified_date: string;
  source_name: string;
  source_url: string;
}

export const LICENSE_DISCLAIMER =
  'License summary only — not legal advice. Confirm with your own legal review before commercial use.';
