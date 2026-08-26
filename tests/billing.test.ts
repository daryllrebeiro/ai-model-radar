import { describe, it, expect } from 'vitest';
import {
  createCheckoutSession,
  verifyStripeWebhookSignature,
  BILLING_PLANS,
} from '../src/lib/billing/stripe';
import { createOrGetUser, getUserByEmail, updateUserTier } from '../src/lib/db/queries';
import crypto from 'crypto';

describe('Phase P7: Stripe Billing & Subscription Management', () => {
  it('1. Generates structured checkout session for Developer and Production tiers', async () => {
    const session = await createCheckoutSession({
      customerEmail: 'founder@ai-startup.io',
      tier: 'developer',
      successUrl: 'https://ai-model-radar.com/alerts?upgrade=success',
      cancelUrl: 'https://ai-model-radar.com/alerts?upgrade=cancel',
    });

    expect(session.sessionId).toBeDefined();
    expect(session.url).toContain('session_id=');
    expect(session.url).toContain('tier=developer');
    expect(BILLING_PLANS.developer.priceMonthly).toBe(29);
    expect(BILLING_PLANS.production.priceMonthly).toBe(199);
  });

  it('2. Cryptographically validates Stripe Webhook signatures with HMAC-SHA256 and rejects forged payloads', () => {
    const secret = 'whsec_test_secret_123456789';
    const payload = JSON.stringify({ id: 'evt_123', type: 'checkout.session.completed' });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    const validHeader = `t=${timestamp},v1=${signature}`;
    const forgedHeader = `t=${timestamp},v1=forged_signature_0000000000000000000000000000000000000000000000000000000000000000`;

    expect(verifyStripeWebhookSignature(payload, validHeader, secret)).toBe(true);
    expect(verifyStripeWebhookSignature(payload, forgedHeader, secret)).toBe(false);
    expect(verifyStripeWebhookSignature(payload, null, secret)).toBe(false);
  });

  it('3. Upgrades user subscription tier and manages subscription lifecycle', async () => {
    const email = `sub_test_${Date.now()}@example.com`;
    const user = await createOrGetUser({ email, tier: 'free' });
    expect(user.tier).toBe('free');

    // Upgrade via checkout webhook
    const upgraded = await updateUserTier(email, 'developer', 'sub_stripe_12345');
    expect(upgraded?.tier).toBe('developer');
    expect(upgraded?.stripe_subscription_id).toBe('sub_stripe_12345');

    // Downgrade upon cancellation
    const downgraded = await updateUserTier(email, 'free');
    expect(downgraded?.tier).toBe('free');
  });
});
