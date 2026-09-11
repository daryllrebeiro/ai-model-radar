import { describe, it, expect } from 'vitest';
import {
  CANARY_BATTERY,
  selectActiveProbeTargets,
  diffOutputs,
  compareDriftSamples,
  runActiveProbeCycle,
} from '../src/lib/active-probe';
import { DEFAULT_ACTIVE_PROBE_BUDGET, ACTIVE_PROBE_SCOPE_NOTE } from '../src/types/active-probe';

describe('S4+S5 shared active probing (budget-guarded, evidence not scores)', () => {
  it('battery covers three dimensions and is versioned', () => {
    expect(CANARY_BATTERY).toHaveLength(3);
    expect(new Set(CANARY_BATTERY.map((p) => p.dimension)).size).toBe(3);
    for (const p of CANARY_BATTERY) expect(p.version).toBeGreaterThan(0);
  });

  it('target selection prioritizes watched and caps at budget', () => {
    const all = ['a/m1', 'b/m2', 'c/m3', 'd/m4'];
    const sel = selectActiveProbeTargets(all, new Set(['c/m3']), {
      ...DEFAULT_ACTIVE_PROBE_BUDGET,
      max_models_per_run: 2,
    });
    expect(sel[0]).toBe('c/m3');
    expect(sel).toHaveLength(2);
  });

  it('diff is structural line evidence, not a score', () => {
    const { diff_lines, changed } = diffOutputs('line1\nline2', 'line1\nlineX');
    expect(changed).toBe(1);
    expect(diff_lines.join('\n')).toContain('- line2');
    expect(diff_lines.join('\n')).toContain('+ lineX');
  });

  it('identical outputs are not review candidates; changed outputs are', () => {
    const base = { model_id: 'a/m', prompt_id: 'p', prompt_version: 1, ttft_ms: 100, tokens_per_sec: 50, sampled_at: '2026-01-01T00:00:00Z' };
    const same = compareDriftSamples({ ...base, output: 'hello world' }, { ...base, output: 'hello world' });
    expect(same.candidate_for_review).toBe(false);
    const diff = compareDriftSamples({ ...base, output: 'the capital is Paris' }, { ...base, output: 'completely unrelated quantum banana syntax' });
    expect(diff.candidate_for_review).toBe(true);
    expect(diff.diff_lines.length).toBeGreaterThan(0);
  });

  it('cycle respects the call budget and rolls up latency from the same calls', async () => {
    const res = await runActiveProbeCycle({
      modelIds: ['a/m1', 'a/m2', 'a/m3', 'a/m4', 'a/m5'],
      budget: { ...DEFAULT_ACTIVE_PROBE_BUDGET, max_models_per_run: 5, max_prompts_per_model: 3, max_calls_per_run: 4 },
      generateFn: async (model_id) => ({ output: `out ${model_id}`, ttft_ms: 120, tokens_per_sec: 40 }),
    });
    expect(res.calls_made).toBe(4);
    expect(res.calls_skipped_over_budget).toBeGreaterThan(0);
    expect(Object.keys(res.latency).length).toBeGreaterThan(0);
    expect(res.latency['a/m1'].p50_ttft_ms).toBe(120);
  });

  it('latency scope note never promises customer-path numbers', () => {
    expect(ACTIVE_PROBE_SCOPE_NOTE.toLowerCase()).toContain('not a guarantee');
  });
});
