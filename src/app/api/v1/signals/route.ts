import { NextRequest } from 'next/server';
import { getLatestSnapshotsMap, getEvents } from '@/lib/db/queries';
import { detectMarketSignals } from '@/lib/signals';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { requireFeature } from '@/lib/access-guard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/signals?limit=10
 *
 * Enhanced Market Signals (Pro feature). Returns statistical market signals
 * sorted by confidence strength, plus a summary of the signal landscape.
 */
export async function GET(request: NextRequest) {
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }

  const guard = await requireFeature(request, 'MARKET_SIGNALS');
  if (guard.error) {
    return guard.error;
  }

  const rawLimit = Number(request.nextUrl.searchParams.get('limit') || '20');
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 20;

  const [snapshotsMap, eventsRes] = await Promise.all([
    getLatestSnapshotsMap(),
    getEvents({ limit: 500 }),
  ]);

  const snapshots = Array.from(snapshotsMap.values());
  const allSignals = detectMarketSignals(snapshots, eventsRes.events);
  const sorted = [...allSignals].sort((a, b) => (b.strength || 0) - (a.strength || 0));

  const bySeverity = {
    high: allSignals.filter((s) => s.severity === 'high').length,
    medium: allSignals.filter((s) => s.severity === 'medium').length,
    info: allSignals.filter((s) => s.severity === 'info').length,
  };

  return apiJsonResponse(
    {
      version: 'v1',
      generated_at: new Date().toISOString(),
      summary: {
        total: allSignals.length,
        by_severity: bySeverity,
        top_strength: sorted[0]?.strength || 0,
      },
      signals: sorted.slice(0, limit),
    },
    auth.rateLimitHeaders
  );
}