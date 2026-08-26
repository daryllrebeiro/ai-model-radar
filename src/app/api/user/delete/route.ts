import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { deleteUserAccount, getUserByEmail, getUserById } from '@/lib/db/queries';
import { cancelStripeSubscription } from '@/lib/billing/stripe';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    let userId = session?.user?.id;
    let email = session?.user?.email;

    if (!userId) {
      const body = await request.json().catch(() => ({}));
      if (body.email) {
        const user = await getUserByEmail(body.email);
        userId = user?.id;
        email = user?.email;
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required to delete account' },
        { status: 401 }
      );
    }

    // Retrieve user record to verify active Stripe subscriptions before deleting
    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return NextResponse.json({ error: 'User account not found' }, { status: 404 });
    }

    // Cancel active Stripe subscription if present BEFORE local database records are deleted
    const subIdentifier = targetUser.stripe_subscription_id || targetUser.stripe_customer_id;
    if (subIdentifier) {
      logger.info(`Initiating Stripe subscription cancellation for user ${targetUser.email} (${subIdentifier}) prior to deletion`);
      const cancelResult = await cancelStripeSubscription(subIdentifier);

      if (!cancelResult.success) {
        logger.error(`Stripe subscription cancellation failed for ${targetUser.email}: ${cancelResult.error}`);
        return NextResponse.json(
          {
            error: 'Failed to cancel active Stripe subscription. Please manage your subscription in the billing portal before deleting your account.',
            details: cancelResult.error,
          },
          { status: 502 }
        );
      }

      logger.info(`Successfully canceled Stripe subscription for ${targetUser.email}`);
    }

    // Proceed with cascading local purge
    const success = await deleteUserAccount(userId);
    if (!success) {
      return NextResponse.json({ error: 'User account not found during deletion' }, { status: 404 });
    }

    logger.info(`User account ${email} (ID ${userId}) permanently deleted pursuant to GDPR/CCPA.`);
    return NextResponse.json({
      success: true,
      message: 'Account, subscriptions, and all associated credentials, watchlists, and alert rules permanently purged.',
      deletedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
