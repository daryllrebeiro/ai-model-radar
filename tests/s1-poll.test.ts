import { describe, it, expect } from 'vitest';
import {
  matchesDeprecationLanguage,
  mentionsTrackedModel,
  scanChangelogItems,
  runChangelogPoll,
  CHANGELOG_SOURCES,
  ChangelogItem,
} from '../src/lib/ingestion/deprecation-changelog';

const KNOWN = ['openai/gpt-4o', 'anthropic/claude-3-7-sonnet'];

describe('P1-4 changelog poller (sourced announcements only)', () => {
  it('sources are curated https changelog pages', () => {
    expect(CHANGELOG_SOURCES.length).toBeGreaterThan(0);
    for (const s of CHANGELOG_SOURCES) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.provider.length).toBeGreaterThan(0);
    }
  });

  it('deprecation language is narrow (no false positives on feature news)', () => {
    expect(matchesDeprecationLanguage('GPT-4 model deprecated on June 1')).toBe(true);
    expect(matchesDeprecationLanguage('End of life for Claude 2')).toBe(true);
    expect(matchesDeprecationLanguage('Sunsetting legacy embeddings')).toBe(true);
    expect(matchesDeprecationLanguage('Introducing our fastest model yet')).toBe(false);
    expect(matchesDeprecationLanguage('GPT-4o now supports image input')).toBe(false);
  });

  it('requires a tracked-model mention (speculation without a model is dropped)', () => {
    expect(mentionsTrackedModel('GPT-4o is deprecated', KNOWN)).toBe('openai/gpt-4o');
    expect(mentionsTrackedModel('Some model might be deprecated someday', KNOWN)).toBeNull();
  });

  it('scan emits sourced events only for language+model pairs, deduped', () => {
    const items: ChangelogItem[] = [
      { title: 'Deprecating GPT-4o in favor of GPT-5', url: 'https://openai.com/changelog/1', published_at: '2026-09-01T00:00:00Z' },
      { title: 'Deprecating GPT-4o in favor of GPT-5', url: 'https://openai.com/changelog/1', published_at: '2026-09-01T00:00:00Z' },
      { title: 'Exciting new features', url: 'https://openai.com/changelog/2', published_at: '2026-09-01T00:00:00Z' },
      { title: 'Deprecating something unnamed', url: 'https://openai.com/changelog/3', published_at: '2026-09-01T00:00:00Z' },
    ];
    const events = scanChangelogItems(items, KNOWN);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('DEPRECATION_ANNOUNCED');
    expect((events[0].new_value as any).source_url).toContain('https://');
  });

  it('full cycle with stub fetch never touches the network, records the run', async () => {
    const html = `<html><body>
      <a href="https://openai.com/changelog/dep">Deprecating GPT-4o next quarter</a>
      <a href="https://openai.com/changelog/feat">New voice mode</a>
    </body></html>`;
    const fetchFn = (async () => ({ ok: true, status: 200, text: async () => html })) as any;
    const res = await runChangelogPoll({ knownModelIds: KNOWN, fetchFn, persist: false });
    expect(res.sources_checked).toBe(CHANGELOG_SOURCES.length);
    expect(res.items_seen).toBeGreaterThan(0);
    expect(res.events_emitted).toBeGreaterThanOrEqual(1);
  });

  it('failed sources degrade to partial/failed, never throw', async () => {
    const fetchFn = (async () => {
      throw new Error('DNS down');
    }) as any;
    const res = await runChangelogPoll({ knownModelIds: KNOWN, fetchFn, persist: false });
    expect(res.events_emitted).toBe(0);
    expect(res.errors.length).toBe(CHANGELOG_SOURCES.length);
  });
});
