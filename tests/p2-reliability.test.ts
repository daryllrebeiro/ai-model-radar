import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { checkRoutingSLO } from '../src/lib/routing/slo';
import { runConnector, withTimeout } from '../src/lib/ingestion/connectors';
import { runExportConnector } from '../src/lib/export-connectors';
import { POST as runExportRoute } from '../src/app/api/exports/[id]/run/route';
import { createOrGetUser, createApiKey, createExportConnector, insertEvents } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { uniqueEmail } from './helpers';
import type { RoutingReliability } from '../src/lib/db/routing';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

function rel(partial: Partial<RoutingReliability>): RoutingReliability {
  return {
    window_hours: 1, attempts: 100, success_rate: 1,
    p50_latency_ms: 50, p95_latency_ms: 100, by_policy: {}, ...partial,
  };
}

describe('P2 routing SLO verdicts (first alerts)', () => {
  it('empty window is not a breach; success/p95 breaches are', () => {
    expect(checkRoutingSLO(rel({ attempts: 0, success_rate: null })).breached).toBe(false);
    expect(checkRoutingSLO(rel({}))).toEqual({ breached: false, reasons: [] });
    const low = checkRoutingSLO(rel({ success_rate: 0.97 }));
    expect(low.breached).toBe(true);
    expect(low.reasons.join(' ')).toContain('0.97');
    const slow = checkRoutingSLO(rel({ p95_latency_ms: 400 }));
    expect(slow.breached).toBe(true);
    expect(slow.reasons.join(' ')).toContain('400');
  });
});

describe('P2 connector timeout enforcement', () => {
  it('withTimeout rejects with the connector message', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'boom-timeout')).rejects.toThrow('boom-timeout');
  });

  it('hanging connector fetch aborts via timeoutMs', async () => {
    const hanging = {
      key: 'hang',
      displayName: 'hang',
      review: { status: 'reviewed' as const, reviewer: 't', reviewed_at: '2026-01-01', notes: 't' },
      fetchRaw: () => new Promise<any[]>(() => {}),
      normalize: (r: unknown) => r as any,
    };
    await expect(
      runConnector(hanging, { env: { CONNECTORS_ALLOWLIST: 'hang' } as any, timeoutMs: 1000 })
    ).rejects.toThrow(/timed out after 1000ms/);
  }, 10000);
});

describe('P2 export deadline + DLQ coverage', () => {
  it('slow destination trips the overall deadline mid-push', async () => {
    const slowFetch = (async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { ok: true, status: 200, text: async () => '{}' };
    }) as any;
    const events = Array.from({ length: 20 }, (_, i) => ({
      id: i, model_id: 'x/y', event_type: 'PRICE_CHANGE', old_value: null, new_value: null,
      pct_change: -1, source: 't', detected_at: new Date().toISOString(), provider: 'X',
    })) as any;
    const res = await runExportConnector(
      { type: 'datadog', destinationUrl: 'https://dd.example.com/e', secret: 'k', events },
      { fetchFn: slowFetch, deadlineMs: 1000 }
    );
    expect(res.success).toBe(false);
    expect(res.deadlineExceeded).toBe(true);
    expect(res.pushed).toBeLessThan(20);
  }, 15000);

  it('failed export run parks a DLQ row and reports dlq_id', async () => {
    process.env.EXPORT_CONNECTOR_KEYS = 'v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const email = uniqueEmail('p2.dlq');
    await createOrGetUser({ email });
    const pair = generateApiKey(email, 'free');
    await createApiKey(pair.keyRecord);
    // Seed an event so the driver path (not the empty shortcut) executes.
    await insertEvents([
      {
        model_id: `p2/dlq-${Date.now()}`,
        event_type: 'PRICE_CHANGE',
        old_value: null,
        new_value: null,
        pct_change: -5,
        source: 'p2-test',
        detected_at: new Date().toISOString(),
      },
    ] as any);
    // Grafana with blank destination fails without network (config error) → DLQ path.
    const connector = await createExportConnector({
      userId: (await (await import('../src/lib/db/queries')).getUserByEmail(email))!.id,
      ownerEmail: email, name: 'g', type: 'grafana', destinationUrl: '',
    });
    const res = await runExportRoute(
      new NextRequest(`http://localhost/api/exports/${connector.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pair.plaintextKey}` },
        body: JSON.stringify({ limit: 3 }),
      }),
      { params: { id: String(connector.id) } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.dlq_id).not.toBeNull();
  });
});
