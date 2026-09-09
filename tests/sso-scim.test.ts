import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { getSsoConfig, isSsoEmailAllowed, buildSsoProviderOptions } from '@/lib/sso';
import {
  createOrGetUser,
  createApiKey,
  getUserByEmail,
  setUserSso,
  setUserActive,
} from '@/lib/db/queries';
import { generateApiKey } from '@/lib/api-keys';
import { getSessionUser } from '@/lib/auth';
import {
  GET as listUsers,
  POST as createUser,
} from '@/app/api/scim/v2/Users/route';
import {
  GET as getUser,
  PATCH as patchUser,
  PUT as putUser,
  DELETE as deleteUser,
} from '@/app/api/scim/v2/Users/[id]/route';

const SCIM_TOKEN = 'scim-test-token-abc123';

beforeAll(() => {
  process.env.SCIM_TOKEN = SCIM_TOKEN;
});

function scimReq(path: string, token: string | null, init?: { method?: string; body?: string }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost${path}`, {
    method: init?.method || 'GET',
    body: init?.body,
    headers,
  });
}

describe('SSO config', () => {
  it('is disabled unless issuer, id, and secret are all set', () => {
    expect(getSsoConfig({} as any).enabled).toBe(false);
    expect(
      getSsoConfig({ SSO_OIDC_ISSUER: 'https://idp.test', SSO_OIDC_CLIENT_ID: 'x' } as any).enabled
    ).toBe(false);
    const full = getSsoConfig({
      SSO_OIDC_ISSUER: 'https://idp.test/',
      SSO_OIDC_CLIENT_ID: 'cid',
      SSO_OIDC_CLIENT_SECRET: 'csec',
      SSO_NAME: 'Acme IdP',
      SSO_ALLOWED_DOMAINS: 'Acme.com, acme.dev',
    } as any);
    expect(full.enabled).toBe(true);
    expect(full.issuer).toBe('https://idp.test');
    expect(full.name).toBe('Acme IdP');
    expect(full.allowedDomains).toEqual(['acme.com', 'acme.dev']);
  });

  it('enforces the domain allowlist case-insensitively', () => {
    expect(isSsoEmailAllowed('a@acme.com', [])).toBe(true);
    expect(isSsoEmailAllowed('A@ACME.COM', ['acme.com'])).toBe(true);
    expect(isSsoEmailAllowed('a@evil.com', ['acme.com'])).toBe(false);
  });

  it('builds OIDC discovery options or null', () => {
    expect(buildSsoProviderOptions(getSsoConfig({} as any))).toBeNull();
    const opts = buildSsoProviderOptions(
      getSsoConfig({
        SSO_OIDC_ISSUER: 'https://idp.test',
        SSO_OIDC_CLIENT_ID: 'cid',
        SSO_OIDC_CLIENT_SECRET: 'csec',
      } as any)
    );
    expect(opts?.wellKnown).toBe('https://idp.test/.well-known/openid-configuration');
    expect((opts?.authorization as any)?.params?.scope).toContain('openid');
  });
});

describe('SCIM auth', () => {
  it('rejects missing and wrong tokens identically', async () => {
    const noToken = await listUsers(scimReq('/api/scim/v2/Users', null));
    expect(noToken.status).toBe(401);
    const wrong = await listUsers(scimReq('/api/scim/v2/Users', 'wrong'));
    expect(wrong.status).toBe(401);
    expect(await noToken.json()).toEqual(await wrong.json());
  });
});

describe('SCIM Users lifecycle', () => {
  it('provisions, lists, filters, deactivates (revoking keys), and reactivates', async () => {
    const stamp = Date.now();
    const email = `scim.user.${stamp}@test.dev`;

    const created = await createUser(
      scimReq('/api/scim/v2/Users', SCIM_TOKEN, {
        method: 'POST',
        body: JSON.stringify({ userName: email }),
      })
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.userName).toBe(email);
    expect(createdBody.active).toBe(true);
    expect(created.headers.get('Location')).toContain('/api/scim/v2/Users/');
    const scimId = createdBody.id;

    const dup = await createUser(
      scimReq('/api/scim/v2/Users', SCIM_TOKEN, {
        method: 'POST',
        body: JSON.stringify({ userName: email }),
      })
    );
    expect(dup.status).toBe(409);

    const bad = await createUser(
      scimReq('/api/scim/v2/Users', SCIM_TOKEN, {
        method: 'POST',
        body: JSON.stringify({ userName: 'not-an-email' }),
      })
    );
    expect(bad.status).toBe(400);

    const filtered = await listUsers(
      scimReq(`/api/scim/v2/Users?filter=${encodeURIComponent(`userName eq "${email}"`)}`, SCIM_TOKEN)
    );
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json();
    expect(filteredBody.totalResults).toBe(1);
    expect(filteredBody.Resources[0].id).toBe(scimId);

    const badFilter = await listUsers(
      scimReq('/api/scim/v2/Users?filter=emails co "x"', SCIM_TOKEN)
    );
    expect(badFilter.status).toBe(400);

    const fetched = await getUser(
      scimReq(`/api/scim/v2/Users/${scimId}`, SCIM_TOKEN),
      { params: { id: scimId } }
    );
    expect(fetched.status).toBe(200);

    // Issue a key, then deactivate: the key must stop working immediately.
    const { plaintextKey, keyRecord } = generateApiKey(email, 'production');
    await createApiKey(keyRecord);
    const authed = () =>
      new NextRequest('http://localhost/api/v1/ask', {
        headers: { Authorization: `Bearer ${plaintextKey}` },
      }) as unknown as NextRequest;
    expect(await getSessionUser(authed())).not.toBeNull();

    const deactivated = await patchUser(
      scimReq(`/api/scim/v2/Users/${scimId}`, SCIM_TOKEN, {
        method: 'PATCH',
        body: JSON.stringify({ Operations: [{ op: 'replace', path: 'active', value: false }] }),
      }),
      { params: { id: scimId } }
    );
    expect(deactivated.status).toBe(200);
    expect((await deactivated.json()).active).toBe(false);
    expect((await getUserByEmail(email))?.deprovisioned).toBe(true);
    expect(await getSessionUser(authed())).toBeNull();

    const badOp = await patchUser(
      scimReq(`/api/scim/v2/Users/${scimId}`, SCIM_TOKEN, {
        method: 'PATCH',
        body: JSON.stringify({ Operations: [{ op: 'add', path: 'emails', value: [] }] }),
      }),
      { params: { id: scimId } }
    );
    expect(badOp.status).toBe(400);

    const reactivated = await patchUser(
      scimReq(`/api/scim/v2/Users/${scimId}`, SCIM_TOKEN, {
        method: 'PATCH',
        body: JSON.stringify({ Operations: [{ op: 'Replace', path: 'Active', value: true }] }),
      }),
      { params: { id: scimId } }
    );
    expect(reactivated.status).toBe(200);
    expect((await reactivated.json()).active).toBe(true);
    expect((await getUserByEmail(email))?.deprovisioned).toBe(false);
  });

  it('PUT enforces userName immutability; DELETE disables without hard-delete', async () => {
    const stamp = Date.now();
    const email = `scim.put.${stamp}@test.dev`;
    const created = await createUser(
      scimReq('/api/scim/v2/Users', SCIM_TOKEN, {
        method: 'POST',
        body: JSON.stringify({ userName: email }),
      })
    );
    const { id } = await created.json();

    const rename = await putUser(
      scimReq(`/api/scim/v2/Users/${id}`, SCIM_TOKEN, {
        method: 'PUT',
        body: JSON.stringify({ userName: 'other@test.dev', active: true }),
      }),
      { params: { id } }
    );
    expect(rename.status).toBe(400);

    const gone = await deleteUser(scimReq(`/api/scim/v2/Users/${id}`, SCIM_TOKEN, { method: 'DELETE' }), {
      params: { id },
    });
    expect(gone.status).toBe(204);
    expect((await getUserByEmail(email))?.deprovisioned).toBe(true);
    // History preserved: the row still exists for audit.
    expect(await getUserByEmail(email)).not.toBeNull();

    const missing = await getUser(scimReq('/api/scim/v2/Users/2147483000', SCIM_TOKEN), {
      params: { id: '2147483000' },
    });
    expect(missing.status).toBe(404);
  });
});

describe('SSO identity linkage', () => {
  it('links and re-links subject/issuer', async () => {
    const email = `sso.link.${Date.now()}@test.dev`;
    await createOrGetUser({ email });
    const first = await setUserSso(email, { subject: 'sub-1', issuer: 'https://idp.test' });
    expect(first?.sso_subject).toBe('sub-1');
    const second = await setUserSso(email, { subject: 'sub-2', issuer: 'https://idp2.test' });
    expect(second?.sso_subject).toBe('sub-2');
    expect(second?.sso_issuer).toBe('https://idp2.test');
    expect(await setUserSso('missing@test.dev', { subject: 'x', issuer: 'y' })).toBeNull();
  });

  it('setUserActive toggles the flag', async () => {
    const email = `sso.active.${Date.now()}@test.dev`;
    await createOrGetUser({ email });
    await setUserActive(email, false);
    expect((await getUserByEmail(email))?.deprovisioned).toBe(true);
    await setUserActive(email, true);
    expect((await getUserByEmail(email))?.deprovisioned).toBe(false);
  });
});
