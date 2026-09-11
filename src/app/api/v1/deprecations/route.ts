import { NextRequest, NextResponse } from 'next/server';
import { getEvents } from '@/lib/db/queries';
import { withPublicGuards } from '@/lib/route-guards';
import { computeDeprecationStats, DEPRECATION_MATURITY_MIN_PAIRS } from '@/lib/deprecation';

/**
 * S1 Phase-2 report: per-provider deprecation-notice track record.
 * Starts in "collecting data" state until DEPRECATION_MATURITY_MIN_PAIRS
 * real announcement/removal pairs accumulate. Never backfills guesses.
 */
export const dynamic = 'force-dynamic';

export const GET = withPublicGuards(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get('provider') || undefined;
  const events = await getEvents({
    eventTypes: ['DEPRECATION_ANNOUNCED', 'MODEL_REMOVED'] as any,
    provider,
    limit: 5000,
  });
  const list = (events as any).events || events;
  const stats = computeDeprecationStats(Array.isArray(list) ? list : []);
  const filtered = provider
    ? stats.providers.filter((p) => p.provider.toLowerCase() === provider.toLowerCase())
    : stats.providers;
  return NextResponse.json({
    version: 'v1',
    status: stats.mature ? 'mature' : 'collecting',
    maturity: {
      total_pairs: stats.total_pairs,
      min_pairs: DEPRECATION_MATURITY_MIN_PAIRS,
      note: stats.mature
        ? `Based on ${stats.total_pairs} observed removals with sourced announcements.`
        : `Collecting data: ${stats.total_pairs}/${DEPRECATION_MATURITY_MIN_PAIRS} observed pairs. Historical removals without a sourced announcement are excluded, not backfilled.`,
    },
    providers: filtered,
  });
});
