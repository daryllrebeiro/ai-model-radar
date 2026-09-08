import { NextRequest, NextResponse } from 'next/server';
import { verifyStripeWebhookSignature } from '@/lib/billing/stripe';
import {
  updateUserTier,
  createOrGetUser,
  getUserByEmail,
  isStripeEventProcessed,
  markStripeEventProcessed,
  revokeUserApiKeys,
  restoreUserApiKeys,
} from '@/lib/db/queries';
import { logAuthDenied } from '@/lib/api-auth';
import { logger, hashEmail } from '@/lib/logger';

/** Tiers the webhook is allowed to write. Stripe metadata is attacker-shaped
 *  once the HMAC is bypassed, so never accept it verbatim (PT-09). */
function webhookTier(raw: unknown): 'developer' | 'production' {
  return raw === 'production' ? 'production' : 'developer';
}

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const rawPayload = await request.text();
    const signatureHeader =
      request.headers.get('stripe-signature') || request.headers.get('Stripe-Signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // Fail closed: without a configured secret there is nothing to verify
    // against, so an unverifiable delivery must be rejected — never applied.
    // The ONLY exception is an explicit operator opt-in for local development
    // (ALLOW_UNSIGNED_WEBHOOKS=true), which is forcibly ignored in production
    // so a staging flag can never leak into a real deployment.
    const allowUnsigned =
      process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true' && process.env.NODE_ENV !== 'production';
    if (!webhookSecret) {
      if (process.env.NODE_ENV === 'production' || !allowUnsigned) {
        logger.warn('Stripe webhook received but STRIPE_WEBHOOK_SECRET is not configured.');
        return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
      }
      logger.warn('Stripe webhook signature check SKIPPED via ALLOW_UNSIGNED_WEBHOOKS (non-production only).');
    } else {
      const isValid = verifyStripeWebhookSignature(rawPayload, signatureHeader, webhookSecret);
      if (!isValid) {
        logger.warn('Stripe webhook signature verification failed.');
        logAuthDenied('billing/webhook', request, 'bad-signature');
        return NextResponse.json({ error: 'Invalid Stripe signature' }, { status: 400 });
      }
    }

    const event = JSON.parse(rawPayload);
    logger.info(`Received Stripe webhook event: ${event.type}`);

    // Delivery idempotency, checked BEFORE work but marked AFTER commit: if
    // the tier write below throws, the retry must re-apply rather than report
    // {duplicate:true} on an unapplied payment (PT-06).
    if (event.id && (await isStripeEventProcessed(event.id))) {
      logger.info(`Stripe webhook event ${event.id} already processed; skipping.`);
      return NextResponse.json({ received: true, duplicate: true });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data?.object;
        const customerEmail = session.customer_email || session.metadata?.customerEmail;
        const tier = webhookTier(session.metadata?.tier);
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        if (customerEmail) {
          await createOrGetUser({
            email: customerEmail,
            tier,
            stripe_customer_id: customerId,
          });
          await updateUserTier(customerEmail, tier, subscriptionId);
          // Repurchase path: restore keys bulk-revoked by an earlier cancel
          // so a returning customer is not locked out by PT-03's revoke.
          await restoreUserApiKeys(customerEmail);
          logger.info(`User ${hashEmail(customerEmail)} successfully upgraded to ${tier} tier.`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data?.object;
        const customerId = subscription.customer;
        const status = subscription.status;
        const tier = webhookTier(subscription.metadata?.tier);

        if (status === 'active') {
          await updateUserTier(customerId, tier, subscription.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data?.object;
        const customerId = subscription.customer;
        // Downgrade to free tier upon cancellation
        await updateUserTier(customerId, 'free');
        // Kill the replay vector: stale paid-tier keys must not re-lift the
        // downgraded tier via monotonic upgrade (PT-03).
        const user = customerId ? await getUserByEmail(customerId) : null;
        const ownerEmail = user?.email || (typeof customerId === 'string' && customerId.includes('@') ? customerId : null);
        if (ownerEmail) {
          const revoked = await revokeUserApiKeys(ownerEmail);
          logger.info(`Subscription cancelled for customer ${hashEmail(customerId)}, downgraded to free (${revoked} keys revoked).`);
        } else {
          logger.info(`Subscription cancelled for customer ${hashEmail(customerId)}, downgraded to free.`);
        }
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }

    if (event.id) await markStripeEventProcessed(event.id, event.type);

    return NextResponse.json({ received: true });
  } catch (error: any) {
    logger.error(`Stripe webhook handler error: ${error.message}`);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
