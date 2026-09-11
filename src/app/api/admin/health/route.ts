import { NextRequest, NextResponse } from 'next/server';
import { getLatestIngestionRuns, getMarketStats } from '../../../../lib/db/queries';
import { isPostgres } from '../../../../lib/db/client';
import { secretsEqual } from '../../../../lib/secrets';
import { logAuthDenied } from '../../../../lib/api-auth';
import { getGitHubRateLimitStatus, getGitHubPollIntervalMinutes } from '../../../../lib/ingestion/github-labs';
import { breakerStates } from '../../../../lib/ingestion/circuit';
import { isBillingEnabled } from '../../../../lib/feature-flags';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret) {
    logAuthDenied('admin/health', request, 'secret-unset');
    return NextResponse.json(
      { error: 'Admin authentication not configured.' },
      { status: 401 }
    );
  }

  const authHeader = request.headers.get('authorization');
  const secretHeader = request.headers.get('x-admin-secret');

  const isAuthorized =
    secretsEqual(authHeader, `Bearer ${adminSecret}`) ||
    secretsEqual(secretHeader, adminSecret);

  if (!isAuthorized) {
    logAuthDenied('admin/health', request, 'bad-secret');
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

    // P2 audit: a persistently-open source breaker must be visible here,
    // not a silent indefinite stall. Breaker-open ingestion failures also
    // land in ingestion_runs as status=failed (no synthetic fallback).
    const breakers = breakerStates();
    const openBreakers = Object.entries(breakers)
      .filter(([, b]) => b.state === 'open')
      .map(([source]) => source);

    const isHealthy = !runs.slice(0, 3).some((r) => r.status === 'failed') && openBreakers.length === 0;

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
      breakers,
      openBreakers,
      recentRuns: runs,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal health check failure' },
      { status: 500 }
    );
  }
}
