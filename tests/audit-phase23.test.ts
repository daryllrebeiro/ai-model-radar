import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { POST as chatRoute } from '../src/app/api/v1/chat/completions/route';
import { buildFailOpenBody } from '../src/lib/routing/forward';
import { POST as digestPOST } from '../src/app/api/cron/digest/route';
import { GET as dlqList } from '../src/app/api/alerts/dlq/route';
import { POST as exportRun } from '../src/app/api/exports/[id]/run/route';
import { GET as signalsRoute } from '../src/app/api/v1/signals/route';
import { GET as quotasRoute } from '../src/app/api/v1/quotas/route';
import {
  createOrGetUser,
  createApiKey,
  createRoutingOptIn,
  insertSnapshots,
  insertEvents,
} from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { getCachedSnapshotsMap, invalidateCatalogCache } from '../src/lib/catalog-cache';
import { runIngestionCycle } from '../src/lib/ingestion/runner';
import {
  recordSourceFailure,
  resetSourceBreakers,
} from '../src/lib/ingestion/circuit';
import { checkManifest } from '../scripts/package-extension';
import { uniqueEmail } from './helpers';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
  resetSourceBreakers();
  invalidateCatalogCache();
});

async function keyFor(email: string, tier: 'free' | 'developer' | 'production' = 'free') {
  await createOrGetUser({ email });
  const pair = generateApiKey(email, tier);
  await createApiKey(pair.keyRecord);
  return pair.plaintextKey;
}

describe('audit item 2: thinning differential + hook leak check', () => {
  it('route fail-open body structurally equals the lib builder', async () => {
    const email = uniqueEmail('aud.diff');
    const key = await keyFor(email, 'production');
    await insertSnapshots([
      {
        model_id: `auddiff/m-${Date.now()}`, provider: 'AudCo', name: 'AudDiff',
        price_prompt: 1, price_completion: 1, context_length: 1000,
        modality: 'text->text', is_free: false, raw_json: {},
        polled_at: new Date().toISOString(),
      },
    ] as any);
    process.env.ROUTING_ENABLED = 'true';
    process.env.ROUTING_PILOT_ALLOWLIST = email;
    process.env.ROUTING_UPSTREAM_BASE = 'http://127.0.0.1:1';
    process.env.ROUTING_UPSTREAM_KEY = 'k';
    await createRoutingOptIn(email);
    const modelId = `auddiff/m-${Date.now()}`;
    // NOTE: model must exist; re-query the id seeded above via prefix match is
    // unnecessary — use the exact id by re-seeding deterministically.
    const fixed = 'auddiff/fixed-model';
    await insertSnapshots([
      {
        model_id: fixed, provider: 'AudCo', name: 'AudFixed',
        price_prompt: 1, price_completion: 1, context_length: 1000,
        modality: 'text->text', is_free: false, raw_json: {},
        polled_at: new Date().toISOString(),
      },
    ] as any);
    void modelId;
    const res = await chatRoute(
      new NextRequest('http://localhost/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: fixed, messages: [{ role: 'user', content: 'hi' }], on_failure: 'fail_open_original',
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const expected = buildFailOpenBody(fixed, body.proxy_error) as any;
    expect(body.model).toBe(expected.model);
    expect(body.proxy_fallback).toBe(expected.proxy_fallback);
    expect(body.choices).toEqual(expected.choices);
    expect(body.usage).toEqual(expected.usage);
  });

  it('digest exposes hook status as boolean, never internal detail', async () => {
    process.env.CRON_SECRET = 'audit-cron-secret';
    const res = await digestPOST(
      new NextRequest('http://localhost/api/cron/digest', {
        method: 'POST',
        headers: { Authorization: 'Bearer audit-cron-secret' },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.compoundHookError).toBe('boolean');
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/hookErr|hook failed|stack|Error:/);
  });
});

describe('audit item 3: cache allowlist vs money paths', () => {
  const CACHED = [
    'src/app/api/v1/arbitrage/route.ts',
    'src/app/api/arbitrage/route.ts',
    'src/app/api/v1/stream/route.ts',
    'src/app/api/v1/signals/route.ts',
    'src/app/api/v1/recommend/route.ts',
    'src/app/api/v1/forecast/route.ts',
    'src/app/api/v1/ask/route.ts',
    'src/app/api/v1/forecast/backtest/route.ts',
  ];
  const FRESH = [
    'src/lib/ingestion/runner.ts',
    'src/app/api/v1/chat/completions/route.ts',
    'src/app/api/cron/digest/route.ts',
    'src/app/api/cron/probes/route.ts',
    'src/app/api/v1/governance/status/route.ts',
    'src/app/api/v1/governance/showback/route.ts',
    'src/app/api/v1/governance/eol/route.ts',
    'src/app/api/usage/imports/[id]/route.ts',
    'src/app/api/alerts/compound/[id]/test/route.ts',
  ];

  it('exactly the 8 staleness-tolerant routes cache; money paths stay fresh', () => {
    for (const f of CACHED) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf-8');
      expect(src, f).toContain('getCachedSnapshotsMap');
    }
    for (const f of FRESH) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf-8');
      // Money/decision paths must never READ cached data. The ingestion
      // runner legitimately imports invalidateCatalogCache (invalidation
      // is the freshness mechanism, not a read).
      expect(src, f).not.toContain('getCachedSnapshotsMap');
    }
  });

  it('successful ingestion invalidates the cache (TTL is backstop, not mechanism)', async () => {
    process.env.CATALOG_CACHE_TTL_MS = '600000';
    const prefix = `audinv.${Date.now()}`;
    const before = await getCachedSnapshotsMap();
    expect(before.has(`${prefix}/m0`)).toBe(false);
    await runIngestionCycle({
      customModels: [
        {
          model_id: `${prefix}/m0`, provider: 'AudInv', name: 'AudInv',
          price_prompt: 1, price_completion: 1, context_length: 100,
          modality: 'text->text', is_free: false, raw_json: {},
          polled_at: new Date().toISOString(),
        },
      ] as any,
    });
    const after = await getCachedSnapshotsMap();
    expect(after.has(`${prefix}/m0`)).toBe(true);
  });
});

describe('audit item 4: invite compare uses project-standard constant-time', () => {
  it('team-invites uses secretsEqual, no ad-hoc timingSafeEqual', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/team-invites.ts'), 'utf-8');
    expect(src).toContain('secretsEqual');
    expect(src).not.toContain('timingSafeEqual');
  });
});

describe('audit item 5: quotas isolation + metering boundary', () => {
  it('two keys see only their own tiers (no id parameter exists)', async () => {
    const freeKey = await keyFor(uniqueEmail('aud.qfree'));
    const devKey = await keyFor(uniqueEmail('aud.qdev'), 'developer');
    const ip = () => `10.92.${Math.floor(Math.random() * 200) + 1}.5`;
    const get = (key: string) =>
      quotasRoute(
        new NextRequest('http://localhost/api/v1/quotas', {
          headers: { Authorization: `Bearer ${key}`, 'x-forwarded-for': ip() },
        })
      );
    const freeBody = await (await get(freeKey)).json();
    const devBody = await (await get(devKey)).json();
    expect(freeBody.key_tier).toBe('free');
    expect(freeBody.access_tier).toBe('free');
    expect(devBody.key_tier).toBe('developer');
    expect(devBody.access_tier).toBe('pro');
    expect(devBody.quota.requests_per_window).toBeGreaterThan(freeBody.quota.requests_per_window);
    // No id/team substitution surface: schema-free GET with no params read.
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/api/v1/quotas/route.ts'), 'utf-8');
    expect(src).not.toMatch(/searchParams|teamId|userId/);
  });

  it('metering math is never imported by enforcement paths', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!p.includes('node_modules')) walk(p); }
        else if (/\.(ts|tsx)$/.test(e.name) && !p.includes('.test.') && !p.includes('metering.ts')) {
          // Import statements only — prose mentions in comments are not trust.
          if (/from\s+['"]@?\.?\.?\/?.*lib\/metering['"]/.test(fs.readFileSync(p, 'utf-8'))) hits.push(p);
        }
      }
    };
    walk(path.join(process.cwd(), 'src'));
    expect(hits).toEqual([]);
  });
});

describe('audit item 6: breaker-open ingestion is honest failed, not silent', () => {
  it('tripped breaker yields success:false + failed run entry with breaker detail', async () => {
    recordSourceFailure('openrouter', 'e1');
    recordSourceFailure('openrouter', 'e2');
    recordSourceFailure('openrouter', 'e3');
    const result = await runIngestionCycle();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/breaker is open/);
    const { getLatestIngestionRuns } = await import('../src/lib/db/queries');
    const runs = await getLatestIngestionRuns(5);
    const latest = runs.find((r) => r.source === 'openrouter');
    expect(latest?.status).toBe('failed');
    expect(latest?.error_detail).toMatch(/breaker is open/);
  });
});

describe('audit item 7: export DLQ rows are visible via the DLQ list', () => {
  it('failed export appears under rule export:<id>', async () => {
    process.env.EXPORT_CONNECTOR_KEYS = 'v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const email = uniqueEmail('aud.dlqvis');
    const key = await keyFor(email);
    const { getUserByEmail } = await import('../src/lib/db/queries');
    const user = (await getUserByEmail(email))!;
    const { createExportConnector } = await import('../src/lib/db/queries');
    await insertEvents([
      {
        model_id: `auddlq/m-${Date.now()}`, event_type: 'PRICE_CHANGE', old_value: null,
        new_value: null, pct_change: -5, source: 't', detected_at: new Date().toISOString(),
      },
    ] as any);
    const connector = await createExportConnector({
      userId: user.id, ownerEmail: email, name: 'g', type: 'grafana', destinationUrl: '',
    });
    const run = await exportRun(
      new NextRequest(`http://localhost/api/exports/${connector.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ limit: 3 }),
      }),
      { params: { id: String(connector.id) } }
    );
    const runBody = await run.json();
    expect(runBody.dlq_id).not.toBeNull();
    const listed = await dlqList(
      new NextRequest('http://localhost/api/alerts/dlq', {
        headers: { Authorization: `Bearer ${key}` },
      })
    );
    expect(listed.status).toBe(200);
    const { deliveries } = await listed.json();
    expect(deliveries.some((d: any) => d.rule_id === `export:${connector.id}`)).toBe(true);
  });
});

describe('audit item 9: anomalies carry evidence, never scores', () => {
  it('signals response has no confidence/score fields anywhere', async () => {
    const email = uniqueEmail('aud.anom');
    const key = await keyFor(email, 'production');
    const prefix = `audanom.${Date.now()}`;
    await insertSnapshots([
      {
        model_id: `${prefix}/m`, provider: 'AudAn', name: 'AudAn',
        price_prompt: 1, price_completion: 1, context_length: 100,
        modality: 'text->text', is_free: false, raw_json: {},
        polled_at: new Date().toISOString(),
      },
    ] as any);
    for (let i = 0; i < 3; i++) {
      await insertEvents([
        {
          model_id: `${prefix}/m`, event_type: 'PRICE_CHANGE', old_value: null,
          new_value: null, pct_change: -10 - i, source: 't', detected_at: new Date().toISOString(),
        },
      ] as any);
    }
    const res = await signalsRoute(
      new NextRequest('http://localhost/api/v1/signals?limit=50', {
        headers: { Authorization: `Bearer ${key}`, 'x-forwarded-for': `10.93.${Math.floor(Math.random() * 200) + 1}.5` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const churn = (body.anomalies as any[]).find((a) => a.kind === 'price_churn' && a.model_id === `${prefix}/m`);
    expect(churn).toBeTruthy();
    expect(churn.event_ids.length).toBeGreaterThanOrEqual(3);
    const raw = JSON.stringify(body.anomalies);
    expect(raw).not.toMatch(/confidence|"(elo_score|score|certainty)"/);
  });
});

describe('audit item 10: packaging refuses over-broad manifests', () => {
  function scaffold(manifest: unknown, privacy: boolean): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-audit-'));
    fs.mkdirSync(path.join(dir, 'extensions', 'browser'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'extensions', 'browser', 'manifest.json'), JSON.stringify(manifest));
    if (privacy) fs.writeFileSync(path.join(dir, 'extensions', 'browser', 'PRIVACY.md'), '# privacy');
    return dir;
  }

  const goodManifest = () => ({
    content_scripts: [{ matches: ['https://openrouter.ai/models/*'] }],
  });

  it('real tree passes; <all_urls> and missing PRIVACY.md fail the build', () => {
    expect(checkManifest(process.cwd()).matches).toBeGreaterThan(0);
    const evil = scaffold({ content_scripts: [{ matches: ['<all_urls>'] }] }, true);
    expect(() => checkManifest(evil)).toThrow(/<all_urls>/);
    const nopriv = scaffold(goodManifest(), false);
    expect(() => checkManifest(nopriv)).toThrow(/PRIVACY/);
    const empty = scaffold({ content_scripts: [{ matches: [] }] }, true);
    expect(() => checkManifest(empty)).toThrow(/no content-script matches/);
  });
});
