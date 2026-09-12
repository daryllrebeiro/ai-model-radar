import { NextRequest, NextResponse } from 'next/server';
import {
  getProbeSpendSince,
  getMetricSums,
  getEvents,
  listDriftReviews,
} from '@/lib/db/queries';
import { computeDeprecationStats } from '@/lib/deprecation';
import { isActiveProbeEnabled } from '@/lib/active-probe';
import { secretsEqual } from '@/lib/secrets';
import { logAuthDenied } from '@/lib/api-auth';

/**
 * P1-observability dashboard: spend + success metrics + maturity gates in
 * one ADMIN_SECRET-gated readout. Fail-closed when unconfigured (same
 * contract as /api/admin/health). Powers the second threshold review with
 * numbers instead of zeros.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    logAuthDenied('admin/spend', request, 'secret-unset');
    return NextResponse.json({ error: 'Admin authentication not configured.' }, { status: 401 });
  }
  const authHeader = request.headers.get('authorization');
  const secretHeader = request.headers.get('x-admin-secret');
  if (!secretsEqual(authHeader, `Bearer ${adminSecret}`) && !secretsEqual(secretHeader, adminSecret)) {
    logAuthDenied('admin/spend', request, 'bad-secret');
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    const day = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const week = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const month = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const [spend24h, spend7d, metrics30d, eventsRes, pendingReviews] = await Promise.all([
      getProbeSpendSince(day),
      getProbeSpendSince(week),
      getMetricSums(month),
      getEvents({ eventTypes: ['DEPRECATION_ANNOUNCED', 'MODEL_REMOVED'] as any, limit: 5000 }),
      listDriftReviews('pending', 200),
    ]);
    const eventList = (eventsRes as any).events || eventsRes;
    const deprecation = computeDeprecationStats(Array.isArray(eventList) ? eventList : []);
    return NextResponse.json({
      version: 'v1',
      timestamp: new Date().toISOString(),
      probe_enabled: isActiveProbeEnabled(),
      spend: { last_24h: spend24h, last_7d: spend7d },
      metrics_30d: metrics30d,
      deprecation_maturity: {
        total_pairs: deprecation.total_pairs,
        mature: deprecation.mature,
        providers: deprecation.providers.map((p) => ({ provider: p.provider, sample_size: p.sample_size, median_days: p.median_days })),
      },
      drift_queue: {
        pending: pendingReviews.length,
        capped_at_200: pendingReviews.length >= 200,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Spend dashboard failed' }, { status: 500 });
  }
}
