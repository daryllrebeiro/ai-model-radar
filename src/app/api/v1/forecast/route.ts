import { NextRequest } from 'next/server';
import { getLatestSnapshotsMap, getEvents } from '@/lib/db/queries';
import { getPriceDropForecasts } from '@/lib/forecast';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { requireFeature } from '@/lib/access-guard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/forecast?limit=10&min_probability=0.5
 *
 * RadarForecast (Pro feature, gated via PRICE_FORECAST).
 * Statistical price-drop forecasts: probability + expected window + typical cut
 * magnitude per paid model, strongest first.
 */
export async function GET(request: NextRequest) {
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }

  const guard = await requireFeature(request, 'PRICE_FORECAST');
  if (guard.error) {
    return guard.error;
  }

  const rawLimit = Number(request.nextUrl.searchParams.get('limit') || '15');
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 15;

  const rawMin = Number(request.nextUrl.searchParams.get('min_probability') || '0.35');
  const minProbability = Number.isFinite(rawMin) ? Math.min(1, Math.max(0, rawMin)) : 0.35;

  const [snapshotsMap, eventsRes] = await Promise.all([
    getLatestSnapshotsMap(),
    getEvents({ limit: 500 }),
  ]);

  const snapshots = Array.from(snapshotsMap.values());
  const forecasts = getPriceDropForecasts(snapshots, eventsRes.events, {
    minProbability,
    maxForecasts: limit,
  });

  return apiJsonResponse(
    {
      version: 'v1',
      generated_at: new Date().toISOString(),
      summary: {
        total: forecasts.length,
        high_confidence: forecasts.filter((f) => f.confidence === 'high').length,
        high_strength: forecasts.filter((f) => f.probability >= 0.75).length,
      },
      forecasts,
    },
    auth.rateLimitHeaders
  );
}