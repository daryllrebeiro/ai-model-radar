import crypto from 'crypto';

export interface PlanConfig {
  name: string;
  tier: 'free' | 'developer' | 'production';
  priceMonthly: number;
  stripePriceId?: string;
  features: string[];
}

export const BILLING_PLANS: Record<string, PlanConfig> = {
  free: {
    name: 'Free Community',
    tier: 'free',
    priceMonthly: 0,
    features: ['60 req/min API quota', 'Web dashboard access', 'Community model feed'],
  },
  developer: {
    name: 'Pro Developer',
    tier: 'developer',
    priceMonthly: 29,
    stripePriceId: process.env.STRIPE_PRICE_DEVELOPER || 'price_developer_monthly',
    features: [
      '300 req/min API quota',
      'Instant webhook alerts',
      'Daily curated email digests',
      'Advanced arbitrage analytics',
    ],
  },
  production: {
    name: 'Enterprise Production',
    tier: 'production',
    priceMonthly: 199,
    stripePriceId: process.env.STRIPE_PRICE_PRODUCTION || 'price_production_monthly',
    features: [
      '1,200 req/min high-frequency quota',
      'Real-time anomaly stream',
      '99.9% uptime SLA guarantee',
      'Dedicated Slack/Discord support',
    ],
  },
};

/**
 * Creates a Stripe Checkout Session payload or simulated session for dev/test
 */
export async function createCheckoutSession(params: {
  customerEmail: string;
  tier: 'developer' | 'production';
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; sessionId: string }> {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const plan = BILLING_PLANS[params.tier];

  if (!plan) {
    throw new Error(`Invalid subscription tier: ${params.tier}`);
  }

  // If live Stripe API key is provided, use Stripe REST API
  if (stripeSecretKey && stripeSecretKey.startsWith('sk_')) {
    const body = new URLSearchParams({
      'payment_method_types[0]': 'card',
      mode: 'subscription',
      customer_email: params.customerEmail,
      'line_items[0][price]': plan.stripePriceId || 'price_default',
      'line_items[0][quantity]': '1',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      'metadata[tier]': params.tier,
      'metadata[customerEmail]': params.customerEmail,
    });

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Stripe Checkout Session creation failed (${response.status}): ${errText}`);
    }

    const session = await response.json();
    return { url: session.url, sessionId: session.id };
  }

  // Dev / Mock checkout session response
  const mockId = `cs_test_${crypto.randomBytes(16).toString('hex')}`;
  const mockUrl = `${params.successUrl}?session_id=${mockId}&mock=true&tier=${params.tier}`;
  return { url: mockUrl, sessionId: mockId };
}

/**
 * Verifies Stripe Webhook signature (Stripe-Signature header with t=timestamp,v1=signature)
 */
export function verifyStripeWebhookSignature(
  rawPayload: string,
  signatureHeader: string | null,
  webhookSecret: string
): boolean {
  if (!signatureHeader || !webhookSecret) return false;

  const elements = signatureHeader.split(',');
  let timestamp: string | undefined;
  let signature: string | undefined;

  for (const el of elements) {
    const [k, v] = el.trim().split('=');
    if (k === 't') timestamp = v;
    if (k === 'v1') signature = v;
  }

  if (!timestamp || !signature) return false;

  // Compute expected HMAC SHA-256 signature
  const signedPayload = `${timestamp}.${rawPayload}`;
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload)
    .digest('hex');

  // Prevent timing attacks via constant-time comparison
  return (
    expectedSignature.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))
  );
}

/**
 * Cancels an active Stripe subscription.
 * When live secret key is available, calls Stripe API DELETE /v1/subscriptions/:id.
 * If customer ID is provided without subscription ID, lists and cancels all active subscriptions for the customer.
 */
export async function cancelStripeSubscription(
  subscriptionIdOrCustomerId?: string | null
): Promise<{ success: boolean; error?: string; canceledCount: number }> {
  if (!subscriptionIdOrCustomerId) {
    return { success: true, canceledCount: 0 };
  }

  // Simulated failure flag for unit testing
  if ((globalThis as any).__SIMULATE_STRIPE_CANCEL_FAILURE) {
    return {
      success: false,
      error: 'Simulated Stripe cancellation network failure',
      canceledCount: 0,
    };
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (stripeSecretKey && stripeSecretKey.startsWith('sk_')) {
    try {
      const isSubId = subscriptionIdOrCustomerId.startsWith('sub_');

      if (isSubId) {
        // Direct cancel by subscription ID
        const response = await fetch(
          `https://api.stripe.com/v1/subscriptions/${subscriptionIdOrCustomerId}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${stripeSecretKey}`,
            },
          }
        );

        if (!response.ok) {
          const errText = await response.text();
          // If already canceled (404), treat as safe
          if (response.status === 404) {
            return { success: true, canceledCount: 0 };
          }
          return {
            success: false,
            error: `Stripe API error (${response.status}): ${errText}`,
            canceledCount: 0,
          };
        }

        return { success: true, canceledCount: 1 };
      } else {
        // List customer's active subscriptions and cancel each
        const listRes = await fetch(
          `https://api.stripe.com/v1/subscriptions?customer=${subscriptionIdOrCustomerId}&status=active`,
          {
            headers: {
              Authorization: `Bearer ${stripeSecretKey}`,
            },
          }
        );

        if (!listRes.ok) {
          const errText = await listRes.text();
          return {
            success: false,
            error: `Failed to list subscriptions (${listRes.status}): ${errText}`,
            canceledCount: 0,
          };
        }

        const data = await listRes.json();
        const subs = data.data || [];
        let canceled = 0;

        for (const sub of subs) {
          const delRes = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${stripeSecretKey}`,
            },
          });

          if (!delRes.ok) {
            const errText = await delRes.text();
            return {
              success: false,
              error: `Failed to cancel subscription ${sub.id} (${delRes.status}): ${errText}`,
              canceledCount: canceled,
            };
          }
          canceled++;
        }

        return { success: true, canceledCount: canceled };
      }
    } catch (err: any) {
      return { success: false, error: err.message, canceledCount: 0 };
    }
  }

  // Simulated cancellation in mock/dev mode
  return { success: true, canceledCount: 1 };
}

