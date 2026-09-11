/**
 * S4+S5 — Shared active-probing types.
 *
 * Active probing = real, PAID generation calls (unlike all prior metadata
 * ingestion). Cost scales with models × prompts × frequency, so every cycle
 * is budget-guarded and defaults to a small curated subset at weekly cadence.
 * Drift evidence = before/after output text diffs, never a bare score.
 * Latency numbers are always scoped to the probe region/window/sample count.
 */

export interface CanaryPrompt {
  id: string;
  dimension: 'factual-qa' | 'code-gen' | 'instruction-following';
  version: number;
  prompt: string;
  max_tokens: number;
}

export interface DriftSample {
  model_id: string;
  prompt_id: string;
  prompt_version: number;
  output: string;
  ttft_ms: number | null;
  tokens_per_sec: number | null;
  sampled_at: string;
}

export interface DriftDiff {
  model_id: string;
  prompt_id: string;
  previous: DriftSample;
  current: DriftSample;
  /** Line-level diff: lines prefixed ' ' (same), '-' (removed), '+' (added). */
  diff_lines: string[];
  changed_lines: number;
  total_lines: number;
  /** Flags candidates for human review — never fires a "degraded" alert alone. */
  candidate_for_review: boolean;
}

export interface ActiveProbeBudget {
  max_models_per_run: number;
  max_prompts_per_model: number;
  max_calls_per_run: number;
  cadence: string;
  probe_region: string;
}

export const DEFAULT_ACTIVE_PROBE_BUDGET: ActiveProbeBudget = {
  max_models_per_run: 10,
  max_prompts_per_model: 3,
  max_calls_per_run: 30,
  cadence: 'weekly',
  probe_region: 'us-east-1',
};

export const ACTIVE_PROBE_SCOPE_NOTE =
  'As measured from our probe infrastructure in us-east-1, over the last 7 days. Numbers reflect our network path and load window — not a guarantee of any customer region or path.';

export const DRIFT_EVIDENCE_NOTE =
  'Drift candidates are flagged by text similarity but decided by human-readable before/after diffs. No automated "model degraded" verdict is issued from a metric alone.';
