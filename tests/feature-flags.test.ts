import { describe, it, expect, afterEach } from 'vitest';
import {
  FEATURES,
  hasAccess,
  getFeaturesForTier,
  getLockedFeatures,
  isBillingEnabled,
} from '../src/lib/feature-flags';
import { createOrGetUser, createApiKey } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { GET as arbitrageRoute } from '../src/app/api/arbitrage/route';
import { POST as testWebhookRoute } from '../src/app/api/alerts/test/route';
import { NextRequest } from 'next/server';

afterEach(() => {
  delete process.env.FEATURE_ENFORCEMENT;
});

describe('Phase 1: Tier-Based Feature Flag System', () => {
  it('1. Enforces tier hierarchy: free < pro < enterprise', () => {
    // Free: core only
    expect(hasAccess('free', 'DASHBOARD')).toBe(true);
    expect(hasAccess('free', 'EVENT_FEED')).toBe(true);
    expect(hasAccess('free', 'PRICE_ALERTS_WEBHOOK')).toBe(false);
    expect(hasAccess('free', 'REALTIME_STREAM')).toBe(false);

    // Pro: free + pro, but not enterprise
    expect(hasAccess('pro', 'DASHBOARD')).toBe(true);
    expect(hasAccess('pro', 'PRICE_ALERTS_WEBHOOK')).toBe(true);
    expect(hasAccess('pro', 'COST_OPTIMIZER')).toBe(true);
    expect(hasAccess('pro', 'TEAM_MANAGEMENT')).toBe(false);

    // Enterprise: everything
    expect(hasAccess('enterprise', 'PRICE_HISTORY_CHARTS')).toBe(true);
    expect(hasAccess('enterprise', 'REALTIME_STREAM')).toBe(true);
    expect(hasAccess('enterprise', 'TEAM_MANAGEMENT')).toBe(true);
    expect(hasAccess('enterprise', 'DASHBOARD')).toBe(true);
  });

  it('2. Rejects unknown tiers and unknown feature lookups', () => {
    expect(hasAccess('bogus', 'DASHBOARD')).toBe(false);
    expect(hasAccess('free', 'NOT_A_REAL_FEATURE' as any)).toBe(false);
  });

  it('3. Feature inventory: 17 free, 12 pro, 7 enterprise (36 total)', () => {
    const all = Object.values(FEATURES);
    expect(all).toHaveLength(36);
    expect(all.filter((f) => f.minTier === 'free')).toHaveLength(17);
    expect(all.filter((f) => f.minTier === 'pro')).toHaveLength(12);
    expect(all.filter((f) => f.minTier === 'enterprise')).toHaveLength(7);
  });

  it('4. getFeaturesForTier is inclusive of lower tiers; getLockedFeatures excludes them', () => {
    expect(getFeaturesForTier('free')).toHaveLength(17);
    expect(getFeaturesForTier('pro')).toHaveLength(29);
    expect(getFeaturesForTier('enterprise')).toHaveLength(36);

    expect(getLockedFeatures('free')).toHaveLength(19);
    expect(getLockedFeatures('pro')).toHaveLength(7);
    expect(getLockedFeatures('enterprise')).toHaveLength(0);
  });

  it('5. Billing is disabled unless STRIPE_ENABLED=true', () => {
    delete process.env.STRIPE_ENABLED;
    expect(isBillingEnabled()).toBe(false);
    process.env.STRIPE_ENABLED = 'true';
    expect(isBillingEnabled()).toBe(true);
  });
});

describe('Phase 1: RequireFeature Guard Wiring', () => {
  it('6. Arbitrage route returns 401 unauthenticated', async () => {
    const req = new NextRequest('http://localhost:3000/api/arbitrage');
    const res = await arbitrageRoute(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toContain('Authentication required');
    expect(body.upgrade).toBe('/pricing');
  });

  it('7. Test webhook route returns 401 unauthenticated', async () => {
    const req = new NextRequest('http://localhost:3000/api/alerts/test', {
      method: 'POST',
      body: JSON.stringify({ destinationUrl: 'https://example.com/hook' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await testWebhookRoute(req);
    expect(res.status).toBe(401);
  });

  it('8. Soft enforcement (default): authenticated free user accesses Pro route', async () => {
    delete process.env.FEATURE_ENFORCEMENT;
    const email = `flag_free_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'free' });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'free');
    await createApiKey(keyRecord);

    const req = new NextRequest('http://localhost:3000/api/arbitrage', {
      headers: { Authorization: `Bearer ${plaintextKey}` },
    });
    const res = await arbitrageRoute(req);
    expect(res.status).toBe(200);
  });

  it('9. Enforcement ON: free-tier user is blocked with 403 from Pro feature', async () => {
    process.env.FEATURE_ENFORCEMENT = 'true';
    const email = `flag_block_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'free' });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'free');
    await createApiKey(keyRecord);

    const req = new NextRequest('http://localhost:3000/api/arbitrage', {
      headers: { Authorization: `Bearer ${plaintextKey}` },
    });
    const res = await arbitrageRoute(req);
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBe('Upgrade required');
    expect(body.requiredTier).toBe('pro');
    expect(body.upgrade).toBe('/pricing');
  });

  it('10. Enforcement ON: pro-tier user passes Pro feature gate', async () => {
    process.env.FEATURE_ENFORCEMENT = 'true';
    const email = `flag_pro_${Date.now()}@test.com`;
    const user = await createOrGetUser({ email, tier: 'pro' });
    const { plaintextKey, keyRecord } = generateApiKey(user.email, 'pro');
    await createApiKey(keyRecord);

    const req = new NextRequest('http://localhost:3000/api/arbitrage', {
      headers: { Authorization: `Bearer ${plaintextKey}` },
    });
    const res = await arbitrageRoute(req);
    expect(res.status).toBe(200);
  });
});