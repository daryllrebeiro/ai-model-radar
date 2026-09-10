import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as submitStudy, GET as listStudies } from '../src/app/api/savings/route';
import { DELETE as takedownStudy } from '../src/app/api/savings/[id]/route';
import {
  GET as modQueue,
  POST as moderate,
} from '../src/app/api/admin/savings/route';
import {
  createOrGetUser,
  createApiKey,
  listApprovedCaseStudies,
} from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { uniqueEmail } from './helpers';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

async function keyFor(email: string) {
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

const ADMIN = 'r7-admin-secret-xyz';

describe('R7 case studies (double opt-in + moderation)', () => {
  it('rejects submissions without explicit consent; accepts with consent as pending', async () => {
    const email = uniqueEmail('r7.consent');
    await createOrGetUser({ email });
    const key = await keyFor(email);
    const base = {
      from_model_id: 'a/x',
      to_model_id: 'b/y',
      savings_usd_per_month: 100,
    };
    const noConsent = await submitStudy(
      authed('http://localhost/api/savings', key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(base),
      })
    );
    expect(noConsent.status).toBe(400);

    const ok = await submitStudy(
      authed('http://localhost/api/savings', key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, consent: true, team_name: 'Acme' }),
      })
    );
    expect(ok.status).toBe(201);
    const body = await ok.json();
    expect(body.status).toBe('pending');

    // Pending is NOT public.
    const pub = await listStudies(new NextRequest('http://localhost/api/savings'));
    const pubBody = await pub.json();
    expect((pubBody.case_studies as any[]).some((s) => s.id === body.id)).toBe(false);
  });

  it('moderation approves to public (no emails); owner takedown removes', async () => {
    process.env.ADMIN_SECRET = ADMIN;
    const email = uniqueEmail('r7.mod');
    await createOrGetUser({ email });
    const key = await keyFor(email);
    const sub = await submitStudy(
      authed('http://localhost/api/savings', key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_model_id: 'a/x1',
          to_model_id: 'b/y1',
          savings_usd_per_month: 250,
          consent: true,
        }),
      })
    );
    const { id } = await sub.json();

    const queue = await modQueue(
      new NextRequest('http://localhost/api/admin/savings', { headers: { 'x-admin-secret': ADMIN } })
    );
    expect(queue.status).toBe(200);

    const denied = await moderate(
      new NextRequest('http://localhost/api/admin/savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision: 'approved' }),
      })
    );
    expect(denied.status).toBe(401);

    const appr = await moderate(
      new NextRequest('http://localhost/api/admin/savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN },
        body: JSON.stringify({ id, decision: 'approved' }),
      })
    );
    expect(appr.status).toBe(200);

    const approved = await listApprovedCaseStudies(50);
    const found = approved.find((s: any) => s.id === id);
    expect(found).toBeTruthy();
    expect(JSON.stringify(found)).not.toContain(email);

    const down = await takedownStudy(
      authed(`http://localhost/api/savings/${id}`, key, { method: 'DELETE' }),
      { params: { id: String(id) } }
    );
    expect(down.status).toBe(200);
    const after = await listApprovedCaseStudies(50);
    expect(after.some((s: any) => s.id === id)).toBe(false);
  });
});
