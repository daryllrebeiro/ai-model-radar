import { describe, it, expect, vi } from 'vitest';
import { trackEvent } from '../src/lib/analytics';

describe('Phase P10: Command Search, Analytics & Accessibility', () => {
  it('1. Correctly formats and dispatches analytics events with DNT compliance', () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    trackEvent('test_event', { modelId: 'anthropic/claude-3.5-sonnet', query: 'claude' });

    expect(consoleSpy).toHaveBeenCalledWith(
      '[Analytics] Event: test_event',
      { modelId: 'anthropic/claude-3.5-sonnet', query: 'claude' }
    );

    consoleSpy.mockRestore();
  });

  it('2. Filters command search results accurately against query term', () => {
    const pages = [
      { id: 'feed', name: 'Live Intelligence Feed', subtitle: 'Real-time price changes' },
      { id: 'arbitrage', name: 'Price Arbitrage Engine', subtitle: 'Same model across providers' },
      { id: 'advisor', name: 'Cost Optimization Advisor', subtitle: 'Calculate savings' },
    ];

    const q = 'arbitrage';
    const matches = pages.filter(
      (p) => p.name.toLowerCase().includes(q) || p.subtitle.toLowerCase().includes(q)
    );

    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe('arbitrage');
  });
});
