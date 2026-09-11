import { describe, it, expect } from 'vitest';
import {
  forwardToUpstream,
  buildFailOpenBody,
} from '../src/lib/routing/forward';
import {
  evaluateCompoundForDigest,
  renderCompoundSections,
  appendCompoundSections,
} from '../src/lib/compound-digest';
import type { ModelEvent } from '../src/types/events';

function evt(partial: Partial<ModelEvent>): ModelEvent {
  return {
    id: 1,
    model_id: 'a/b',
    event_type: 'PRICE_CHANGE',
    old_value: null,
    new_value: null,
    pct_change: -20,
    source: 't',
    detected_at: new Date().toISOString(),
    provider: 'Acme',
    ...partial,
  } as ModelEvent;
}

describe('routing/forward (extracted thin-route unit)', () => {
  it('single attempt, no retry: timeout surfaces as error with overhead', async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      const err: any = new Error('socket hangup');
      err.name = 'AbortError';
      throw err;
    }) as any;
    const res = await forwardToUpstream({
      upstreamBase: 'https://up.example',
      upstreamKey: 'k',
      body: { messages: [] },
      selectedModelId: 'a/b',
      timeoutMs: 50,
      fetchFn,
    });
    expect(calls).toBe(1);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Upstream timeout');
    expect(res.overheadMs).toBeGreaterThanOrEqual(0);
  });

  it('forwards selected model; success returns payload verbatim', async () => {
    const seen: any[] = [];
    const fetchFn = (async (url: any, init: any) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ hello: 'world' }) };
    }) as any;
    const res = await forwardToUpstream({
      upstreamBase: 'https://up.example/',
      upstreamKey: 'k',
      body: { messages: [{ role: 'user', content: 'hi' }] },
      selectedModelId: 'a/b',
      fetchFn,
    });
    expect(res.ok).toBe(true);
    expect(res.payload).toEqual({ hello: 'world' });
    expect(seen[0].body.model).toBe('a/b');
  });

  it('fail-open body names the original model and flags explicitly', () => {
    const body = buildFailOpenBody('orig/m', 'boom') as any;
    expect(body.model).toBe('orig/m');
    expect(body.proxy_fallback).toBe(true);
    expect(body.proxy_error).toBe('boom');
    expect(JSON.stringify(body)).not.toContain('substitut');
  });
});

describe('compound-digest (extracted hook unit)', () => {
  const rule = {
    id: 7,
    name: 'drops',
    logic: 'and' as const,
    conditions: [{ field: 'price_drop_pct' as const, op: 'gte' as const, value: 10 }],
    owner_email: 'Owner@Test.dev',
  };

  it('groups matches per owner; hook errors surface as flag, never throw', async () => {
    const { byOwner, hookError } = await evaluateCompoundForDigest({
      events: [evt({})],
      snapshots: new Map(),
      batchEmails: ['owner@test.dev'],
      listRules: async () => [rule],
    });
    expect(hookError).toBe(false);
    expect(byOwner.get('owner@test.dev')).toHaveLength(1);

    const failed = await evaluateCompoundForDigest({
      events: [evt({})],
      snapshots: new Map(),
      batchEmails: ['x@y.z'],
      listRules: async () => {
        throw new Error('db down');
      },
    });
    expect(failed.hookError).toBe(true);
    expect(failed.byOwner.size).toBe(0);
  });

  it('rendering escapes hostile rule names and reasons', () => {
    const html = renderCompoundSections([
      {
        ruleId: 1,
        ruleName: '<script>alert(1)</script>',
        matches: [{ model_id: 'a/b', event_type: 'X', detected_at: 't', reasons: ['a<b'] }],
      },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    const { html: appended, delivered } = appendCompoundSections('<html><body></body></html>', []);
    expect(delivered).toBe(0);
    expect(appended).toContain('</body>');
  });
});
