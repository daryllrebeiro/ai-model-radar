import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { normalizeTier, hasAccess, TIER_ORDER } from '../src/lib/feature-flags';
import { getSessionUser } from '../src/lib/auth';
import {
  createOrGetUser,
  createApiKey,
  getUserByEmail,
  normalizeAllUserTiers,
} from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { POST as askRoute } from '../src/app/api/v1/ask/route';
import { GET as governanceStatusRoute } from '../src/app/api/v1/governance/status/route';
import { POST as chatCompletionsRoute } from '../src/app/api/v1/chat/completions/route';
import { createRoutingOptIn } from '../src/lib/db/queries';

afterEach(() => {
  delete process.env.FEATURE_ENFORCEMENT;
});

const KEY_TIERS = ['free', 'developer', 'production'] as const;
const CANONICAL: Record<(typeof KEY_TIERS)[number], string> = {
  free: 'free',
  developer: 'pro',
  production: 'enterprise',
};

async function keyFor(email: string, tier: (typeof KEY_TIERS)[number]): Promise<string> {
  const { plaintextKey, keyRecord } = generateApiKey(email, tier);
  await createApiKey(keyRecord);
  return plaintextKey;
}

async function sessionUserForKey(key: string) {
  return getSessionUser(
    new NextRequest('http://localhost/api/v1/ask', {
      headers: { Authorization: `Bearer ${key}` },
    })
  );
}

describe('Phase 1.1 - Tier vocabulary normalization (P0)', () => {
  it('1. normalizeTier maps every known vocabulary to canonical access tiers', () => {
    expect(normalizeTier('free')).toBe('free');
    expect(normalizeTier('pro')).toBe('pro');
    expect(normalizeTier('enterprise')).toBe('enterprise');
    expect(normalizeTier('developer')).toBe('pro');
    expect(normalizeTier('production')).toBe('enterprise');
    expect(normalizeTier('Production')).toBe('enterprise');
    expect(normalizeTier('DEVELOPER')).toBe('pro');
    expect(normalizeTier('bogus')).toBe('free');
    expect(normalizeTier('')).toBe('free');
    expect(normalizeTier(null)).toBe('free');
    expect(normalizeTier(undefined)).toBe('free');
  });

  it('2. no normalized tier ever resolves to hasAccess deny-by-unknown (-1 index)', () => {
    for (const raw of [...KEY_TIERS, 'pro', 'enterprise', 'bogus', '']) {
      const canonical = normalizeTier(raw);
      expect(TIER_ORDER.indexOf(canonical)).toBeGreaterThanOrEqual(0);
    }
    // Canonical tiers keep their exact gate behavior
    expect(hasAccess('pro', 'ASK_RADAR')).toBe(true);
    expect(hasAccess('enterprise', 'GOVERNANCE')).toBe(true);
    expect(hasAccess('free', 'GOVERNANCE')).toBe(false);
  });

  it('3. key-auth matrix: {free, developer, production} keys resolve to canonical user tiers', async () => {
    for (const tier of KEY_TIERS) {
      const email = `tier.matrix.${tier}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@test.dev`;
      const key = await keyFor(email, tier);
      const session = await sessionUserForKey(key);
      expect(session).not.toBeNull();
      expect(session!.user.tier).toBe(CANONICAL[tier]);
      expect(session!.authMethod).toBe('api_key');
    }
  });

  it('4. stored tier upgrades monotonically and never downgrades', async () => {
    const email = `tier.mono.${Date.now()}@test.dev`;
    await createOrGetUser({ email });

    // Present a production credential: stored tier lifts free -> enterprise
    const prodKey = await keyFor(email, 'production');
    const afterProd = await sessionUserForKey(prodKey);
    expect(afterProd!.user.tier).toBe('enterprise');
    expect((await getUserByEmail(email))!.tier).toBe('enterprise');

    // Present a weaker free credential: stored tier must NOT drop back
    const freeKey = await keyFor(email, 'free');
    const afterFree = await sessionUserForKey(freeKey);
    expect(afterFree!.user.tier).toBe('enterprise');
    expect((await getUserByEmail(email))!.tier).toBe('enterprise');
  });

  it('5. enforcement ON: paid key holders keep access, free keys are gated (pro + enterprise)', async () => {
    process.env.FEATURE_ENFORCEMENT = 'true';
    const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;

    const askBody = (question: string) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    // ASK_RADAR is pro-gated
    const freeKey = await keyFor(`tier.free.${stamp}@test.dev`, 'free');
    const denied = await askRoute(
      withAuth('http://localhost/api/v1/ask', freeKey, askBody('What changed recently?') as any)
    );
    expect(denied.status).toBe(403);

    const prodKey = await keyFor(`tier.prod.${stamp}@test.dev`, 'production');
    const allowed = await askRoute(
      withAuth('http://localhost/api/v1/ask', prodKey, askBody('What changed recently?') as any)
    );
    expect(allowed.status).toBe(200);

    // GOVERNANCE is enterprise-gated: developer (pro) denied, production allowed
    const devKey = await keyFor(`tier.dev.${stamp}@test.dev`, 'developer');
    const devDenied = await governanceStatusRoute(
      new NextRequest('http://localhost/api/v1/governance/status', {
        headers: { Authorization: `Bearer ${devKey}` },
      })
    );
    expect(devDenied.status).toBe(403);

    const entAllowed = await governanceStatusRoute(
      new NextRequest('http://localhost/api/v1/governance/status', {
        headers: { Authorization: `Bearer ${prodKey}` },
      })
    );
    expect(entAllowed.status).toBe(200);
  });

  it('6. backfill normalizes every raw-vocabulary row; canonical rows untouched', async () => {
    const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
    const rawProd = `tier.raw.prod.${stamp}@test.dev`;
    const rawDev = `tier.raw.dev.${stamp}@test.dev`;
    const alreadyPro = `tier.raw.pro.${stamp}@test.dev`;
    await createOrGetUser({ email: rawProd, tier: 'production' });
    await createOrGetUser({ email: rawDev, tier: 'developer' });
    await createOrGetUser({ email: alreadyPro, tier: 'pro' });

    const { checked, updated } = await normalizeAllUserTiers();
    expect(checked).toBeGreaterThanOrEqual(3);
    expect(updated.some((u) => u.startsWith(`${rawProd}: production -> enterprise`))).toBe(true);
    expect(updated.some((u) => u.startsWith(`${rawDev}: developer -> pro`))).toBe(true);
    expect(updated.some((u) => u.startsWith(alreadyPro))).toBe(false);

    expect((await getUserByEmail(rawProd))!.tier).toBe('enterprise');
    expect((await getUserByEmail(rawDev))!.tier).toBe('pro');
    expect((await getUserByEmail(alreadyPro))!.tier).toBe('pro');

    // Idempotent: second run changes nothing
    const again = await normalizeAllUserTiers();
    expect(again.updated.filter((u) => u.startsWith(`tier.raw.`))).toHaveLength(0);
  });

  it('7. PIN: chat/completions tier gate normalizes key vocabulary (R10-path recurrence)', async () => {
    // Recurrence of the Phase-1 vocabulary bug on a route added AFTER the
    // original fix: hasAccess(auth.tier) denied every real key tier because
    // keys speak free/developer/production. Pilot-enabled members on all
    // three key tiers must clear the PUBLIC_API_READ gate (unknown explicit
    // model → deterministic 404, proving gate-pass, never 403).
    process.env.ROUTING_ENABLED = 'true';
    delete process.env.ROUTING_UPSTREAM_KEY;
    const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
    for (const tier of KEY_TIERS) {
      const email = `tier.chat.${tier}.${stamp}@test.dev`;
      const key = await keyFor(email, tier);
      process.env.ROUTING_PILOT_ALLOWLIST = email;
      await createRoutingOptIn(email);
      const res = await chatCompletionsRoute(
        withAuth('http://localhost/api/v1/chat/completions', key, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'nope/missing-pin', messages: [{ role: 'user', content: 'hi' }] }),
        })
      );
      expect(res.status).toBe(404);
    }
    // Same path under staging-equivalent enforcement: gate is unconditional,
    // so the flag must not change the outcome.
    process.env.FEATURE_ENFORCEMENT = 'true';
    const email = `tier.chat.enf.${stamp}@test.dev`;
    const key = await keyFor(email, 'developer');
    process.env.ROUTING_PILOT_ALLOWLIST = email;
    await createRoutingOptIn(email);
    const res = await chatCompletionsRoute(
      withAuth('http://localhost/api/v1/chat/completions', key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nope/missing-pin', messages: [{ role: 'user', content: 'hi' }] }),
      })
    );
    expect(res.status).toBe(404);
    delete process.env.ROUTING_ENABLED;
    delete process.env.ROUTING_PILOT_ALLOWLIST;
  });
});

function withAuth(url: string, key: string, init: { method?: string; headers?: Record<string, string>; body?: string }): NextRequest {
  return new NextRequest(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${key}` },
  });
}
