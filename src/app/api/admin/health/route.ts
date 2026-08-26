import { NextRequest, NextResponse } from 'next/server';
import { getLatestIngestionRuns, getMarketStats } from '../../../../lib/db/queries';
import { isPostgres } from '../../../../lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;

  if (adminSecret) {
    const authHeader = request.headers.get('authorization');
    const secretHeader = request.headers.get('x-admin-secret');
    const querySecret = request.nextUrl.searchParams.get('secret');

    const isAuthorized =
      authHeader === `Bearer ${adminSecret}` ||
      secretHeader === adminSecret ||
      querySecret === adminSecret;

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid ADMIN_SECRET bearer token or x-admin-secret header required.' },
        { status: 401 }
      );
    }
  }

  try {
    const runs = await getLatestIngestionRuns(20);
    const stats = await getMarketStats();

    // Group latest run by source
    const sources = ['openrouter', 'github', 'huggingface'] as const;
    const sourceStatus: Record<string, any> = {};

    for (const src of sources) {
      const latest = runs.find((r) => r.source === src);
      sourceStatus[src] = {
        lastRunAt: latest?.started_at || null,
        status: latest?.status || 'idle',
        modelsSeen: latest?.models_seen || 0,
        eventsEmitted: latest?.events_emitted || 0,
        errorDetail: latest?.error_detail || null,
      };
    }

    const isHealthy = !runs.slice(0, 3).some((r) => r.status === 'failed');

    return NextResponse.json({
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      database: {
        engine: isPostgres() ? 'PostgreSQL' : 'Local Storage Engine',
        totalActiveModels: stats.totalActiveModels,
        lastPolledAt: stats.lastPolledAt,
      },
      sources: sourceStatus,
      recentRuns: runs,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: error.message || String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
