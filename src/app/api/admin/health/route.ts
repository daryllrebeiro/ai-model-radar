import { NextRequest, NextResponse } from 'next/server';
import { getLatestIngestionRuns, getMarketStats } from '../../../../lib/db/queries';
import { isPostgres } from '../../../../lib/db/client';
import { getGitHubRateLimitStatus, getGitHubPollIntervalMinutes } from '../../../../lib/ingestion/github-labs';
import { isBillingEnabled } from '../../../../lib/feature-flags';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret) {
    return NextResponse.json(
      { error: 'Admin authentication not configured.' },
      { status: 401 }
    );
  }

  const authHeader = request.headers.get('authorization');
  const secretHeader = request.headers.get('x-admin-secret');

  const isAuthorized =
    authHeader === `Bearer ${adminSecret}` ||
    secretHeader === adminSecret;

  if (!isAuthorized) {
    return NextResponse.json(
      { error: 'Unauthorized: Valid ADMIN_SECRET bearer token or x-admin-secret header required.' },
      { status: 401 }
    );
  }

  try {
    const runs = await getLatestIngestionRuns(20);
    const stats = await getMarketStats();
    const githubRateLimit = getGitHubRateLimitStatus();
    const githubPollInterval = getGitHubPollIntervalMinutes();

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

    // Add extra telemetry to github source
    sourceStatus.github = {
      ...sourceStatus.github,
      pollIntervalMinutes: githubPollInterval,
      rateLimit: githubRateLimit,
    };

    const isHealthy = !runs.slice(0, 3).some((r) => r.status === 'failed');

    return NextResponse.json({
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      billing: {
        enabled: isBillingEnabled(),
      },
      database: {
        engine: isPostgres() ? 'PostgreSQL' : 'Local Storage Engine',
        totalActiveModels: stats.totalActiveModels,
        lastPolledAt: stats.lastPolledAt,
      },
      sources: sourceStatus,
      recentRuns: runs,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal health check failure' },
      { status: 500 }
    );
  }
}
