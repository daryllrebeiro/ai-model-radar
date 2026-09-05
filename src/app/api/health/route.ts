import { NextResponse } from 'next/server';
import { getMarketStats, getLatestSnapshotsMap } from '@/lib/db/queries';
import { isPostgres } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
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
