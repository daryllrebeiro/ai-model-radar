import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession, BILLING_PLANS } from '@/lib/billing/stripe';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tier, customerEmail, successUrl, cancelUrl } = body;

    if (!tier || !BILLING_PLANS[tier] || tier === 'free') {
      return NextResponse.json(
        { error: 'Valid tier (developer or production) is required.' },
        { status: 400 }
      );
    }

    let email = customerEmail;
    if (!email) {
      const session = await getSessionUser(request);
      email = session?.user.email;
    }

    if (!email) {
      return NextResponse.json(
        { error: 'customerEmail or authenticated user session is required.' },
        { status: 400 }
      );
    }

    const origin = request.headers.get('origin') || 'http://localhost:3000';
    const targetSuccessUrl = successUrl || `${origin}/alerts?upgrade=success`;
    const targetCancelUrl = cancelUrl || `${origin}/alerts?upgrade=cancelled`;

    const session = await createCheckoutSession({
      customerEmail: email,
      tier,
      successUrl: targetSuccessUrl,
      cancelUrl: targetCancelUrl,
    });

    return NextResponse.json({
      success: true,
      url: session.url,
      sessionId: session.sessionId,
      tier,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
