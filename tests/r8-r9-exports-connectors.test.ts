import { describe, it, expect } from 'vitest';
import { runExportConnector } from '../src/lib/export-connectors';
import {
  validateConnectorRecords,
  getConnector,
  isConnectorRunnable,
  runConnector,
} from '../src/lib/ingestion/connectors';
import { normalizeReplicateModel } from '../src/lib/ingestion/replicate';
import type { ModelEvent } from '../src/types/events';

function evt(): ModelEvent[] {
  return [
    {
      id: 1,
      model_id: 'openai/gpt-4o',
      event_type: 'PRICE_CHANGE',
      old_value: null,
      new_value: null,
      pct_change: -20,
      source: 'openrouter',
      detected_at: new Date().toISOString(),
      model_name: 'GPT-4o',
      provider: 'OpenAI',
    } as ModelEvent,
  ];
}

describe('R8 export connectors (specific integrations, SSRF-guarded)', () => {
  it('datadog posts events with key header; failures reported, not thrown', async () => {
    const calls: any[] = [];
    const fetchFn = (async (url: any, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => '{}' };
    }) as any;
    const ok = await runExportConnector(
      { type: 'datadog', destinationUrl: '', secret: 'dd-test', events: evt() },
      { fetchFn }
    );
    expect(ok).toEqual({ success: true, pushed: 1 });
    expect(calls[0].url).toContain('datadoghq.com');
    expect(calls[0].init.headers['DD-API-KEY']).toBe('dd-test');

    const bad = await runExportConnector(
      { type: 'datadog', destinationUrl: '', secret: 'dd-test', events: evt() },
      {
        fetchFn: (async () => ({ ok: false, status: 403, text: async () => 'bad key' })) as any,
      }
    );
    expect(bad.success).toBe(false);
    expect(bad.error).toContain('403');
  });

  it('requires secrets where the destination needs them; empty events short-circuit', () => {
    return (async () => {
      const noSecret = await runExportConnector(
        { type: 'notion', destinationUrl: 'db123', events: evt() },
        { fetchFn: (async () => { throw new Error('must not call'); }) as any }
      );
      expect(noSecret.success).toBe(false);
      const empty = await runExportConnector(
        { type: 'grafana', destinationUrl: 'https://grafana.example.com', secret: 'x', events: [] },
        { fetchFn: (async () => { throw new Error('must not call'); }) as any }
      );
      expect(empty).toEqual({ success: true, pushed: 0 });
    })();
  });

  it('blocks non-public destinations via the SSRF guard', async () => {
    const res = await runExportConnector(
      { type: 'grafana', destinationUrl: 'http://169.254.169.254/', secret: 'x', events: evt() },
      { fetchFn: (async () => ({ ok: true, status: 200, text: async () => '{}' })) as any }
    );
    expect(res.success).toBe(false);
  });
});

describe('R9 connector system (review-and-merge, no marketplace)', () => {
  it('strict schema rejects garbage: bad prices, missing ids, absurd context', () => {
    expect(() =>
      validateConnectorRecords([{ model_id: 'a/b', name: 'B', provider: 'A', price_prompt: 'free' }])
    ).toThrow(/schema validation/);
    expect(() =>
      validateConnectorRecords([{ model_id: '', name: 'B', provider: 'A', price_prompt: null, price_completion: null, context_length: null }])
    ).toThrow();
    expect(() =>
      validateConnectorRecords([{ model_id: 'a/b', name: 'B', provider: 'A', price_prompt: -1, price_completion: null, context_length: null }])
    ).toThrow();
    const ok = validateConnectorRecords([
      { model_id: 'a/b', name: 'B', provider: 'A', price_prompt: null, price_completion: null, context_length: null },
    ]);
    expect(ok[0].modality).toBe('text->text');
  });

  it('replicate example maps fixtures; unknown stays null (never zero)', () => {
    const rec = normalizeReplicateModel({ url: 'https://replicate.com/meta/llama-3', owner: 'meta', name: 'llama-3' });
    expect(rec.model_id).toBe('meta/llama-3');
    expect(rec.price_prompt).toBeNull();
    expect(rec.price_completion).toBeNull();
    expect(() => normalizeReplicateModel({ owner: '', name: '' })).toThrow();
  });

  it('reviewed connector is unrunnable without allowlist; runnable with it', async () => {
    const c = getConnector('replicate')!;
    expect(c.review.status).toBe('reviewed');
    expect(isConnectorRunnable(c, {} as any)).toBe(false);
    await expect(runConnector(c, { env: {} as any })).rejects.toThrow(/not runnable/);

    const fetchFn = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ url: 'https://replicate.com/meta/llama-3', owner: 'meta', name: 'llama-3' }] }),
    })) as any;
    const snaps = await runConnector(c, {
      fetchFn,
      env: { CONNECTORS_ALLOWLIST: 'replicate' } as any,
      polledAt: '2026-09-10T00:00:00.000Z',
    });
    expect(snaps).toHaveLength(1);
    expect(snaps[0].model_id).toBe('meta/llama-3');
    expect(snaps[0].is_free).toBe(false);
  });
});
