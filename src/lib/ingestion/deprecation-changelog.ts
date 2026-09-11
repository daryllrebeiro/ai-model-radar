import { ModelEvent } from '@/types/events';
import { buildDeprecationAnnouncementEvent } from '../deprecation';
import { recordIngestionRun, insertEvents } from '../db/queries';
import { logger } from '../logger';

/**
 * P1-4 — S1 Phase-1 data collection: per-provider changelog/RSS monitoring.
 *
 * Reuses the ingestion-source pattern (fetch → scan → emit → ingestion_runs
 * audit row) applied to a new `changelog` source type. ONLY real, sourced
 * announcements count: an item must BOTH match deprecation language AND
 * name a tracked model id. Community speculation, forum posts, and
 * inferred dates are never ingested (S1 explicit non-goal).
 */

export interface ChangelogSource {
  provider: string;
  /** Public changelog/blog/RSS URL (code-curated, https only). */
  url: string;
  kind: 'rss' | 'html';
}

export const CHANGELOG_SOURCES: ChangelogSource[] = [
  { provider: 'OpenAI', url: 'https://openai.com/changelog/', kind: 'html' },
  { provider: 'OpenAI', url: 'https://openai.com/news/', kind: 'html' },
  { provider: 'Anthropic', url: 'https://www.anthropic.com/news', kind: 'html' },
  { provider: 'Google', url: 'https://developers.googleblog.com/', kind: 'html' },
  { provider: 'DeepSeek', url: 'https://api-docs.deepseek.com/news/', kind: 'html' },
];

/** Deprecation language — deliberately narrow to avoid false positives. */
export const DEPRECATION_PATTERNS: RegExp[] = [
  /\bdeprecat\w*\b/i,
  /\bend[-\s]?of[-\s]?life\b/i,
  /\bsunset(ting|ted)?\b/i,
  /\bdiscontinu\w*\b/i,
  /\bretir\w*\b.*\bmodel\b/i,
  /\bmodel\b.*\bretir\w*\b/i,
  /\bwill (no longer|stop) (be |serving|support)\b/i,
  /\bshutdown\b.*\b(api|model|endpoint)\b/i,
];

export interface ChangelogItem {
  title: string;
  url: string;
  published_at: string;
  snippet?: string;
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

function extractAnchors(html: string, baseUrl: string): ChangelogItem[] {
  const items: ChangelogItem[] = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]{1,300}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && items.length < 200) {
    const title = stripTags(m[2]).replace(/\s+/g, ' ').trim();
    if (title.length < 8) continue;
    let url = m[1];
    try {
      url = new URL(url, baseUrl).toString();
    } catch {
      continue;
    }
    if (!url.startsWith('https://')) continue;
    items.push({ title, url, published_at: new Date().toISOString() });
  }
  return items;
}

function extractRssItems(xml: string): ChangelogItem[] {
  const items: ChangelogItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const b of blocks.slice(0, 200)) {
    const title = (b.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const link = (b.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const pub = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '').trim();
    if (!title || !link.startsWith('https://')) continue;
    const t = pub ? new Date(pub) : new Date();
    items.push({ title, url: link, published_at: Number.isFinite(t.getTime()) ? t.toISOString() : new Date().toISOString() });
  }
  return items;
}

export function matchesDeprecationLanguage(text: string): boolean {
  return DEPRECATION_PATTERNS.some((re) => re.test(text));
}

/** Case-insensitive tracked-model mention (also matches :free variants). */
export function mentionsTrackedModel(text: string, knownModelIds: string[]): string | null {
  const lower = text.toLowerCase();
  for (const id of knownModelIds) {
    const base = id.toLowerCase().replace(/:free$/, '');
    if (base.length > 3 && lower.includes(base)) return id;
    // Bare model-name match (e.g. "GPT-4o" inside a changelog title).
    // Threshold 5 keeps common short names (gpt-4o) while refusing tiny
    // fragments (r1, v3) that would false-positive on prose.
    const short = base.split('/').pop() || '';
    if (short.length >= 5 && lower.includes(short)) return id;
  }
  return null;
}

/**
 * Pure scan: changelog items × tracked catalog → sourced announcement events.
 * Both gates must pass; anything else is dropped silently (not an error).
 */
export function scanChangelogItems(items: ChangelogItem[], knownModelIds: string[], source = 'provider-changelog'): ModelEvent[] {
  const events: ModelEvent[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!matchesDeprecationLanguage(item.title)) continue;
    const hit = mentionsTrackedModel(`${item.title} ${item.snippet || ''}`, knownModelIds);
    if (!hit) continue;
    const key = `${hit}::${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(
      buildDeprecationAnnouncementEvent({
        model_id: hit,
        announced_at: item.published_at,
        source_url: item.url,
        source,
      })
    );
  }
  return events;
}

export interface ChangelogPollResult {
  sources_checked: number;
  items_seen: number;
  events_emitted: number;
  errors: string[];
}

/**
 * Runs one poll cycle over all curated changelog sources. Network is
 * injected (fetchFn) so tests never touch the internet; set persist=true
 * only from the CRON-gated route.
 */
export async function runChangelogPoll(opts: {
  knownModelIds: string[];
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  persist?: boolean;
  asOf?: string;
}): Promise<ChangelogPollResult> {
  const { knownModelIds, fetchFn = fetch, timeoutMs = 15000, persist = false } = opts;
  const startedAt = opts.asOf || new Date().toISOString();
  let itemsSeen = 0;
  const allEvents: ModelEvent[] = [];
  const errors: string[] = [];
  let checked = 0;
  for (const src of CHANGELOG_SOURCES) {
    checked++;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(src.url, {
          headers: { 'User-Agent': 'AI-Model-Radar/1.0 deprecation-poller', Accept: 'text/html,application/rss+xml,application/xml' },
          signal: controller.signal,
          redirect: 'follow',
        });
        if (!res.ok) {
          errors.push(`${src.provider} ${src.url}: HTTP ${res.status}`);
          continue;
        }
        const text = await res.text();
        if (text.length > 2_000_000) {
          errors.push(`${src.provider} ${src.url}: body too large, skipped`);
          continue;
        }
        const items = src.kind === 'rss' ? extractRssItems(text) : extractAnchors(text, src.url);
        itemsSeen += items.length;
        allEvents.push(...scanChangelogItems(items, knownModelIds));
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: any) {
      errors.push(`${src.provider} ${src.url}: ${err?.name === 'AbortError' ? 'timeout' : err?.message || 'fetch failed'}`);
    }
  }
  if (persist && allEvents.length > 0) {
    await insertEvents(allEvents);
  }
  await recordIngestionRun({
    source: 'changelog',
    started_at: startedAt,
    status: errors.length === 0 ? 'success' : allEvents.length > 0 ? 'partial' : 'failed',
    models_seen: itemsSeen,
    events_emitted: allEvents.length,
    error_detail: errors.length > 0 ? errors.join('; ').slice(0, 2000) : undefined,
  });
  logger.info('changelog.poll.completed', { checked, itemsSeen, emitted: allEvents.length, errors: errors.length });
  return { sources_checked: checked, items_seen: itemsSeen, events_emitted: allEvents.length, errors };
}
