import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession, BILLING_PLANS } from '@/lib/billing/stripe';
import { getSessionUser } from '@/lib/auth';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { isBillingEnabled } from '@/lib/feature-flags';
import { safeRedirectUrl } from '@/lib/env';
import { handleApiError } from '@/lib/api-error-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Check feature flag before attempting checkout creation
    if (!isBillingEnabled()) {
      return NextResponse.json(
        {
          error: 'billing_disabled',
          message: 'Paid subscription checkouts are currently disabled.',
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { tier, successUrl, cancelUrl } = body;

    if (!tier || !BILLING_PLANS[tier] || tier === 'free') {
      return NextResponse.json(
        { error: 'Valid tier (developer or production) is required.' },
        { status: 400 }
      );
    }

    const authSession = await getSessionUser(request);
    const email = authSession?.user?.email;

    if (!email) {
      return NextResponse.json(
        { error: 'Authenticated session is required.' },
        { status: 401 }
      );
    }

    const limited = await checkSessionRateLimit(authSession.user.id, 'billing', { limit: 20 });
    if (limited) return limited;

    const origin = request.headers.get('origin') || 'http://localhost:3000';
    // Client-supplied redirect targets are allowlisted to our own origin —
    // an unchecked successUrl is a post-payment phishing redirect.
    const targetSuccessUrl = safeRedirectUrl(successUrl || `${origin}/alerts?upgrade=success`, '/alerts?upgrade=success');
    const targetCancelUrl = safeRedirectUrl(cancelUrl || `${origin}/alerts?upgrade=cancelled`, '/alerts?upgrade=cancelled');

    const checkoutSession = await createCheckoutSession({
      customerEmail: email,
      tier,
      successUrl: targetSuccessUrl,
      cancelUrl: targetCancelUrl,
    });

    return NextResponse.json({
      success: true,
      url: checkoutSession.url,
      sessionId: checkoutSession.sessionId,
      tier,
    });
  } catch (error: any) {
    return handleApiError(error, 'billing/checkout');
  }
}
