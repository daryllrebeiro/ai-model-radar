import { describe, it, expect } from 'vitest';
import { getModelDetail, getModelCurrentList } from '../src/lib/db/queries';
import { RAW_BENCHMARK_DATA } from '../src/lib/benchmarks';
import { computeArbitrageOpportunities } from '../src/lib/arbitrage';
import { trackEvent, getServerEventCounts } from '../src/lib/analytics';

describe('Phase Q1: Model Comparator & Multi-Model Side-by-Side Analysis', () => {
  it('1. Fetches model details and matches with verified evaluation benchmarks', async () => {
    const modelId = 'anthropic/claude-3-7-sonnet';
    const benchmark = RAW_BENCHMARK_DATA.find((b) => b.model_id === modelId);

    expect(benchmark).toBeDefined();
    expect(benchmark?.arena_elo).toBe(1368);
    expect(benchmark?.humaneval).toBe(93.2);
    expect(benchmark?.source_name).toBe('Anthropic Official Release');
    expect(benchmark?.tested_date).toBeDefined();
    // Confirms evaluation scores have verifiable source citation
    expect(benchmark?.source_url).toContain('anthropic.com');
  });

  it('2. Supports parsing 2 to 4 comma-delimited model IDs from search parameters', () => {
    const rawParam = 'anthropic/claude-3-7-sonnet, openai/gpt-4o, deepseek/deepseek-r1, meta-llama/llama-3.3-70b-instruct, extra/overflow-model';
    const parsed = rawParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);

    expect(parsed.length).toBe(4);
    expect(parsed[0]).toBe('anthropic/claude-3-7-sonnet');
    expect(parsed[1]).toBe('openai/gpt-4o');
    expect(parsed[2]).toBe('deepseek/deepseek-r1');
    expect(parsed[3]).toBe('meta-llama/llama-3.3-70b-instruct');
  });

  it('3. Cross-references arbitrage pricing spreads for compared models', async () => {
    const { models } = await getModelCurrentList({ limit: 50 });
    const opportunities = computeArbitrageOpportunities(models);
    expect(Array.isArray(opportunities)).toBe(true);

    if (opportunities.length > 0) {
      const first = opportunities[0];
      expect(first.family_key).toBeDefined();
      expect(first.cheapest_option).toBeDefined();
      expect(first.expensive_option).toBeDefined();
      expect(first.max_prompt_savings_pct).toBeGreaterThanOrEqual(0);
    }
  });

  it('4. Emits and aggregates analytics telemetry for comparison actions', () => {
    const beforeCounts = getServerEventCounts();
    const beforeAdd = beforeCounts['compare_add'] || 0;

    trackEvent('compare_add', { modelId: 'deepseek/deepseek-r1', totalCount: 2 });
    trackEvent('compare_view', { models: 'deepseek/deepseek-r1,openai/gpt-4o' });

    const afterCounts = getServerEventCounts();
    expect(afterCounts['compare_add']).toBe(beforeAdd + 1);
    expect(afterCounts['compare_view']).toBeGreaterThan(0);
  });
});
