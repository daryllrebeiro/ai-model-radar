import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as submitStudy, GET as listStudies } from '../src/app/api/savings/route';
import { POST as moderate } from '../src/app/api/admin/savings/route';
import { POST as upload } from '../src/app/api/usage/imports/route';
import { createOrGetUser, createApiKey } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { uniqueEmail } from './helpers';
import fs from 'fs';
import path from 'path';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

const ADMIN = 'r7d-admin-secret';

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

describe('R7 double opt-in: no single-click path to publication', () => {
  it('R5 use alone never surfaces publicly; only the consented writer exists', async () => {
    const email = uniqueEmail('r7d.r5only');
    const key = await keyFor(email);
    const up = await upload(
      authed('http://localhost/api/usage/imports', key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: 'm.csv',
          csv: 'model,prompt_tokens,completion_tokens,cost_usd\nopenai/gpt-4o,100,50,0.01',
        }),
      })
    );
    expect(up.status).toBe(201);

    const pub = await listStudies(new NextRequest('http://localhost/api/savings'));
    const body = await pub.json();
    expect(JSON.stringify(body)).not.toContain(email);
    expect(JSON.stringify(body)).not.toContain('openai/gpt-4o');

    // Code-level: exactly one writer into case_studies, and it hard-codes
    // consent_confirmed=TRUE only reachable after the consent:true schema + session.
    const dbSrc = fs.readFileSync(path.join(process.cwd(), 'src/lib/db/case-studies.ts'), 'utf-8');
    expect(dbSrc.match(/INSERT INTO case_studies/g)).toHaveLength(1);
    expect(dbSrc).toContain('consent_confirmed, status');
    const routeSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/api/savings/route.ts'), 'utf-8');
    expect(routeSrc).toContain('consent');
  });

  it('pending submissions are unreachable: no public per-id route exists', async () => {
    const email = uniqueEmail('r7d.pend');
    const key = await keyFor(email);
    const sub = await submitStudy(
      authed('http://localhost/api/savings', key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_model_id: 'p/x', to_model_id: 'q/y', savings_usd_per_month: 5, consent: true }),
      })
    );
    expect(sub.status).toBe(201);
    const { id } = await sub.json();

    // No public single-entry route file exists under /api/savings.
    const savingsDir = path.join(process.cwd(), 'src/app/api/savings');
    const entries = fs.readdirSync(savingsDir);
    expect(entries).toContain('[id]');
    const idRoute = fs.readFileSync(path.join(savingsDir, '[id]/route.ts'), 'utf-8');
    expect(idRoute).not.toMatch(/export async function GET/);

    // And the public list excludes it.
    const pub = await listStudies(new NextRequest('http://localhost/api/savings'));
    const body = await pub.json();
    expect((body.case_studies as any[]).some((s) => s.id === id)).toBe(false);
  });
});

describe('R7 XSS in user-generated content', () => {
  it('payload round-trips as data; render sinks are JSX-interpolated (auto-escaped)', async () => {
    process.env.ADMIN_SECRET = ADMIN;
    const email = uniqueEmail('r7d.xss');
    const key = await keyFor(email);
    const payload = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
    const sub = await submitStudy(
      authed('http://localhost/api/savings', key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_name: payload,
          from_model_id: 'a/x',
          to_model_id: 'b/y',
          savings_usd_per_month: 9,
          story: payload,
          consent: true,
        }),
      })
    );
    const { id } = await sub.json();
    await moderate(
      new NextRequest('http://localhost/api/admin/savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN },
        body: JSON.stringify({ id, decision: 'approved' }),
      })
    );
    const pub = await listStudies(new NextRequest('http://localhost/api/savings'));
    const body = await pub.json();
    const found = (body.case_studies as any[]).find((s) => s.id === id);
    expect(found).toBeTruthy();
    // API returns data verbatim (correct for a data API)…
    expect(found.team_name).toContain('<script>');
    // …while every render sink interpolates via JSX (React escapes), with no
    // dangerouslySetInnerHTML anywhere on the surface.
    const page = fs.readFileSync(path.join(process.cwd(), 'src/app/savings/page.tsx'), 'utf-8');
    expect(page).not.toContain('dangerouslySetInnerHTML');
    expect(page).toContain('{s.team_name}');
    expect(page).toContain('{s.story}');
  });
});
