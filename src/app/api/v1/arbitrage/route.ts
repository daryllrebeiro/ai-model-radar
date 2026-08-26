import { NextRequest } from 'next/server';
import { getLatestSnapshotsMap } from '@/lib/db/queries';
import { computeArbitrageOpportunities } from '@/lib/arbitrage';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }

  const snapshotsMap = await getLatestSnapshotsMap();
  const snapshots = Array.from(snapshotsMap.values());
  const opportunities = computeArbitrageOpportunities(snapshots);

  return apiJsonResponse(
    {
      version: 'v1',
      total_clusters: opportunities.length,
      data: opportunities,
    },
    auth.rateLimitHeaders
  );
}
