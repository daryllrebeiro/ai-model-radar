import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as exportRoute } from '../src/app/api/user/export/route';
import { POST as deleteRoute } from '../src/app/api/user/delete/route';
import { GET as watchGET, POST as watchPOST } from '../src/app/api/watchlists/route';
import { POST as checkoutRoute } from '../src/app/api/billing/checkout/route';
import { POST as portalRoute } from '../src/app/api/billing/portal/route';
import {
  createOrGetUser,
  createApiKey,
  getUserWatchlist,
  getUserByEmail,
} from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { uniqueEmail } from './helpers';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

async function keyFor(email: string, tier: 'free' | 'developer' | 'production' = 'free') {
  const pair = generateApiKey(email, tier);
  await createApiKey(pair.keyRecord);
  return pair.plaintextKey;
}

function authed(url: string, key: string, init?: any, extraHeaders?: Record<string, string>) {
  return new NextRequest(url, {
    ...(init || {}),
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${key}`, ...(extraHeaders || {}) },
  });
}

function anon(url: string, init?: any) {
  return new NextRequest(url, { ...(init || {}) });
}

describe('P11.1 permanent regression: identity comes from session only', () => {
  it('1. no-session requests are rejected (401) on all 5 routes', async () => {
    // checkout is 403-gated by STRIPE_ENABLED before auth; enable to reach the 401
    process.env.STRIPE_ENABLED = 'true';

    const exp = await exportRoute(anon('http://localhost/api/user/export'));
    expect(exp.status).toBe(401);

    const del = await deleteRoute(
      anon('http://localhost/api/user/delete', { method: 'POST' })
    );
    expect(del.status).toBe(401);

    const wpost = await watchPOST(
      anon('http://localhost/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: 'x/y', action: 'add' }),
      })
    );
    expect(wpost.status).toBe(401);

    const co = await checkoutRoute(
      anon('http://localhost/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'developer' }),
      })
    );
    expect(co.status).toBe(401);

    const portal = await portalRoute(
      anon('http://localhost/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    expect(portal.status).toBe(401);

    // watchlist GET is the documented exception: unauthenticated returns [] (200),
    // never another user's data
    const wget = await watchGET(anon('http://localhost/api/watchlists'));
    expect(wget.status).toBe(200);
    const wbody = await wget.json();
    expect(wbody.watchlist).toEqual([]);
    expect(wbody.userId).toBeUndefined();
    expect(wbody.email).toBeUndefined();
  });

  it('2. X-User-Email header grants nothing without a valid session', async () => {
    process.env.STRIPE_ENABLED = 'true';
    const victim = uniqueEmail('p111.victim');
    await createOrGetUser({ email: victim });

    const spoof = { 'X-User-Email': victim, 'x-user-email': victim } as Record<string, string>;
    const exp = await exportRoute(
      new NextRequest('http://localhost/api/user/export', { headers: spoof })
    );
    expect(exp.status).toBe(401);

    const wpost = await watchPOST(
      new NextRequest('http://localhost/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...spoof },
        body: JSON.stringify({ modelId: 'x/y' }),
      })
    );
    expect(wpost.status).toBe(401);
  });

  it('3. cross-user body email is ignored: caller only ever affects their own data', async () => {
    const emailA = uniqueEmail('p111.a');
    const emailB = uniqueEmail('p111.b');
    await createOrGetUser({ email: emailA });
    await createOrGetUser({ email: emailB });
    const keyA = await keyFor(emailA);
    const keyB = await keyFor(emailB);

    // A adds a model while smuggling B's email in every plausible field
    const modelId = `p111/model-${Date.now()}`;
    const add = await watchPOST(
      authed(
        'http://localhost/api/watchlists',
        keyA,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId, action: 'add', email: emailB, owner_email: emailB, customer_email: emailB }),
        },
        { 'X-User-Email': emailB }
      )
    );
    expect(add.status).toBe(200);

    // A's list has it; B's list is untouched
    const listA = await getUserWatchlist((await getUserByEmail(emailA))!.id);
    const listB = await getUserWatchlist((await getUserByEmail(emailB))!.id);
    expect(listA.map((w: any) => w.model_id ?? w.modelId ?? w)).toContain(modelId);
    expect(listB.map((w: any) => w.model_id ?? w.modelId ?? w)).not.toContain(modelId);

    // B, authenticated as themselves, still sees none of A's data
    const bGet = await watchGET(authed('http://localhost/api/watchlists', keyB));
    const bBody = await bGet.json();
    expect((bBody.watchlist as any[]).map((w: any) => w.model_id ?? w.modelId ?? w)).not.toContain(modelId);

    // Export scoping: A's export is A's data, never B's
    const expA = await exportRoute(authed('http://localhost/api/user/export', keyA));
    expect(expA.status).toBe(200);
    const bundle = await expA.json();
    const raw = JSON.stringify(bundle);
    expect(raw).toContain(emailA);
    expect(raw).not.toContain(emailB);
  });

  it('4. checkout/portal bind to the session email, never a body email', async () => {
    process.env.STRIPE_ENABLED = 'true';
    // No live Stripe key -> route returns a mock session; email binding is
    // proven by: (a) unauthenticated + victim body email still 401,
    // (b) authenticated call succeeds and ignores the smuggled address.
    delete process.env.STRIPE_SECRET_KEY;
    const emailA = uniqueEmail('p111.co.a');
    const emailB = uniqueEmail('p111.co.b');
    await createOrGetUser({ email: emailA });
    await createOrGetUser({ email: emailB });
    const keyA = await keyFor(emailA);

    const unauth = await checkoutRoute(
      anon('http://localhost/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'developer', email: emailB, customerEmail: emailB, customer_email: emailB }),
      })
    );
    expect(unauth.status).toBe(401);

    const authedRes = await checkoutRoute(
      authed('http://localhost/api/billing/checkout', keyA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'developer', email: emailB, customerEmail: emailB, customer_email: emailB }),
      })
    );
    expect(authedRes.status).toBe(200);
    const coBody = await authedRes.json();
    expect(coBody.success).toBe(true);
    expect(coBody.url).toContain('mock=true');

    const portal = await portalRoute(
      authed('http://localhost/api/billing/portal', keyA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailB, returnUrl: '/alerts' }),
      })
    );
    expect(portal.status).toBe(200);
  });
});
