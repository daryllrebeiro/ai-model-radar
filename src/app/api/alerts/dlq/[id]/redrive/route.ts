import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import {
  getDlqDelivery,
  requeueDlqDelivery,
  resolveDlqDelivery,
} from '@/lib/db/queries';
import { deliverWebhookPayload } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

/**
 * POST /api/alerts/dlq/[id]/redrive — requeue a dead/retrying delivery and
 * attempt one immediate redelivery round. Delivered rows are terminal
 * (404, same as unknown ids — no existence oracle).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string | string[] } }
) {
  try {
    const { session, error } = await requireFeature(request, 'PRICE_ALERTS_WEBHOOK');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'alerts-dlq', { limit: 10 });
    if (limited) return limited;

    const idRaw = Array.isArray(params.id) ? params.id[0] : params.id;
    const dlqId = Number(idRaw);
    if (!Number.isInteger(dlqId) || dlqId <= 0) {
      return NextResponse.json({ error: 'Invalid delivery id' }, { status: 400 });
    }

    const existing = await getDlqDelivery(dlqId);
    if (!existing || existing.status === 'delivered') {
      return NextResponse.json(
        { error: 'Delivery not found or already delivered' },
        { status: 404 }
      );
    }

    let payload: Record<string, any>;
    try {
      payload = JSON.parse(existing.payload);
    } catch {
      await resolveDlqDelivery(dlqId, {
        delivered: false,
        last_error: 'Stored payload is not valid JSON; cannot redeliver',
        attempts: existing.max_attempts,
      });
      return NextResponse.json(
        { error: 'Stored payload is corrupt; delivery parked as dead' },
        { status: 422 }
      );
    }

    await requeueDlqDelivery(dlqId);
    const attempt = await deliverWebhookPayload(existing.destination_url, payload, {
      ruleId: existing.rule_id ?? undefined,
      enqueueDlq: false,
    });
    const updated = await resolveDlqDelivery(dlqId, {
      delivered: attempt.success,
      last_error: attempt.error,
    });
    return NextResponse.json({
      delivery: updated,
      redelivery: { success: attempt.success, attempts: attempt.attempts },
    });
  } catch (err: any) {
    return handleApiError(err, 'alerts/dlq/:id/redrive POST');
  }
}
