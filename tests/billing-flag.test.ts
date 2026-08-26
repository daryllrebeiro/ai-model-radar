import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as checkoutRoute } from '../src/app/api/billing/checkout/route';
import { POST as webhookRoute } from '../src/app/api/billing/webhook/route';
import { generateApiKey, issueApiKey } from '../src/lib/api-keys';
import { createApiKey, findApiKeyByHash, createOrGetUser } from '../src/lib/db/queries';
import { validateEnv } from '../src/lib/env';
import crypto from 'crypto';

describe('Part 1: Stripe Feature Flag & Billing Toggle (STRIPE_ENABLED)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('1. Blocks POST /api/billing/checkout with 403 billing_disabled when STRIPE_ENABLED is false/unset', async () => {
    delete process.env.STRIPE_ENABLED;

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const req = new NextRequest('http://localhost:3000/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({
        tier: 'developer',
        customerEmail: 'test@example.com',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await checkoutRoute(req);
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBe('billing_disabled');

    // Confirm Stripe API SDK / fetch was NEVER called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('2. Processes valid Stripe webhook events identically whether STRIPE_ENABLED is true or false', async () => {
    const webhookSecret = 'whsec_test_secret_12345';
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

    for (const flagState of ['false', 'true', undefined]) {
      if (flagState) process.env.STRIPE_ENABLED = flagState;
      else delete process.env.STRIPE_ENABLED;

      const userEmail = `webhook_flag_${flagState || 'unset'}_${Date.now()}@test.com`;
      await createOrGetUser({ email: userEmail, tier: 'free' });

      const payload = JSON.stringify({
        id: `evt_test_${Date.now()}`,
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: `cus_${Date.now()}`,
            customer_email: userEmail,
            subscription: `sub_${Date.now()}`,
            metadata: { tier: 'developer' },
          },
        },
      });

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${payload}`)
        .digest('hex');

      const req = new NextRequest('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        body: payload,
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': `t=${timestamp},v1=${signature}`,
        },
      });

      const res = await webhookRoute(req);
      expect(res.status).toBe(200);

      const resBody = await res.json();
      expect(resBody.received).toBe(true);
    }
  });

  it('3. New API keys issued via issueApiKey are forced to free tier when billing is disabled, ignoring client tier params', () => {
    delete process.env.STRIPE_ENABLED;

    const email = 'free_user@example.com';
    const { keyRecord } = issueApiKey(email, 'production' as any);

    expect(keyRecord.tier).toBe('free');
  });

  it('4. Flipping STRIPE_ENABLED does not alter or downgrade existing rows in api_keys', async () => {
    // Create developer key when enabled
    process.env.STRIPE_ENABLED = 'true';
    const email = `paid_user_${Date.now()}@example.com`;
    const { keyRecord } = generateApiKey(email, 'developer');
    expect(keyRecord.tier).toBe('developer');

    await createApiKey(keyRecord);

    // Disable billing
    process.env.STRIPE_ENABLED = 'false';

    // Existing key retrieved from DB must still be developer tier
    const found = await findApiKeyByHash(keyRecord.key_hash);
    expect(found).not.toBeNull();
    expect(found?.tier).toBe('developer');
  });

  it('5. Env validation passes with zero Stripe keys when STRIPE_ENABLED is false/unset', () => {
    const res = validateEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://localhost/test',
    });
    expect(res.valid).toBe(true);
    expect(res.errors).toBeUndefined();
  });

  it('6. Env validation requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET when STRIPE_ENABLED=true', () => {
    const res = validateEnv({
      NODE_ENV: 'test',
      STRIPE_ENABLED: 'true',
    });
    expect(res.valid).toBe(false);
    expect(res.errors).toBeDefined();
    expect(res.errors?.some((e) => e.includes('STRIPE_SECRET_KEY'))).toBe(true);
    expect(res.errors?.some((e) => e.includes('STRIPE_WEBHOOK_SECRET'))).toBe(true);
  });
});
