import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getUserByEmail } from '@/lib/db/queries';
import { handleApiError } from '@/lib/api-error-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request);

    if (!session) {
      return NextResponse.json({ error: 'Authenticated session required' }, { status: 401 });
    }

    const email = session.user.email;
    const body = await request.json().catch(() => ({}));
    const user = await getUserByEmail(email);
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const returnUrl = body.returnUrl || `${request.headers.get('origin') || 'http://localhost:3000'}/alerts`;

    if (stripeSecretKey && stripeSecretKey.startsWith('sk_') && user?.stripe_customer_id) {
      const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          customer: user.stripe_customer_id,
          return_url: returnUrl,
        }).toString(),
      });

      if (!response.ok) {
        throw new Error(`Stripe Portal session failed (${response.status})`);
      }

      const portalSession = await response.json();
      return NextResponse.json({ url: portalSession.url });
    }

    // Mock Portal Url for local test
    return NextResponse.json({
      url: `${returnUrl}?portal=mock&customer=${user?.stripe_customer_id || 'guest'}`,
    });
  } catch (error: any) {
    return handleApiError(error, 'billing/portal');
  }
}
