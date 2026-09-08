import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as legacyModels } from '../src/app/api/models/route';
import { GET as legacyEvents } from '../src/app/api/events/route';
import { GET as v1Models } from '../src/app/api/v1/models/route';
import { POST as webhookRoute } from '../src/app/api/billing/webhook/route';
import { restoreDatabase } from '../scripts/restore-db';
import { getTeamsForUser, getBudgetRulesForUser, createOrGetUser } from '../src/lib/db/queries';
import { uniqueEmail } from './helpers';

const anon = (url: string, ip: string) =>
  new NextRequest(url, { headers: { 'x-forwarded-for': ip } });

describe('Adversarial audit fixes (round 2)', () => {
  it('1. legacy /api/models is throttled like its v1 twin', async () => {
    const ip = `10.9.8.${Math.floor(Math.random() * 200) + 1}`;
    let gated = 0;
    for (let i = 0; i < 65; i++) {
      const res = await legacyModels(anon('http://localhost/api/models?limit=5', ip));
      if (res.status === 429) gated++;
      else expect(res.status).toBe(200);
    }
    expect(gated).toBeGreaterThan(0);
  });

  it('2. legacy /api/events is throttled like its v1 twin', async () => {
    const ip = `10.9.7.${Math.floor(Math.random() * 200) + 1}`;
    let gated = 0;
    for (let i = 0; i < 65; i++) {
      const res = await legacyEvents(anon('http://localhost/api/events?limit=5', ip));
      if (res.status === 429) gated++;
      else expect(res.status).toBe(200);
    }
    expect(gated).toBeGreaterThan(0);
  });

  it('3. unsigned webhook requires explicit opt-in flag outside production', async () => {
    const body = JSON.stringify({
      id: `evt-flag-${Date.now()}`,
      type: 'checkout.session.completed',
      data: { object: { customer_email: `flag.${Date.now()}@test.dev`, metadata: { tier: 'developer' }, subscription: null, customer: null } },
    });
    const savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const savedFlag = process.env.ALLOW_UNSIGNED_WEBHOOKS;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.ALLOW_UNSIGNED_WEBHOOKS;
    try {
      const denied = await webhookRoute(
        new NextRequest('http://localhost/api/billing/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
      );
      expect(denied.status).toBe(500);
      process.env.ALLOW_UNSIGNED_WEBHOOKS = 'true';
      const body2 = JSON.stringify({
        id: `evt-flag2-${Date.now()}`,
        type: 'checkout.session.completed',
        data: { object: { customer_email: `flag2.${Date.now()}@test.dev`, metadata: { tier: 'developer' }, subscription: null, customer: null } },
      });
      const allowed = await webhookRoute(
        new NextRequest('http://localhost/api/billing/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body2,
        })
      );
      expect(allowed.status).toBe(200);
    } finally {
      if (savedSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
      if (savedFlag === undefined) delete process.env.ALLOW_UNSIGNED_WEBHOOKS;
      else process.env.ALLOW_UNSIGNED_WEBHOOKS = savedFlag;
    }
  });

  it('4. restore rejects dumps with hostile column names', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const crypto = await import('crypto');
    const dir = path.join(process.cwd(), 'backups-test');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `evil-cols-${Date.now()}.json`);
    const dump = {
      users: [{ id: 1, email: 'x@test.dev', 'id) VALUES (1)--': 'pwned' }],
    };
    const raw = JSON.stringify(dump);
    fs.writeFileSync(file, raw);
    const checksum = crypto.createHash('sha256').update(raw).digest('hex');
    await expect(restoreDatabase(file, checksum)).rejects.toThrow(/Unsafe column name/);
    fs.rmSync(file, { force: true });
  });

  it('5. per-user list queries are bounded', async () => {
    const email = uniqueEmail('bounds');
    await createOrGetUser({ email });
    const teams = await getTeamsForUser(email, 5);
    expect(teams.length).toBeLessThanOrEqual(5);
    const rules = await getBudgetRulesForUser(email, 5);
    expect(rules.length).toBeLessThanOrEqual(5);
  });

  it('6. ACAO echoes a configured allowlisted origin, else wildcard', async () => {
    const saved = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    try {
      // CORS headers ride on the v1 rate-limit response path
      const hit = await v1Models(
        new NextRequest('http://localhost/api/v1/models?limit=1', {
          headers: { origin: 'https://app.example.com', 'x-forwarded-for': `10.1.2.${Math.floor(Math.random() * 200) + 1}` },
        })
      );
      expect(hit.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
      expect(hit.headers.get('Vary')).toBe('Origin');
      const miss = await v1Models(
        new NextRequest('http://localhost/api/v1/models?limit=1', {
          headers: { origin: 'https://evil.example', 'x-forwarded-for': `10.1.3.${Math.floor(Math.random() * 200) + 1}` },
        })
      );
      expect(miss.headers.get('Access-Control-Allow-Origin')).toBe('*');
    } finally {
      if (saved === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = saved;
    }
  });
});
