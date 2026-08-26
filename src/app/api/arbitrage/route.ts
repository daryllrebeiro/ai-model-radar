import { NextResponse } from 'next/server';
import { getLatestSnapshotsMap } from '@/lib/db/queries';
import { computeArbitrageOpportunities } from '@/lib/arbitrage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
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
