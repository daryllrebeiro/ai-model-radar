import { describe, it, expect } from 'vitest';
import { renderDigestHtml } from '../src/lib/email/resend';
import { ModelEvent } from '../src/types/events';
import { POPULAR_STACK_PRESETS } from '../src/components/onboarding/stack-onboarding-modal';

describe('Phase Q2: Personalized Home & Digest ("My Stack")', () => {
  const mockEvents: ModelEvent[] = [
    {
      id: 1,
      model_id: 'anthropic/claude-3-7-sonnet',
      model_name: 'Claude 3.7 Sonnet',
      provider: 'Anthropic',
      event_type: 'PRICE_CHANGE',
      old_value: { price_prompt: 0.000003 },
      new_value: { price_prompt: 0.000002 },
      diff_summary: { price_prompt_delta: -0.000001 },
      pct_change: -33.3,
      detected_at: new Date().toISOString(),
    },
    {
      id: 2,
      model_id: 'openai/gpt-4o',
      model_name: 'GPT-4o',
      provider: 'OpenAI',
      event_type: 'CONTEXT_CHANGED',
      old_value: { context_length: 128000 },
      new_value: { context_length: 200000 },
      diff_summary: { context_length_delta: 72000 },
      pct_change: 56.2,
      detected_at: new Date().toISOString(),
    },
    {
      id: 3,
      model_id: 'other/random-unwatched-model',
      model_name: 'Random Model',
      provider: 'OtherHub',
      event_type: 'NEW_MODEL',
      old_value: null,
      new_value: { is_free: true },
      diff_summary: null,
      pct_change: null,
      detected_at: new Date().toISOString(),
    },
  ];

  it('1. Prioritizes watchlisted stack models at the top of the email digest', () => {
    const html = renderDigestHtml({
      recipientEmail: 'dev@company.com',
      recentEvents: mockEvents,
      timeframe: 'daily',
      watchlistModelIds: ['anthropic/claude-3-7-sonnet', 'openai/gpt-4o'],
    });

    // Check for prioritized Stack section
    expect(html).toContain('Updates To Your Stack');
    expect(html).toContain('Claude 3.7 Sonnet');
    expect(html).toContain('GPT-4o');
    expect(html).toContain('33% price cut');
    expect(html).toContain('Context window updated');
    expect(html).toContain('WATCHLIST');

    // Section comes before standard sections
    const stackPos = html.indexOf('Updates To Your Stack');
    const priceDropsPos = html.indexOf('Top Price Drops');
    expect(stackPos).toBeLessThan(priceDropsPos);
  });

  it('2. Falls back to clean global market digest when user has no watchlisted models', () => {
    const html = renderDigestHtml({
      recipientEmail: 'newbie@company.com',
      recentEvents: mockEvents,
      timeframe: 'daily',
      watchlistModelIds: [],
    });

    expect(html).not.toContain('Updates To Your Stack');
    expect(html).toContain('Top Price Drops');
    expect(html).toContain('New Model Releases');
  });

  it('3. Provides valid popular stack onboarding presets with canonical identifiers', () => {
    expect(POPULAR_STACK_PRESETS.length).toBeGreaterThanOrEqual(6);

    const hasClaude = POPULAR_STACK_PRESETS.some((p) => p.id === 'anthropic/claude-3-7-sonnet');
    const hasR1 = POPULAR_STACK_PRESETS.some((p) => p.id === 'deepseek/deepseek-r1');
    const hasGpt4o = POPULAR_STACK_PRESETS.some((p) => p.id === 'openai/gpt-4o');

    expect(hasClaude).toBe(true);
    expect(hasR1).toBe(true);
    expect(hasGpt4o).toBe(true);
  });
});
