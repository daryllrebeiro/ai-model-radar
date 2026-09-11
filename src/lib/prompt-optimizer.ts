import { PromptOptimizeInput, PromptOptimizeResult } from '@/types/prompt-optimizer';
import { findCapabilityForModel } from './capabilities';

/**
 * S3 — Prompt-cost optimizer. Savings come from a REAL token-count diff
 * (whitespace/punctuation-aware wordpiece approximation, stated as such),
 * never an LLM-guessed percentage. Nothing is persisted — pure function of
 * the request body; callers must not store inputs.
 */
export const TOKENIZER_NOTE = 'Approximate wordpiece tokenizer (whitespace + punctuation split, ~0.75 words/token calibration). Stated approximation — exact vendor tokenizers vary.';

export function approximateTokenCount(text: string): number {
  if (!text) return 0;
  const pieces = text
    .replace(/([.,;:!?(){}[\]"'`])/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean);
  return Math.max(0, Math.round(pieces.length / 0.75));
}

function squeezeRedundancy(prompt: string): { out: string; findings: string[] } {
  const findings: string[] = [];
  let out = prompt;
  // Collapse 3+ blank lines / repeated whitespace.
  const collapsed = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (collapsed.length < out.length) findings.push('Collapsed redundant whitespace/blank lines.');
  out = collapsed;
  // Drop verbatim repeated lines.
  const lines = out.split('\n');
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const ln of lines) {
    const key = ln.trim().toLowerCase();
    if (key && seen.has(key)) {
      findings.push('Removed a verbatim repeated instruction line.');
      continue;
    }
    seen.add(key);
    deduped.push(ln);
  }
  out = deduped.join('\n').trim();
  // Flag hedging filler phrases (suggest removal, do not auto-delete meaning).
  if (/\b(please note that|it is important to note|as an AI|in other words,? restating)\b/i.test(out)) {
    findings.push('Flagged filler phrasing that adds tokens without instructions; consider deleting.');
  }
  if (findings.length === 0) findings.push('No mechanical redundancy found; prompt is already concise.');
  return { out, findings };
}

export function optimizePrompt(input: PromptOptimizeInput): PromptOptimizeResult {
  const corpus = [input.system_prompt, ...(input.example_turns || [])].join('\n');
  const tokens_before = approximateTokenCount(corpus);
  const { out, findings } = squeezeRedundancy(input.system_prompt);
  const afterCorpus = [out, ...(input.example_turns || [])].join('\n');
  const tokens_after = approximateTokenCount(afterCorpus);
  const tokens_saved = Math.max(0, tokens_before - tokens_after);
  const pct_saved = tokens_before > 0 ? Math.round((tokens_saved / tokens_before) * 1000) / 10 : 0;
  const caching = findCapabilityForModel(input.target_model_id)?.prompt_caching;
  const caching_note =
    caching === true
      ? 'Target model supports prompt caching — put stable instructions first to maximize cache hits.'
      : caching === false
        ? 'Target model has no documented prompt-caching support — savings come from trimming only.'
        : 'Prompt-caching support for the target model is unknown — savings computed from trimming only.';
  return {
    suggested_prompt: out,
    tokens_before,
    tokens_after,
    tokens_saved,
    pct_saved,
    findings,
    caching_note,
    tokenizer: TOKENIZER_NOTE,
  };
}
