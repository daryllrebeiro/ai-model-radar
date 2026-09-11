/**
 * S8 — Migration codegen types. Mechanical API-shape translation ONLY.
 * Suggested diff for human review — never auto-applied, never a PR.
 */

export type SupportedPair =
  | 'openai-compat-to-openai-compat'
  | 'openai-to-anthropic'
  | 'anthropic-to-openai'
  | 'openai-to-gemini'
  | 'gemini-to-openai';

export interface MigrationTransform {
  pair: SupportedPair;
  transformed_code: string;
  notes: string[];
}

export const MIGRATION_BEHAVIORAL_CAVEAT =
  'Mechanical API-shape translation only — not a guarantee of equivalent output. Different models often need different prompting to achieve comparable results. Review and test before applying.';

export const SUPPORTED_PAIRS: SupportedPair[] = [
  'openai-compat-to-openai-compat',
  'openai-to-anthropic',
  'anthropic-to-openai',
  'openai-to-gemini',
  'gemini-to-openai',
];
