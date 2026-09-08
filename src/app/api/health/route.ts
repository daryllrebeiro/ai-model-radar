import { NextRequest, NextResponse } from 'next/server';
import { getMarketStats, getLatestSnapshotsMap } from '@/lib/db/queries';
import { isPostgres } from '@/lib/db/client';
import { validatePublicApiRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Throttle like every other public read: monitors poll ~1/min, well
    // under the anonymous budget, while floods get 429s.
    const auth = await validatePublicApiRequest(request);
    if (!auth.allowed && auth.errorResponse) {
      return auth.errorResponse;
    }

    const stats = await getMarketStats();
    const snapshotsMap = await getLatestSnapshotsMap();

    const isHealthy = snapshotsMap.size > 0;

    return NextResponse.json({
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      database: isPostgres() ? 'postgresql' : 'local_storage',
      totalActiveModels: stats.totalActiveModels,
      lastPolledAt: stats.lastPolledAt,
      version: '1.0.0',
    });
  } catch {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
      },
      { status: 500 }
    );
  }
}
