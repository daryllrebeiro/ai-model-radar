/**
 * P1 source verification for curated datasets (benchmarks, capabilities,
 * licenses): the R1-0528 lesson as machinery. Pure collection + policy;
 * network is injected so unit tests never touch the internet.
 */
import { RAW_BENCHMARK_DATA, BENCHMARK_SOURCES_VERIFIED } from './benchmarks';
import { RAW_CAPABILITY_DATA } from './capabilities';
import { RAW_LICENSE_DATA } from './licenses';

export interface SourceRef {
  dataset: 'benchmarks' | 'capabilities' | 'licenses';
  model_id: string;
  source_name: string;
  source_url: string;
  verified_date: string;
}

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
  const { fetchFn = fetch, maxAgeDays = 365, timeoutMs = 10000, nowMs = Date.now() } = opts;
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
      const verdict = evaluateSource(ref, httpStatus, networkError, ageDays, maxAgeDays);
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
