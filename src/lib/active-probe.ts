import {
  CanaryPrompt,
  DriftSample,
  DriftDiff,
  ActiveProbeBudget,
  DEFAULT_ACTIVE_PROBE_BUDGET,
} from '@/types/active-probe';

/**
 * S4+S5 — Shared active-probing subsystem (extends probe.ts, not parallel).
 *
 * - S4 drift: versioned canary battery run on schedule via real APIs.
 *   Evidence = structural diff lines; similarity only flags candidates.
 * - S5 latency: TTFT + tokens/sec measured on the SAME timed calls, sharing
 *   budget, credentials, and scheduling.
 * - Budget-guarded: curated subset (watched first), hard call cap per run.
 * - No live calls in unit tests: generation is injected (generateFn).
 * - Credentials: dedicated low-privilege budget-capped keys per provider
 *   (see docs/SECRETS.md PROBE_* entries); never reuse app keys.
 */
export const CANARY_BATTERY_VERSION = 1;

/**
 * P1-1 kill switch: paid cycles run ONLY when explicitly enabled.
 * Fail-closed default OFF — the future scheduled trigger (P2-2) must check
 * this before spending a cent. Deliberately env-based (not DB) so ops can
 * cut spend without a deploy or a working database.
 */
export function isActiveProbeEnabled(): boolean {
  return process.env.ACTIVE_PROBE_ENABLED === 'true';
}

/**
 * P2-2 — OpenAI-compatible generator behind dedicated PROBE_* credentials.
 * Lives in lib (not the cron route module) because Next.js route files may
 * only export HTTP handlers + config. Timed per call; upstream errors throw
 * so the cycle counts them as errors (never sampled, never diffed).
 */
export function buildProbeGenerateFn(opts: {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}): GenerateFn {
  const timeoutMs = opts.timeoutMs ?? 15000;
  return async (model_id: string, prompt: string, max_tokens: number) => {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await (opts.fetchFn || fetch)(`${opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ model: model_id, messages: [{ role: 'user', content: prompt }], max_tokens }),
        signal: controller.signal,
      });
      const ttftMs = Date.now() - started;
      if (!res.ok) throw new Error(`probe upstream HTTP ${res.status}`);
      const body = (await res.json()) as any;
      const output = body?.choices?.[0]?.message?.content;
      if (typeof output !== 'string') throw new Error('probe upstream returned no content');
      const elapsedSec = Math.max(0.001, (Date.now() - started) / 1000);
      return { output, ttft_ms: ttftMs, tokens_per_sec: Math.round((output.length / 4 / elapsedSec) * 100) / 100 };
    } finally {
      clearTimeout(timeout);
    }
  };
}

export const CANARY_BATTERY: CanaryPrompt[] = [
  {
    id: 'factual-qa-capital',
    dimension: 'factual-qa',
    version: CANARY_BATTERY_VERSION,
    prompt: 'What is the capital of France? Answer with the city name only.',
    max_tokens: 32,
  },
  {
    id: 'code-gen-fib',
    dimension: 'code-gen',
    version: CANARY_BATTERY_VERSION,
    prompt: 'Write a Python function fib(n) returning the nth Fibonacci number. Code only.',
    max_tokens: 256,
  },
  {
    id: 'instruction-following-reverse',
    dimension: 'instruction-following',
    version: CANARY_BATTERY_VERSION,
    prompt: 'Repeat the word "radar" exactly three times, one per line, with no other text.',
    max_tokens: 32,
  },
];

export type GenerateFn = (model_id: string, prompt: string, max_tokens: number) => Promise<{
  output: string;
  ttft_ms: number | null;
  tokens_per_sec: number | null;
}>;

/** Curated subset: watched models first, then others, capped by budget. */
export function selectActiveProbeTargets(
  allModelIds: string[],
  watchedModelIds: Set<string> | string[] = [],
  budget: ActiveProbeBudget = DEFAULT_ACTIVE_PROBE_BUDGET
): string[] {
  const watched = new Set(watchedModelIds);
  const watchedFirst = allModelIds.filter((id) => watched.has(id));
  const rest = allModelIds.filter((id) => !watched.has(id));
  return [...watchedFirst, ...rest].slice(0, budget.max_models_per_run);
}

/** Line-level structural diff between two outputs (the EVIDENCE, not a score). */
export function diffOutputs(before: string, after: string): { diff_lines: string[]; changed: number; total: number } {
  const a = before.split('\n');
  const b = after.split('\n');
  const max = Math.max(a.length, b.length);
  const diff_lines: string[] = [];
  let changed = 0;
  for (let i = 0; i < max; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) {
      diff_lines.push(`  ${x ?? ''}`);
    } else {
      changed++;
      if (x !== undefined) diff_lines.push(`- ${x}`);
      if (y !== undefined) diff_lines.push(`+ ${y}`);
    }
  }
  return { diff_lines, changed, total: max };
}

/** Jaccard similarity over word sets — flags CANDIDATES only, never verdicts. */
export function textSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  return inter / (setA.size + setB.size - inter || 1);
}

export function compareDriftSamples(previous: DriftSample, current: DriftSample): DriftDiff {
  const { diff_lines, changed, total } = diffOutputs(previous.output, current.output);
  const sim = textSimilarity(previous.output, current.output);
  return {
    model_id: current.model_id,
    prompt_id: current.prompt_id,
    previous,
    current,
    diff_lines,
    changed_lines: changed,
    total_lines: total,
    candidate_for_review: changed > 0 && sim < 0.85,
  };
}

export interface DriftCycleResult {
  samples: DriftSample[];
  diffs: DriftDiff[];
  calls_made: number;
  calls_skipped_over_budget: number;
  /** Audit H3: provider/hang failures are counted and skipped, never sampled
   * as empty output (an outage must not read as drift) and never abort the
   * whole cycle — one hung provider stalls at most its own calls. */
  errors: number;
  /** P2-2: per-model error counts so the spend ledger attributes failures. */
  per_model_errors: Record<string, number>;
  latency: Record<string, { p50_ttft_ms: number | null; p95_ttft_ms: number | null; avg_tokens_per_sec: number | null; samples: number }>;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/**
 * Runs one budget-guarded drift+latency cycle. Generation is injected so
 * tests never spend money; production wires real provider SDKs behind
 * dedicated PROBE_* keys.
 */
export async function runActiveProbeCycle(opts: {
  modelIds: string[];
  watchedModelIds?: Set<string> | string[];
  previous?: DriftSample[];
  budget?: ActiveProbeBudget;
  generateFn: GenerateFn;
  asOf?: string;
}): Promise<DriftCycleResult> {
  const budget = opts.budget || DEFAULT_ACTIVE_PROBE_BUDGET;
  const targets = selectActiveProbeTargets(opts.modelIds, opts.watchedModelIds, budget);
  const prompts = CANARY_BATTERY.slice(0, budget.max_prompts_per_model);
  const cap = budget.max_calls_per_run;
  const now = opts.asOf || new Date().toISOString();
  const samples: DriftSample[] = [];
  let skipped = 0;
  let calls = 0;
  let errors = 0;
  const perModelErrors: Record<string, number> = {};
  for (const modelId of targets) {
    for (const p of prompts) {
      if (calls >= cap) {
        skipped++;
        continue;
      }
      calls++;
      let gen: { output: string; ttft_ms: number | null; tokens_per_sec: number | null };
      try {
        gen = await opts.generateFn(modelId, p.prompt, p.max_tokens);
      } catch {
        // Fail-safe per call: count and continue. Errored calls emit NO
        // sample (no outage-as-drift) and NO diff. The worker retries next
        // cadence; persistent errors page via the errors count.
        errors++;
        perModelErrors[modelId] = (perModelErrors[modelId] || 0) + 1;
        continue;
      }
      samples.push({
        model_id: modelId,
        prompt_id: p.id,
        prompt_version: p.version,
        output: gen.output,
        ttft_ms: gen.ttft_ms,
        tokens_per_sec: gen.tokens_per_sec,
        sampled_at: now,
      });
    }
  }
  const prevByKey = new Map((opts.previous || []).map((s) => [`${s.model_id}::${s.prompt_id}`, s]));
  const diffs: DriftDiff[] = [];
  for (const s of samples) {
    const prev = prevByKey.get(`${s.model_id}::${s.prompt_id}`);
    if (prev) diffs.push(compareDriftSamples(prev, s));
  }
  // S5 latency rollup per model from the SAME timed calls.
  const latency: DriftCycleResult['latency'] = {};
  for (const modelId of targets) {
    const ttfts = samples.filter((s) => s.model_id === modelId && s.ttft_ms != null).map((s) => s.ttft_ms as number).sort((a, b) => a - b);
    const tps = samples.filter((s) => s.model_id === modelId && s.tokens_per_sec != null).map((s) => s.tokens_per_sec as number);
    latency[modelId] = {
      p50_ttft_ms: percentile(ttfts, 50),
      p95_ttft_ms: percentile(ttfts, 95),
      avg_tokens_per_sec: tps.length > 0 ? Math.round((tps.reduce((a, b) => a + b, 0) / tps.length) * 100) / 100 : null,
      samples: samples.filter((s) => s.model_id === modelId).length,
    };
  }
  return { samples, diffs, calls_made: calls, calls_skipped_over_budget: skipped, errors, per_model_errors: perModelErrors, latency };
}
