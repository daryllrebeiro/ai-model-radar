import { NextRequest } from 'next/server';
import { getEvents } from '@/lib/db/queries';
import { getCachedSnapshotsMap } from '@/lib/catalog-cache';
import { runBacktest } from '@/lib/backtest';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { requireFeature } from '@/lib/access-guard';

export const dynamic = 'force-dynamic';

const MAX_EVENT_PAGES = 5;
const EVENTS_PER_PAGE = 1000;
const MAX_CUTOFFS = 6;
const MAX_LOOKBACK_DAYS = 730;

/**
 * GET /api/v1/forecast/backtest?days_ago=30,60,90&min_probability=0.35
 *
 * Forecast Backtesting (Pro, PRICE_FORECAST): replays the price-drop
 * forecaster at historical cutoffs using only then-known events and scores
 * each forecast against realized cuts (precision, Brier score, calibration).
 * Forecasts whose window extends past the newest known event are reported
 * as unresolved, never as misses.
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

  const params = request.nextUrl.searchParams;
  const rawDays = (params.get('days_ago') || '30,60,90').split(',').map((s) => Number(s.trim()));
  if (rawDays.length > MAX_CUTOFFS || rawDays.some((d) => !Number.isFinite(d) || d < 1 || d > MAX_LOOKBACK_DAYS)) {
    return apiJsonResponse(
      { error: `days_ago must be 1-${MAX_CUTOFFS} lookbacks between 1 and ${MAX_LOOKBACK_DAYS} days` },
      auth.rateLimitHeaders,
      400
    );
  }
  const now = Date.now();
  const cutoffs = [...new Set(rawDays)]
    .sort((a, b) => a - b)
    .map((d) => new Date(now - d * 24 * 60 * 60 * 1000));

  const rawMin = Number(params.get('min_probability') || '0.35');
  const minProbability = Number.isFinite(rawMin) ? Math.min(1, Math.max(0, rawMin)) : 0.35;

  const snapshotsMap = await getCachedSnapshotsMap();
  const snapshots = Array.from(snapshotsMap.values());

  // Bounded history fetch: cursor pages over cut + release events only.
  const allEvents = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const res = await getEvents({
      eventTypes: ['PRICE_CHANGE', 'NEW_MODEL'],
      limit: EVENTS_PER_PAGE,
      cursor,
    });
    allEvents.push(...res.events);
    if (!res.hasMore || !res.nextCursor) break;
    cursor = res.nextCursor;
  }

  const result = runBacktest(snapshots, allEvents, cutoffs, { minProbability });
  return apiJsonResponse(
    { version: 'v1', ...result },
    auth.rateLimitHeaders
  );
}
