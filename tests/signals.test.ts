import { describe, it, expect } from 'vitest';
import { detectMarketSignals, computeRobustDeviation } from '../src/lib/signals';
import { ModelSnapshot } from '../src/types/models';

describe('Phase P0.3: Robust Statistical Anomaly (Median + MAD)', () => {
  const sampleSnapshots: ModelSnapshot[] = [
    {
      model_id: 'anthropic/claude-3-7-sonnet',
      provider: 'Anthropic',
      name: 'Claude 3.7 Sonnet',
      price_prompt: 0.000003, // $3.00/1M
      price_completion: 0.000015,
      context_length: 200000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
    {
      model_id: 'openai/gpt-4o',
      provider: 'OpenAI',
      name: 'GPT-4o',
      price_prompt: 0.0000025, // $2.50/1M
      price_completion: 0.00001,
      context_length: 128000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
    {
      model_id: 'meta-llama/llama-3.3-70b',
      provider: 'Meta',
      name: 'Llama 3.3 70B',
      price_prompt: 0.0000007, // $0.70/1M
      price_completion: 0.0000008,
      context_length: 131072,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
    {
      model_id: 'deepseek/deepseek-chat',
      provider: 'DeepSeek',
      name: 'DeepSeek V3',
      price_prompt: 0.00000014, // $0.14/1M (Extreme outlier)
      price_completion: 0.00000028,
      context_length: 64000,
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
    {
      model_id: 'google/gemini-2.0-flash',
      provider: 'Google',
      name: 'Gemini 2.0 Flash',
      price_prompt: 0.0000001, // $0.10/1M
      price_completion: 0.0000004,
      context_length: 1048576, // 1M context
      modality: 'text->text',
      is_free: false,
      raw_json: {},
      polled_at: new Date().toISOString(),
    },
  ];

  it('1. Computes Median and Median Absolute Deviation (MAD) correctly', () => {
    const stats = computeRobustDeviation(sampleSnapshots);
    expect(stats.sampleSize).toBe(5);
    // Prices: 0.10, 0.14, 0.70, 2.50, 3.00. Median = 0.70
    expect(stats.median).toBe(0.70);
    expect(stats.mad).toBeGreaterThan(0);
  });

  it('2. Detects genuine pricing outliers using MAD distance with transparent evidence', () => {
    const signals = detectMarketSignals(sampleSnapshots, []);
    expect(signals.length).toBeGreaterThanOrEqual(2);

    const priceAnomaly = signals.find((s) => s.signal_type === 'PRICE_ANOMALY');
    expect(priceAnomaly).toBeDefined();
    expect(priceAnomaly?.evidence.metric).toContain('Median Absolute Deviation');
    expect(priceAnomaly?.evidence.deviation).toContain('MAD');

    const contextBreakthrough = signals.find((s) => s.signal_type === 'CONTEXT_BREAKTHROUGH');
    expect(contextBreakthrough).toBeDefined();
  });
});
