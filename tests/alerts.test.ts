import { describe, it, expect } from 'vitest';
import { evaluateAlertRules, DEFAULT_ALERT_CONFIG } from '../src/lib/alerts';
import { ModelEvent } from '../src/types/events';

describe('Phase V3: Alert Rules & Digest Engine', () => {
  const mockEvents: ModelEvent[] = [
    {
      model_id: 'deepseek/deepseek-chat',
      event_type: 'PRICE_CHANGE',
      pct_change: -40.0, // Significant drop
      old_value: { price_prompt: 0.0000002 },
      new_value: { price_prompt: 0.00000012 },
      source: 'openrouter',
      detected_at: new Date().toISOString(),
      provider: 'DeepSeek',
    },
    {
      model_id: 'openai/gpt-4o-mini',
      event_type: 'PRICE_CHANGE',
      pct_change: -5.0, // Minor drop (below default 15% threshold)
      old_value: { price_prompt: 0.00000015 },
      new_value: { price_prompt: 0.00000014 },
      source: 'openrouter',
      detected_at: new Date().toISOString(),
      provider: 'OpenAI',
    },
    {
      model_id: 'meta-llama/llama-3.3-70b:free',
      event_type: 'BECAME_FREE',
      pct_change: -100.0,
      old_value: {},
      new_value: {},
      source: 'openrouter',
      detected_at: new Date().toISOString(),
      provider: 'Meta',
    },
  ];

  it('1. Filters out minor price drops below minPriceDropPct threshold', () => {
    const digest = evaluateAlertRules(mockEvents, {
      ...DEFAULT_ALERT_CONFIG,
      minPriceDropPct: 20, // 40% passes, 5% is filtered
    });

    expect(digest.priceDropEvents).toHaveLength(1);
    expect(digest.priceDropEvents[0].model_id).toBe('deepseek/deepseek-chat');
  });

  it('2. Captures free tier additions when alertOnFreeTier is true', () => {
    const digest = evaluateAlertRules(mockEvents, {
      ...DEFAULT_ALERT_CONFIG,
      alertOnFreeTier: true,
    });

    expect(digest.freeTierEvents).toHaveLength(1);
    expect(digest.freeTierEvents[0].event_type).toBe('BECAME_FREE');
  });
});
