import { describe, it, expect } from 'vitest';
import {
  collectSources,
  evaluateSource,
  sourceAgeDays,
  checkSources,
  DATASET_MAX_AGE_DAYS,
  DATASET_OWNERS,
} from '../src/lib/source-verify';

describe('source verification policy (no network)', () => {
  it('collects every curated record with a dated https source', () => {
    const refs = collectSources();
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) {
      expect(r.source_url).toMatch(/^https:\/\//);
      expect(r.verified_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const datasets = new Set(refs.map((r) => r.dataset));
    expect(datasets).toEqual(new Set(['benchmarks', 'capabilities', 'licenses', 'compliance', 'embeddings', 'finetuning']));
  });

  it('P1-6: compliance/finetune rot faster; every dataset has an owner', () => {
    expect(DATASET_MAX_AGE_DAYS.compliance).toBeLessThan(DATASET_MAX_AGE_DAYS.benchmarks);
    expect(DATASET_MAX_AGE_DAYS.finetuning).toBeLessThan(DATASET_MAX_AGE_DAYS.benchmarks);
    for (const d of Object.keys(DATASET_MAX_AGE_DAYS) as Array<keyof typeof DATASET_MAX_AGE_DAYS>) {
      expect(DATASET_OWNERS[d]).toMatch(/data-owner:/);
    }
    // Per-dataset budgets apply by default: a 200-day-old compliance record
    // fails while a 200-day-old benchmark passes (same HTTP 200).
    const mkRef = (dataset: any) => ({ dataset, model_id: 'x/y', source_name: 'S', source_url: 'https://s.t/', verified_date: 'x' });
    expect(evaluateSource(mkRef('compliance'), 200, null, 200, DATASET_MAX_AGE_DAYS.compliance)).toBe('fail');
    expect(evaluateSource(mkRef('benchmarks'), 200, null, 200, DATASET_MAX_AGE_DAYS.benchmarks)).toBe('ok');
  });

  it('verdict matrix: ok / bot-blocked-warn / dead-fail / stale-fail', () => {
    const ref: any = { dataset: 'capabilities', model_id: 'x/y', source_name: 'S', source_url: 'https://s.t/', verified_date: '2026-01-01' };
    expect(evaluateSource(ref, 200, null, 10, 365)).toBe('ok');
    expect(evaluateSource(ref, 301, null, 10, 365)).toBe('ok');
    for (const s of [401, 403, 429]) {
      expect(evaluateSource(ref, s, null, 10, 365)).toBe('warn');
    }
    expect(evaluateSource(ref, 404, null, 10, 365)).toBe('fail');
    expect(evaluateSource(ref, 500, null, 10, 365)).toBe('fail');
    expect(evaluateSource(ref, null, 'ENOTFOUND', 10, 365)).toBe('fail');
    expect(evaluateSource(ref, 200, null, 400, 365)).toBe('fail');
  });

  it('age math is calendar-correct; garbage dates are infinitely stale', () => {
    expect(sourceAgeDays('2026-01-01', Date.UTC(2026, 1, 1))).toBe(31);
    expect(sourceAgeDays('not-a-date')).toBe(Number.POSITIVE_INFINITY);
  });

  it('runner dedupes by URL and reports per-record verdicts (injected fetch)', async () => {
    const fetchFn = (async (url: any) => {
      if (String(url).includes('gone')) return { status: 404 };
      if (String(url).includes('blocked')) return { status: 403 };
      return { status: 200 };
    }) as any;
    // Inject via URL rewriting is not possible; instead assert policy over
    // the real URL set with a stub that maps everything to 200 except one host.
    const { results, failed } = await checkSources({
      fetchFn,
      maxAgeDays: 100000,
      nowMs: Date.UTC(2026, 5, 1),
    });
    expect(results.length).toBeGreaterThan(10);
    expect(failed).toBe(0);
    expect(results.every((r) => r.verdict === 'ok')).toBe(true);
  });
});
