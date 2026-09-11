import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withPublicGuards } from '../src/lib/route-guards';
import { EVENT_NEW_VALUE_SCHEMAS, EventType } from '../src/types/events';
import { insertEvents } from '../src/lib/db/queries';

describe('P1-5 shared route guards (H1/H2 cant drift)', () => {
  it('rejects oversized bodies before reaching the handler', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const guarded = withPublicGuards(handler, { maxBytes: 100 });
    const res = await guarded(
      new NextRequest('http://localhost/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'content-length': '9999' },
        body: JSON.stringify({ a: 1 }),
      })
    );
    expect(res.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes valid requests through with handler result', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const guarded = withPublicGuards(handler, { maxBytes: 1024 * 1024 });
    const res = await guarded(
      new NextRequest('http://localhost/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a: 1 }),
      })
    );
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('P1-5 event new_value registry (no third undocumented shape)', () => {
  it('registry documents every event type', () => {
    const types: EventType[] = [
      'NEW_MODEL',
      'MODEL_REMOVED',
      'DEPRECATION_ANNOUNCED',
      'PRICE_CHANGE',
      'BECAME_FREE',
      'LEFT_FREE',
      'CONTEXT_CHANGED',
    ];
    for (const t of types) {
      expect(typeof EVENT_NEW_VALUE_SCHEMAS[t]).toBe('string');
      expect(EVENT_NEW_VALUE_SCHEMAS[t].length).toBeGreaterThan(0);
    }
  });

  it('insertEvents rejects inferred/forum announcement dates, accepts sourced ones', async () => {
    const bad = {
      model_id: `test/registry/${Date.now()}`,
      event_type: 'DEPRECATION_ANNOUNCED' as const,
      old_value: null,
      new_value: { note: 'someone said so on a forum' },
      pct_change: null,
      source: 'provider-changelog',
      detected_at: new Date().toISOString(),
    };
    await expect(insertEvents([bad])).rejects.toThrow(/source_url/);
    const good = {
      ...bad,
      new_value: { source_url: 'https://acme.dev/changelog/x', announced_at: new Date().toISOString() },
    };
    await expect(insertEvents([good])).resolves.toBeUndefined();
  });
});
