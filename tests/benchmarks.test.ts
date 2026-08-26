import { describe, it, expect } from 'vitest';
import { calculateClientPriorityScore, RAW_BENCHMARK_DATA } from '../src/lib/benchmarks';

describe('Phase V3: Benchmarks & Client Weighting Engine', () => {
  it('1. Calculates high coding score when coding weight is prioritized', () => {
    const claude = RAW_BENCHMARK_DATA.find((m) => m.model_id === 'anthropic/claude-3-7-sonnet')!;
    expect(claude).toBeDefined();

    const codingHeavyWeights = {
      coding: 100,
      reasoning: 0,
      general: 0,
      math: 0,
      costEfficiency: 0,
    };

    const score = calculateClientPriorityScore(claude, codingHeavyWeights);
    expect(score).toBeGreaterThan(65);
  });

  it('2. Evaluates cost efficiency heavily for 0-cost free models', () => {
    const freeLlama = RAW_BENCHMARK_DATA.find((m) => m.model_id.includes(':free'))!;
    expect(freeLlama).toBeDefined();

    const costHeavyWeights = {
      coding: 0,
      reasoning: 0,
      general: 0,
      math: 0,
      costEfficiency: 100,
    };

    const score = calculateClientPriorityScore(freeLlama, costHeavyWeights);
    expect(score).toBe(100);
  });
});
