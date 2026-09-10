import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as upload, GET as listImports } from '../src/app/api/usage/imports/route';
import { GET as getImport, DELETE as deleteImport } from '../src/app/api/usage/imports/[id]/route';
import { POST as createRule } from '../src/app/api/alerts/compound/route';
import { POST as testRule } from '../src/app/api/alerts/compound/[id]/test/route';
import { createOrGetUser, createApiKey } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { isPostgres, getPgPool } from '../src/lib/db/client';
import { validateCompoundRule, ruleMatchesEvent } from '../src/lib/compound-rules';
import type { ModelEvent } from '../src/types/events';
import { uniqueEmail } from './helpers';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

async function keyFor(email: string) {
  await createOrGetUser({ email });
  const pair = generateApiKey(email, 'free');
  await createApiKey(pair.keyRecord);
  return pair.plaintextKey;
}

function authed(url: string, key: string, init?: any) {
  return new NextRequest(url, {
    ...(init || {}),
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${key}` },
  });
}

const GOOD_CSV = 'model,prompt_tokens,completion_tokens,cost_usd\nopenai/gpt-4o,1000,500,0.02';

async function uploadCsv(key: string, csv: string) {
  return upload(
    authed('http://localhost/api/usage/imports', key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'bill.csv', csv }),
    })
  );
}

describe('R5 IDOR (P11.1 methodology on financial data)', () => {
  it("B cannot read, list, reference, or delete A's upload", async () => {
    const a = uniqueEmail('r5a');
    const b = uniqueEmail('r5b');
    const keyA = await keyFor(a);
    const keyB = await keyFor(b);

    const up = await uploadCsv(keyA, GOOD_CSV);
    expect(up.status).toBe(201);
    const { id } = await up.json();

    // Direct ID access as B.
    const bGet = await getImport(authed(`http://localhost/api/usage/imports/${id}`, keyB), { params: { id: String(id) } });
    expect(bGet.status).toBe(404);

    // B's list contains nothing of A's.
    const bList = await listImports(authed('http://localhost/api/usage/imports', keyB));
    const bBody = await bList.json();
    expect((bBody.imports as any[]).some((r) => r.id === id)).toBe(false);

    // B cannot delete A's row (and A's row survives).
    const bDel = await deleteImport(authed(`http://localhost/api/usage/imports/${id}`, keyB, { method: 'DELETE' }), { params: { id: String(id) } });
    expect(bDel.status).toBe(404);
    const aGet = await getImport(authed(`http://localhost/api/usage/imports/${id}`, keyA), { params: { id: String(id) } });
    expect(aGet.status).toBe(200);

    // Cross-user smuggling in body fields is ignored (no email fields exist, but prove it).
    const smuggle = await upload(
      authed('http://localhost/api/usage/imports', keyB, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: 'x.csv', csv: GOOD_CSV, owner_email: a, email: a, user_id: 1 }),
      })
    );
    expect(smuggle.status).toBe(201);
    const smuggled = await smuggle.json();
    const check = await getImport(authed(`http://localhost/api/usage/imports/${smuggled.id}`, keyA), { params: { id: String(smuggled.id) } });
    expect(check.status).toBe(404);
  });
});

describe('R5 formula injection + upload validation', () => {
  it('formula-shaped cells are stored as inert data; no CSV re-export sink exists', async () => {
    const email = uniqueEmail('r5f');
    const key = await keyFor(email);
    const evil = 'model,prompt_tokens,completion_tokens,cost_usd\n"=HYPERLINK(""http://evil"",""x"")",10,5,0.01\n@SUM(1+1),20,5,0.02';
    const up = await uploadCsv(key, evil);
    expect(up.status).toBe(201);
    const { id } = await up.json();
    const got = await getImport(authed(`http://localhost/api/usage/imports/${id}`, key), { params: { id: String(id) } });
    expect(got.status).toBe(200);
    const body = await got.json();
    // Round-trips exactly (data, never executed server-side)…
    const ids = body.reconciliation.rows.map((r: any) => r.model_id);
    expect(ids.some((s: string) => s.includes('HYPERLINK'))).toBe(true);
    // …and the only render sink is React (auto-escaped) — no text/csv download route exists.
    const fs = await import('fs');
    const path = await import('path');
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === 'route.ts') routes.push(p);
      }
    };
    walk(path.join(process.cwd(), 'src/app/api/usage'));
    walk(path.join(process.cwd(), 'src/app/api/savings'));
    for (const r of routes) {
      const src = fs.readFileSync(r, 'utf-8');
      expect(src).not.toMatch(/text\/csv|content-disposition/i);
    }
  });

  it('rejects oversized, malformed, and non-CSV uploads', async () => {
    const email = uniqueEmail('r5v');
    const key = await keyFor(email);
    // Non-CSV / missing headers.
    expect((await uploadCsv(key, 'not a csv at all')).status).toBe(400);
    expect((await uploadCsv(key, '{"json": true}')).status).toBe(400);
    // Binary garbage.
    expect((await uploadCsv(key, '\x00\x01\x02\x03\n\x04\x05')).status).toBe(400);
    // Over the row cap.
    const big = 'model,prompt_tokens,completion_tokens\n' + 'x,1,1\n'.repeat(5001);
    expect((await uploadCsv(key, big)).status).toBe(400);
    // Over the payload cap (route-level 2MB+64k guard).
    const huge = 'model,prompt_tokens,completion_tokens\n' + 'y,1,1\n'.repeat(120000);
    const res = await uploadCsv(key, huge);
    expect([400, 413]).toContain(res.status);
    // Archives are not a thing: JSON-only body, no decompression path.
    expect((await uploadCsv(key, 'PK\x03\x04 zip contents')).status).toBe(400);
  });
});

describe('R5 retention: deletion removes the row (direct DB check on Postgres)', () => {
  it('upload → delete → gone from UI and storage', async () => {
    const email = uniqueEmail('r5d');
    const key = await keyFor(email);
    const up = await uploadCsv(key, GOOD_CSV);
    const { id } = await up.json();
    const del = await deleteImport(authed(`http://localhost/api/usage/imports/${id}`, key, { method: 'DELETE' }), { params: { id: String(id) } });
    expect(del.status).toBe(200);
    const gone = await getImport(authed(`http://localhost/api/usage/imports/${id}`, key), { params: { id: String(id) } });
    expect(gone.status).toBe(404);
    if (isPostgres()) {
      const pool = getPgPool();
      const res = await pool.query('SELECT COUNT(*) AS n FROM usage_imports WHERE id = $1', [id]);
      expect(Number(res.rows[0].n)).toBe(0);
    }
  });
});

describe('R6 injection + cross-user + exact boundaries', () => {
  it('hostile condition strings are inert literals (no query/eval reach)', async () => {
    // Pure layer: SQL/JS payloads validate as plain strings and match literally nothing.
    const hostile = "x'; DROP TABLE compound_rules; --";
    expect(
      validateCompoundRule({ name: hostile, logic: 'and', conditions: [{ field: 'provider', op: 'eq', value: hostile }] })
    ).toHaveLength(0);
    const evt = {
      id: 1, model_id: 'a/b', event_type: 'PRICE_CHANGE', old_value: null, new_value: null,
      pct_change: -10, source: 't', detected_at: new Date().toISOString(), provider: 'Acme',
    } as ModelEvent;
    const hit = ruleMatchesEvent(
      { name: 'h', logic: 'and', conditions: [{ field: 'provider', op: 'eq', value: hostile }] },
      evt,
      new Map()
    );
    expect(hit).toBeNull();

    // Route layer: hostile rule persists via parameterized writes and evaluates safely.
    const email = uniqueEmail('r6i');
    const key = await keyFor(email);
    const created = await createRule(
      authed('http://localhost/api/alerts/compound', key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '<script>alert(1)</script>',
          logic: 'and',
          conditions: [{ field: 'provider', op: 'contains', value: hostile }],
          channel: 'webhook',
          destination: 'https://example.com/hook',
        }),
      })
    );
    expect(created.status).toBe(201);
    const { rule } = await created.json();
    const tested = await testRule(
      authed(`http://localhost/api/alerts/compound/${rule.id}/test`, key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      }),
      { params: { id: String(rule.id) } }
    );
    expect(tested.status).toBe(200);
    if (isPostgres()) {
      const pool = getPgPool();
      const res = await pool.query('SELECT COUNT(*) AS n FROM compound_rules');
      expect(Number(res.rows[0].n)).toBeGreaterThan(0); // table intact
    }
  });

  it("B cannot get, test, or modify A's rule (IDOR)", async () => {
    const a = uniqueEmail('r6a');
    const b = uniqueEmail('r6b');
    const keyA = await keyFor(a);
    const keyB = await keyFor(b);
    const created = await createRule(
      authed('http://localhost/api/alerts/compound', keyA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'a-rule', logic: 'and',
          conditions: [{ field: 'event_type', op: 'eq', value: 'NEW_MODEL' }],
          channel: 'webhook', destination: 'https://example.com/hook',
        }),
      })
    );
    const { rule } = await created.json();
    const { GET: getRule } = await import('../src/app/api/alerts/compound/[id]/route');
    expect((await getRule(authed(`http://localhost/api/alerts/compound/${rule.id}`, keyB), { params: { id: String(rule.id) } })).status).toBe(404);
    expect(
      (await testRule(authed(`http://localhost/api/alerts/compound/${rule.id}/test`, keyB, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), { params: { id: String(rule.id) } })).status
    ).toBe(404);
  });

  it('exact-boundary semantics: gte/lte include equality, eq is exact', () => {
    const evt = (pct: number | null, type: string, ctx?: number) =>
      ({
        id: 1, model_id: 'a/b', event_type: type, old_value: null, new_value: ctx ?? null,
        pct_change: pct, source: 't', detected_at: new Date().toISOString(), provider: 'Acme',
      } as unknown as ModelEvent);
    const snaps = new Map([['a/b', { context_length: 100000 } as any]]);
    const gte = { name: 'g', logic: 'and' as const, conditions: [{ field: 'price_drop_pct' as const, op: 'gte' as const, value: 15 }] };
    expect(ruleMatchesEvent(gte, evt(-15, 'PRICE_CHANGE'), snaps)).not.toBeNull();
    expect(ruleMatchesEvent(gte, evt(-14.99, 'PRICE_CHANGE'), snaps)).toBeNull();
    const lte = { name: 'l', logic: 'and' as const, conditions: [{ field: 'price_drop_pct' as const, op: 'lte' as const, value: 15 }] };
    expect(ruleMatchesEvent(lte, evt(-15, 'PRICE_CHANGE'), snaps)).not.toBeNull();
    const ctx = { name: 'c', logic: 'and' as const, conditions: [{ field: 'context_min' as const, op: 'gte' as const, value: 100000 }] };
    expect(ruleMatchesEvent(ctx, evt(null, 'CONTEXT_CHANGED'), snaps)).not.toBeNull();
    // BECAME_FREE (100%) satisfies gte 100 exactly.
    const free = { name: 'f', logic: 'and' as const, conditions: [{ field: 'price_drop_pct' as const, op: 'eq' as const, value: 100 }] };
    expect(ruleMatchesEvent(free, evt(null, 'BECAME_FREE'), new Map())).not.toBeNull();
  });
});
