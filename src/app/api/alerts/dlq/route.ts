import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import { getDlqDeliveries, DlqStatus } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: DlqStatus[] = ['queued', 'retrying', 'dead', 'delivered'];

/**
 * GET /api/alerts/dlq?status=dead — list dead-letter webhook deliveries.
 */
export async function GET(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'PRICE_ALERTS_WEBHOOK');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'alerts-dlq');
    if (limited) return limited;

    const statusParam = new URL(request.url).searchParams.get('status');
    let status: DlqStatus | undefined;
    if (statusParam !== null) {
      if (!VALID_STATUSES.includes(statusParam as DlqStatus)) {
        return NextResponse.json(
          { error: 'status must be one of queued, retrying, dead, delivered' },
          { status: 400 }
        );
      }
      status = statusParam as DlqStatus;
    }

    const deliveries = await getDlqDeliveries({ status });
    return NextResponse.json({ deliveries, count: deliveries.length });
  } catch (err: any) {
    return handleApiError(err, 'alerts/dlq GET');
  }
}
