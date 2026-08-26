import { describe, it, expect } from 'vitest';
import { extractModelFamily, computeArbitrageOpportunities } from '../src/lib/arbitrage';
import { ModelSnapshot } from '../src/types/models';

describe('Phase V2: Provider Price Arbitrage Engine', () => {
  it('1. Correctly normalizes model IDs into canonical family keys', () => {
    expect(extractModelFamily('meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B')).toBe('Llama 3.3 70B');
    expect(extractModelFamily('meta-llama/llama-3.3-70b-instruct', 'Llama 3.3 70B Instruct')).toBe('Llama 3.3 70B');
    expect(extractModelFamily('deepseek/deepseek-r1', 'DeepSeek R1')).toBe('DeepSeek R1');
    expect(extractModelFamily('qwen/qwen-2.5-72b-instruct', 'Qwen 2.5 72B')).toBe('Qwen 2.5 72B');
  });

  it('2. Computes spread and identifies cheapest/most expensive options', () => {
    const snapshots: ModelSnapshot[] = [
      {
        model_id: 'meta-llama/llama-3.3-70b-instruct:free',
        provider: 'Meta (Free Routing)',
        name: 'Llama 3.3 70B Free',
        price_prompt: 0,
        price_completion: 0,
        context_length: 131072,
        modality: 'text->text',
        is_free: true,
        raw_json: {},
        polled_at: new Date().toISOString(),
      },
      {
        model_id: 'meta-llama/llama-3.3-70b-instruct',
        provider: 'Meta Standard',
        name: 'Llama 3.3 70B',
        price_prompt: 0.0000007, // $0.70 / 1M
        price_completion: 0.0000008, // $0.80 / 1M
        context_length: 131072,
        modality: 'text->text',
        is_free: false,
        raw_json: {},
        polled_at: new Date().toISOString(),
      },
    ];

    const clusters = computeArbitrageOpportunities(snapshots);

    expect(clusters).toHaveLength(1);
    const cluster = clusters[0];
    expect(cluster.family_key).toBe('Llama 3.3 70B');
    expect(cluster.provider_count).toBe(2);
    expect(cluster.cheapest_option.is_free).toBe(true);
    expect(cluster.expensive_option.is_free).toBe(false);
    expect(cluster.max_prompt_savings_pct).toBe(100);
    expect(cluster.prompt_spread_per_1m).toBeCloseTo(0.70, 2);
  });

  it('3. Ignores standalone models with only a single host provider', () => {
    const snapshots: ModelSnapshot[] = [
      {
        model_id: 'anthropic/claude-3-7-sonnet',
        provider: 'Anthropic',
        name: 'Claude 3.7 Sonnet',
        price_prompt: 0.000003,
        price_completion: 0.000015,
        context_length: 200000,
        modality: 'text+image->text',
        is_free: false,
        raw_json: {},
        polled_at: new Date().toISOString(),
      },
    ];

    const clusters = computeArbitrageOpportunities(snapshots);
    expect(clusters).toHaveLength(0);
  });
});
