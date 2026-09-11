/**
 * P1 source verification for curated datasets (benchmarks, capabilities,
 * licenses): the R1-0528 lesson as machinery. Pure collection + policy;
 * network is injected so unit tests never touch the internet.
 */
import { RAW_BENCHMARK_DATA, BENCHMARK_SOURCES_VERIFIED } from './benchmarks';
import { RAW_CAPABILITY_DATA } from './capabilities';
import { RAW_LICENSE_DATA } from './licenses';
import { RAW_COMPLIANCE_DATA, RAW_COMPLIANCE_OVERRIDES } from './compliance';
import { RAW_EMBEDDING_DATA, RAW_EMBEDDING_BENCHMARKS } from './embeddings';
import { RAW_FINETUNE_PRICING } from './finetuning';

export interface SourceRef {
  dataset: 'benchmarks' | 'capabilities' | 'licenses' | 'compliance' | 'embeddings' | 'finetuning';
  model_id: string;
  source_name: string;
  source_url: string;
  verified_date: string;
}

/**
 * P1-6 — per-dataset age budgets + owners. Compliance and finetune rows
 * carry regulatory/money stakes, so they rot faster than arena scores.
 * The nightly job pages the OWNER, not just fails the build.
 */
export const DATASET_MAX_AGE_DAYS: Record<SourceRef['dataset'], number> = {
  benchmarks: 365,
  capabilities: 365,
  licenses: 365,
  compliance: 180,
  embeddings: 365,
  finetuning: 180,
};

export const DATASET_OWNERS: Record<SourceRef['dataset'], string> = {
  benchmarks: 'data-owner:benchmarks (see src/lib/benchmarks.ts)',
  capabilities: 'data-owner:capabilities (see src/lib/capabilities.ts)',
  licenses: 'data-owner:licenses (see src/lib/licenses.ts)',
  compliance: 'data-owner:compliance (see src/lib/compliance.ts)',
  embeddings: 'data-owner:embeddings (see src/lib/embeddings.ts)',
  finetuning: 'data-owner:finetuning (see src/lib/finetuning.ts)',
};

export function collectSources(): SourceRef[] {
  return [
    ...RAW_BENCHMARK_DATA.map((r) => ({
      dataset: 'benchmarks' as const,
      model_id: r.model_id,
      source_name: r.source_name || 'benchmark',
      source_url: r.source_url,
      verified_date: BENCHMARK_SOURCES_VERIFIED,
    })),
    ...RAW_CAPABILITY_DATA.map((r) => ({
      dataset: 'capabilities' as const,
      model_id: r.model_id,
      source_name: r.source_name,
      source_url: r.source_url,
      verified_date: r.verified_date,
    })),
    ...RAW_LICENSE_DATA.map((r) => ({
      dataset: 'licenses' as const,
      model_id: r.model_id,
      source_name: r.source_name,
      source_url: r.source_url,
      verified_date: r.verified_date,
    })),
    ...RAW_COMPLIANCE_DATA.map((r) => ({
      dataset: 'compliance' as const,
      model_id: `provider:${r.provider}`,
      source_name: r.source_name,
      source_url: r.source_url,
      verified_date: r.verified_date,
    })),
    ...RAW_COMPLIANCE_OVERRIDES.map((r) => ({
      dataset: 'compliance' as const,
      model_id: r.model_id,
      source_name: r.source_name,
      source_url: r.source_url,
      verified_date: r.verified_date,
    })),
    ...RAW_EMBEDDING_DATA.map((r) => ({
      dataset: 'embeddings' as const,
      model_id: r.model_id,
      source_name: r.source_name,
      source_url: r.source_url,
      verified_date: r.verified_date,
    })),
    ...RAW_EMBEDDING_BENCHMARKS.map((r) => ({
      dataset: 'embeddings' as const,
      model_id: r.model_id,
      source_name: r.source_name,
      source_url: r.source_url,
      verified_date: r.tested_date,
    })),
    ...RAW_FINETUNE_PRICING.map((r) => ({
      dataset: 'finetuning' as const,
      model_id: r.base_model,
      source_name: r.source_name,
      source_url: r.source_url,
      verified_date: r.verified_date,
    })),
  ];
}

export type SourceVerdict = 'ok' | 'warn' | 'fail';

export interface SourceResult extends SourceRef {
  http_status: number | null;
  age_days: number;
  verdict: SourceVerdict;
  detail: string;
}

/**
 * Verdict policy (documented, deliberate):
 * - 2xx–3xx → ok (dedupe by URL: one fetch per unique URL).
 * - 401/403/429 → warn (docs sites routinely bot-block; needs a human look,
 *   not a red build every night).
 * - 404/4xx-other/5xx → fail (source moved or died — re-source the record).
 * - Network error (DNS/timeout) → fail.
 * - verified_date older than maxAgeDays → fail (stale fact served as sourced).
 */
export function evaluateSource(
  ref: SourceRef,
  httpStatus: number | null,
  networkError: string | null,
  ageDays: number,
  maxAgeDays: number
): SourceVerdict {
  if (ageDays > maxAgeDays) return 'fail';
  if (networkError) return 'fail';
  if (httpStatus === null) return 'fail';
  if (httpStatus >= 200 && httpStatus < 400) return 'ok';
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) return 'warn';
  return 'fail';
}

export function sourceAgeDays(verifiedDate: string, nowMs = Date.now()): number {
  const t = new Date(`${verifiedDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((nowMs - t) / (24 * 3600 * 1000)));
}

export async function checkSources(opts: {
  fetchFn?: typeof fetch;
  maxAgeDays?: number;
  timeoutMs?: number;
  nowMs?: number;
} = {}): Promise<{ results: SourceResult[]; failed: number; warned: number }> {
  const { fetchFn = fetch, timeoutMs = 10000, nowMs = Date.now() } = opts;
  // P1-6: per-dataset budgets by default; an explicit maxAgeDays still
  // overrides globally (CI escape hatch, use deliberately).
  const ageFor = (dataset: SourceRef['dataset']) => opts.maxAgeDays ?? DATASET_MAX_AGE_DAYS[dataset];
  const refs = collectSources();
  const byUrl = new Map<string, SourceRef[]>();
  for (const r of refs) {
    const list = byUrl.get(r.source_url) || [];
    list.push(r);
    byUrl.set(r.source_url, list);
  }
  const results: SourceResult[] = [];
  let failed = 0;
  let warned = 0;
  for (const [url, group] of byUrl) {
    let httpStatus: number | null = null;
    let networkError: string | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(url, {
          headers: { 'User-Agent': 'AI-Model-Radar/1.0 source-verifier', Accept: 'text/html,application/json' },
          signal: controller.signal,
          redirect: 'follow',
        });
        httpStatus = res.status;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: any) {
      networkError = err?.name === 'AbortError' ? 'timeout' : err?.message || 'fetch failed';
    }
    for (const ref of group) {
      const ageDays = sourceAgeDays(ref.verified_date, nowMs);
      const verdict = evaluateSource(ref, httpStatus, networkError, ageDays, ageFor(ref.dataset));
      if (verdict === 'fail') failed++;
      else if (verdict === 'warn') warned++;
      results.push({
        ...ref,
        http_status: httpStatus,
        age_days: ageDays,
        verdict,
        detail: networkError || `HTTP ${httpStatus}`,
      });
    }
  }
  return { results, failed, warned };
}
