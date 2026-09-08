import { NextRequest, NextResponse } from 'next/server';
import { getLatestSnapshotsMap } from '@/lib/db/queries';
import { computeArbitrageOpportunities } from '@/lib/arbitrage';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'ARBITRAGE_ANALYTICS');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'arbitrage');
    if (limited) return limited;

    const snapshotsMap = await getLatestSnapshotsMap();
    const snapshots = Array.from(snapshotsMap.values());
    const opportunities = computeArbitrageOpportunities(snapshots);

    return NextResponse.json({
      totalClusters: opportunities.length,
      opportunities,
    });
  } catch (error: any) {
    console.error('API /api/arbitrage error:', error);
    return NextResponse.json({ error: 'Failed to compute arbitrage data' }, { status: 500 });
  }
}
