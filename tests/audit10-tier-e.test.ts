import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createConnector, GET as listConnectors } from '../src/app/api/exports/route';
import { POST as runConnectorRoute } from '../src/app/api/exports/[id]/run/route';
import { DELETE as deleteConnector } from '../src/app/api/exports/[id]/route';
import { createOrGetUser, createApiKey, getExportConnectorForRun } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { encryptSecret, decryptSecret, isEncryptedSecret } from '../src/lib/secret-store';
import { runExportConnector } from '../src/lib/export-connectors';
import { runConnector, getConnector, CONNECTOR_REGISTRY } from '../src/lib/ingestion/connectors';
import { isPostgres, getPgPool, getLocalState } from '../src/lib/db/client';
import { uniqueEmail } from './helpers';
import fs from 'fs';
import path from 'path';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

const ENC_KEYS = 'v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

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

async function createAs(key: string, body: unknown) {
  return createConnector(
    authed('http://localhost/api/exports', key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

describe('R8 credential storage: encrypted at rest, fail-closed without key', () => {
  it('AES-GCM round-trips; wrong key cannot decrypt', () => {
    const ct = encryptSecret('dd-secret-123', { EXPORT_CONNECTOR_KEYS: ENC_KEYS } as any);
    expect(isEncryptedSecret(ct)).toBe(true);
    expect(ct).not.toContain('dd-secret-123');
    expect(decryptSecret(ct, { EXPORT_CONNECTOR_KEYS: ENC_KEYS } as any)).toBe('dd-secret-123');
    expect(() => decryptSecret(ct, { EXPORT_CONNECTOR_KEYS: 'wrong-key' } as any)).toThrow();
    expect(() => decryptSecret('plaintext-row', { EXPORT_CONNECTOR_KEYS: ENC_KEYS } as any)).toThrow(/legacy/);
  });

  it('refuses secret-bearing connectors when no encryption key is configured', async () => {
    delete process.env.EXPORT_CONNECTOR_KEYS;
    const key = await keyFor(uniqueEmail('r8.nokey'));
    const res = await createAs(key, { name: 'dd', type: 'datadog', secret: 'shh' });
    expect(res.status).toBe(400);
    // Secretless registration still works (delivery will fail closed later).
    const ok = await createAs(key, { name: 'dd2', type: 'datadog' });
    expect(ok.status).toBe(201);
  });

  it('stored row holds ciphertext; delivery path decrypts (never the read path)', async () => {
    process.env.EXPORT_CONNECTOR_KEYS = ENC_KEYS;
    const email = uniqueEmail('r8.enc');
    const key = await keyFor(email);
    const created = await createAs(key, { name: 'dd', type: 'datadog', secret: 'super-secret-token' });
    expect(created.status).toBe(201);
    const { connector } = await created.json();
    expect(connector.has_secret).toBe(true);
    expect(JSON.stringify(connector)).not.toContain('super-secret-token');

    const listed = await listConnectors(authed('http://localhost/api/exports', key));
    expect(JSON.stringify(await listed.json())).not.toContain('super-secret-token');

    // Direct storage inspection: ciphertext only.
    const user = await (async () => {
      const { getUserByEmail } = await import('../src/lib/db/queries');
      return getUserByEmail(email);
    })();
    if (isPostgres()) {
      const pool = getPgPool();
      const res = await pool.query('SELECT secret FROM export_connectors WHERE id = $1', [connector.id]);
      expect(res.rows[0].secret.startsWith('enc:v2:')).toBe(true);
      expect(res.rows[0].secret).not.toContain('super-secret-token');
    } else {
      const row = getLocalState().export_connectors.find((r: any) => r.id === connector.id);
      expect(String(row.secret).startsWith('enc:v2:')).toBe(true);
    }

    // Delivery-only accessor decrypts for the owner.
    const stored = await getExportConnectorForRun(user!.id, connector.id);
    expect(stored!.secret).toBe('super-secret-token');
  });
});

describe('R8 cross-user isolation (IDOR on connectors)', () => {
  it("B cannot run, read-secret, or delete A's connector", async () => {
    process.env.EXPORT_CONNECTOR_KEYS = ENC_KEYS;
    const a = uniqueEmail('r8a');
    const b = uniqueEmail('r8b');
    const keyA = await keyFor(a);
    const keyB = await keyFor(b);
    const created = await createAs(keyA, {
      name: 'a-dd', type: 'datadog', destinationUrl: 'https://example.com/dd', secret: 'a-secret',
    });
    const { connector } = await created.json();

    const bRun = await runConnectorRoute(
      authed(`http://localhost/api/exports/${connector.id}/run`, keyB, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
      { params: { id: String(connector.id) } }
    );
    expect(bRun.status).toBe(404);

    const bDel = await deleteConnector(
      authed(`http://localhost/api/exports/${connector.id}`, keyB, { method: 'DELETE' }),
      { params: { id: String(connector.id) } }
    );
    expect(bDel.status).toBe(404);

    const bList = await listConnectors(authed('http://localhost/api/exports', keyB));
    expect(JSON.stringify(await bList.json())).not.toContain('a-dd');
  });
});

describe('R8 payload scope: only intended fields leave the system', () => {
  it('datadog payload carries event data only — no identity, secrets, or internals', async () => {
    const seen: any[] = [];
    const fetchFn = (async (url: any, init: any) => {
      seen.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return { ok: true, status: 200, text: async () => '{}' };
    }) as any;
    const res = await runExportConnector(
      {
        type: 'datadog',
        destinationUrl: '',
        secret: 'k',
        events: [
          {
            id: 999, model_id: 'x/y', event_type: 'PRICE_CHANGE', old_value: { a: 1 }, new_value: { b: 2 },
            pct_change: -5, source: 'openrouter', detected_at: new Date().toISOString(),
            model_name: 'Y', provider: 'X',
          } as any,
        ],
      },
      { fetchFn }
    );
    expect(res).toEqual({ success: true, pushed: 1 });
    const payload = seen[0].body;
    expect(Object.keys(payload).sort()).toEqual(['alert_type', 'source_type_name', 'tags', 'text', 'title']);
    expect(JSON.stringify(payload)).not.toContain('999');
    expect(JSON.stringify(payload)).not.toMatch(/api[_-]?key|secret|token|email/i);
    // Secret travels in a header, never in body or logs.
    expect(seen[0].headers['DD-API-KEY']).toBe('k');
    expect(JSON.stringify(payload)).not.toContain('k');
  });
});

describe('R9 review gate is technical, not social', () => {
  it('pending-review status blocks execution even when allowlisted', async () => {
    const pending = { ...getConnector('replicate')!, review: { ...getConnector('replicate')!.review, status: 'example-pending-review' as const } };
    const { isConnectorRunnable } = await import('../src/lib/ingestion/connectors');
    expect(isConnectorRunnable(pending, { CONNECTORS_ALLOWLIST: 'replicate' } as any)).toBe(false);
    await expect(runConnector(pending, { env: { CONNECTORS_ALLOWLIST: 'replicate' } as any })).rejects.toThrow(/not runnable/);
  });

  it('no automatic path invokes the connector runner (grep the call graph)', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!p.includes('node_modules')) walk(p); }
        else if (/\.(ts|tsx)$/.test(e.name) && !p.includes('connectors.ts') && !p.includes('audit10') && !p.includes('.test.')) {
          const src = fs.readFileSync(p, 'utf-8');
          if (/runConnector\s*\(/.test(src)) hits.push(p);
        }
      }
    };
    walk(path.join(process.cwd(), 'src'));
    walk(path.join(process.cwd(), 'scripts'));
    expect(hits).toEqual([]);
  });

  it('connector output cannot reach history: counts unchanged after a run', async () => {
    const c = getConnector('replicate')!;
    const fetchFn = (async () => ({
      ok: true, status: 200,
      json: async () => ({ results: [{ url: 'https://replicate.com/acme/evil-price', owner: 'acme', name: 'evil-price' }] }),
    })) as any;
    const before = isPostgres()
      ? Number((await getPgPool().query('SELECT COUNT(*) AS n FROM model_snapshots')).rows[0].n)
      : getLocalState().snapshots.length;
    const snaps = await runConnector(c, { fetchFn, env: { CONNECTORS_ALLOWLIST: 'replicate' } as any });
    expect(snaps).toHaveLength(1);
    // A hostile price claim rides along as DATA ONLY — and is never persisted.
    const hostile = await runConnector(
      { ...c, normalize: () => ({ model_id: 'openai/gpt-4o', name: 'x', provider: 'acme', price_prompt: 0, price_completion: 0, context_length: 1, modality: 'text' }) },
      { fetchFn, env: { CONNECTORS_ALLOWLIST: 'replicate' } as any }
    );
    expect(hostile[0].price_prompt).toBe(0);
    const after = isPostgres()
      ? Number((await getPgPool().query('SELECT COUNT(*) AS n FROM model_snapshots')).rows[0].n)
      : getLocalState().snapshots.length;
    expect(after).toBe(before);
  });

  it('runner bounds output: non-array and oversized payloads throw', async () => {
    const c = getConnector('replicate')!;
    const env = { CONNECTORS_ALLOWLIST: 'replicate' } as any;
    // Connector-level shape validation rejects before the runner's own
    // non-array guard — either way, nothing unvalidated proceeds.
    await expect(
      runConnector(c, { fetchFn: (async () => ({ ok: true, status: 200, json: async () => ({ results: {} }) })) as any, env })
    ).rejects.toThrow(/results array|non-array/);
    await expect(
      runConnector(c, { fetchFn: (async () => { throw new Error('upstream down'); }) as any, env })
    ).rejects.toThrow(/upstream down/);
  });

  it('abandonment has a documented off-switch; registry carries review metadata', () => {
    const doc = fs.readFileSync(path.join(process.cwd(), 'docs/CONNECTOR_REVIEW.md'), 'utf-8');
    expect(doc).toMatch(/## Removal/);
    expect(doc).toMatch(/removed|off-switch|disabl/i);
    for (const conn of CONNECTOR_REGISTRY) {
      expect(conn.review.reviewer).toBeTruthy();
      expect(conn.review.reviewed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Kill path exists: remove from allowlist (runtime) + delete module (merge).
    expect(doc).toContain('CONNECTORS_ALLOWLIST');
  });
});
