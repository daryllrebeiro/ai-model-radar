import { NextRequest, NextResponse } from 'next/server';
import { verifyStripeWebhookSignature } from '@/lib/billing/stripe';
import { updateUserTier, createOrGetUser } from '@/lib/db/queries';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const rawPayload = await request.text();
    const signatureHeader =
      request.headers.get('stripe-signature') || request.headers.get('Stripe-Signature');
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // Verify signature in production or whenever secret is provided
    if (webhookSecret) {
      const isValid = verifyStripeWebhookSignature(rawPayload, signatureHeader, webhookSecret);
      if (!isValid) {
        logger.warn('Stripe webhook signature verification failed.');
        return NextResponse.json({ error: 'Invalid Stripe signature' }, { status: 400 });
      }
    }

    const event = JSON.parse(rawPayload);
    logger.info(`Received Stripe webhook event: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data?.object;
        const customerEmail = session.customer_email || session.metadata?.customerEmail;
        const tier = session.metadata?.tier || 'developer';
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        if (customerEmail) {
          await createOrGetUser({
            email: customerEmail,
            tier,
            stripe_customer_id: customerId,
          });
          await updateUserTier(customerEmail, tier, subscriptionId);
          logger.info(`User ${customerEmail} successfully upgraded to ${tier} tier.`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data?.object;
        const customerId = subscription.customer;
        const status = subscription.status;
        const tier = subscription.metadata?.tier || 'developer';

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
        logger.info(`Subscription cancelled for customer ${customerId}, downgraded to free.`);
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    logger.error(`Stripe webhook handler error: ${error.message}`);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
