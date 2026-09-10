import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api-error-handler';
import { createRoutingOptIn } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/routing/opt-in — records explicit pilot consent for the
 * caller (one half of the pilot gate; the operator allowlist is the other).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    await createRoutingOptIn(session.user.email);
    return NextResponse.json({
      success: true,
      message: 'Pilot consent recorded. Access additionally requires ROUTING_ENABLED and the operator allowlist.',
    });
  } catch (err: any) {
    return handleApiError(err, 'routing/opt-in POST');
  }
}
