/**
 * R8 — Third-party export integrations (Tier E).
 *
 * A small number of specific, well-supported connectors (datadog, grafana,
 * notion, airtable) pushing model events into destinations teams already
 * live in. NOT a generic integration platform. All HTTP goes through the
 * SSRF guard (destinations are user-configured); fetch is injectable for
 * tests. Secrets travel in headers only, never in logs or read responses.
 */
import { ModelEvent } from '@/types/events';
import { assertPublicHttpUrl } from './ssrf-guard';
import { logger } from './logger';

export type ExportConnectorType = 'datadog' | 'grafana' | 'notion' | 'airtable';

export interface ExportRunInput {
  type: ExportConnectorType;
  destinationUrl: string;
  secret?: string;
  events: ModelEvent[];
}

export interface ExportRunResult {
  success: boolean;
  pushed: number;
  error?: string;
}

type FetchFn = typeof fetch;

function eventLine(e: ModelEvent): string {
  const pct = e.pct_change !== null && e.pct_change !== undefined ? ` (${e.pct_change}%)` : '';
  return `${e.event_type}: ${e.model_id}${pct}`;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, fetchFn: FetchFn) {
  assertPublicHttpUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, text: text.slice(0, 500) };
  } finally {
    clearTimeout(timeout);
  }
}

async function runDatadog(input: ExportRunInput, fetchFn: FetchFn): Promise<ExportRunResult> {
  if (!input.secret) return { success: false, pushed: 0, error: 'Datadog requires an API key (secret).' };
  const url = input.destinationUrl || 'https://api.datadoghq.com/api/v1/events';
  let pushed = 0;
  for (const e of input.events.slice(0, 20)) {
    const r = await postJson(
      url,
      { 'DD-API-KEY': input.secret },
      {
        title: `[Radar] ${e.event_type} ${e.model_id}`,
        text: eventLine(e),
        tags: [`provider:${e.provider || 'unknown'}`, `event_type:${e.event_type}`, 'source:ai-model-radar'],
        alert_type: 'info',
        source_type_name: 'ai-model-radar',
      },
      fetchFn
    );
    if (!r.ok) return { success: false, pushed, error: `Datadog HTTP ${r.status}: ${r.text}` };
    pushed++;
  }
  return { success: true, pushed };
}

async function runGrafana(input: ExportRunInput, fetchFn: FetchFn): Promise<ExportRunResult> {
  if (!input.secret) return { success: false, pushed: 0, error: 'Grafana requires an API token (secret).' };
  if (!input.destinationUrl) return { success: false, pushed: 0, error: 'Grafana requires the instance base URL.' };
  const url = `${input.destinationUrl.replace(/\/$/, '')}/api/annotations`;
  let pushed = 0;
  for (const e of input.events.slice(0, 20)) {
    const r = await postJson(
      url,
      { Authorization: `Bearer ${input.secret}` },
      {
        time: new Date(e.detected_at).getTime(),
        tags: ['ai-model-radar', e.event_type, e.provider || 'unknown'],
        text: eventLine(e),
      },
      fetchFn
    );
    if (!r.ok) return { success: false, pushed, error: `Grafana HTTP ${r.status}: ${r.text}` };
    pushed++;
  }
  return { success: true, pushed };
}

async function runNotion(input: ExportRunInput, fetchFn: FetchFn): Promise<ExportRunResult> {
  if (!input.secret) return { success: false, pushed: 0, error: 'Notion requires an integration token (secret).' };
  if (!input.destinationUrl) return { success: false, pushed: 0, error: 'Notion requires a database ID (destination).' };
  let pushed = 0;
  for (const e of input.events.slice(0, 20)) {
    const r = await postJson(
      'https://api.notion.com/v1/pages',
      { Authorization: `Bearer ${input.secret}`, 'Notion-Version': '2022-06-28' },
      {
        parent: { database_id: input.destinationUrl },
        properties: {
          Name: { title: [{ text: { content: `[Radar] ${e.event_type} ${e.model_id}`.slice(0, 100) } }] },
          Event: { rich_text: [{ text: { content: eventLine(e).slice(0, 500) } }] },
          Detected: { date: { start: e.detected_at } },
        },
      },
      fetchFn
    );
    if (!r.ok) return { success: false, pushed, error: `Notion HTTP ${r.status}: ${r.text}` };
    pushed++;
  }
  return { success: true, pushed };
}

async function runAirtable(input: ExportRunInput, fetchFn: FetchFn): Promise<ExportRunResult> {
  if (!input.secret) return { success: false, pushed: 0, error: 'Airtable requires a personal access token (secret).' };
  if (!input.destinationUrl) {
    return { success: false, pushed: 0, error: 'Airtable requires the records endpoint URL (https://api.airtable.com/v0/{base}/{table}).' };
  }
  const records = input.events.slice(0, 10).map((e) => ({
    fields: { Event: e.event_type, Model: e.model_id, Detected: e.detected_at, Detail: eventLine(e).slice(0, 500) },
  }));
  if (records.length === 0) return { success: true, pushed: 0 };
  const r = await postJson(
    input.destinationUrl,
    { Authorization: `Bearer ${input.secret}` },
    { records },
    fetchFn
  );
  if (!r.ok) return { success: false, pushed: 0, error: `Airtable HTTP ${r.status}: ${r.text}` };
  return { success: true, pushed: records.length };
}

/** Runs one connector push over recent events. Secrets stay in headers only. */
export async function runExportConnector(
  input: ExportRunInput,
  opts: { fetchFn?: FetchFn } = {}
): Promise<ExportRunResult> {
  const fetchFn = opts.fetchFn || fetch;
  if (input.events.length === 0) return { success: true, pushed: 0 };
  try {
    switch (input.type) {
      case 'datadog': return await runDatadog(input, fetchFn);
      case 'grafana': return await runGrafana(input, fetchFn);
      case 'notion': return await runNotion(input, fetchFn);
      case 'airtable': return await runAirtable(input, fetchFn);
      default: return { success: false, pushed: 0, error: `Unknown connector type.` };
    }
  } catch (err: any) {
    logger.warn('Export connector run failed:', { type: input.type, error: err.message || String(err) });
    return { success: false, pushed: 0, error: err.message || 'Delivery failed.' };
  }
}
