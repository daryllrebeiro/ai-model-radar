import { describe, it, expect } from 'vitest';
import {
  pairDeprecationEvents,
  computeDeprecationStats,
  buildDeprecationAnnouncementEvent,
  DEPRECATION_MATURITY_MIN_PAIRS,
} from '../src/lib/deprecation';
import { ModelEvent } from '../src/types/events';

function ev(model_id: string, type: ModelEvent['event_type'], detected_at: string): ModelEvent {
  return {
    model_id,
    event_type: type,
    old_value: null,
    new_value: type === 'DEPRECATION_ANNOUNCED' ? { source_url: 'https://example.com/changelog' } : null,
    pct_change: null,
    source: 'provider-changelog',
    detected_at,
    provider: model_id.split('/')[0],
  };
}

describe('S1 deprecation track record (sourced pairs only)', () => {
  it('pairs announcement with later removal; ignores unpaired', () => {
    const events = [
      ev('acme/m1', 'DEPRECATION_ANNOUNCED', '2026-01-01T00:00:00Z'),
      ev('acme/m1', 'MODEL_REMOVED', '2026-01-31T00:00:00Z'),
      ev('acme/m2', 'MODEL_REMOVED', '2026-02-01T00:00:00Z'), // no announcement → excluded
    ];
    const pairs = pairDeprecationEvents(events);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].days_notice).toBe(30);
  });

  it('removal before announcement never pairs (no negative notice)', () => {
    const events = [
      ev('acme/m1', 'MODEL_REMOVED', '2026-01-01T00:00:00Z'),
      ev('acme/m1', 'DEPRECATION_ANNOUNCED', '2026-02-01T00:00:00Z'),
    ];
    expect(pairDeprecationEvents(events)).toHaveLength(0);
  });

  it('stats show sample size; maturity gate at threshold', () => {
    const events: ModelEvent[] = [];
    for (let i = 0; i < DEPRECATION_MATURITY_MIN_PAIRS; i++) {
      events.push(ev(`acme/m${i}`, 'DEPRECATION_ANNOUNCED', '2026-01-01T00:00:00Z'));
      events.push(ev(`acme/m${i}`, 'MODEL_REMOVED', '2026-01-11T00:00:00Z'));
    }
    const stats = computeDeprecationStats(events);
    expect(stats.total_pairs).toBe(DEPRECATION_MATURITY_MIN_PAIRS);
    expect(stats.mature).toBe(true);
    expect(stats.providers[0].median_days).toBe(10);
    expect(stats.providers[0].sample_size).toBe(DEPRECATION_MATURITY_MIN_PAIRS);
    const immature = computeDeprecationStats(events.slice(0, 2));
    expect(immature.mature).toBe(false);
  });

  it('announcement builder requires a real sourced URL', () => {
    const e = buildDeprecationAnnouncementEvent({
      model_id: 'acme/m1',
      announced_at: '2026-03-01T00:00:00Z',
      source_url: 'https://acme.dev/changelog/deprecate-m1',
    });
    expect(e.event_type).toBe('DEPRECATION_ANNOUNCED');
    expect((e.new_value as any).source_url).toContain('https://');
  });
});
