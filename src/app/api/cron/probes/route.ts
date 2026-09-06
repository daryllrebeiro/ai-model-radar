import { NextRequest, NextResponse } from 'next/server';
import { getLatestSnapshotsMap } from '@/lib/db/queries';
import { runEndpointProbes } from '@/lib/probe';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET/POST /api/cron/probes?limit=25&sample_count=2&dry_run=1
 *
 * Scheduled endpoint-probe cycle (F2 live endpoint intelligence) for the deploy
 * surface — wired in vercel.json alongside /api/cron/poll and /api/cron/digest.
 * Feeds the tracked snapshot catalog into runEndpointProbes so the worker always
 * resolves live targets (bare `runEndpointProbes()` with no snapshots probes
 * nothing). `dry_run=1` resolves targets without probing or persisting, for ops
 * checks and hermetic tests.
 */
export async function GET(request: NextRequest) {
  return handleProbes(request);
}

export async function POST(request: NextRequest) {
  return handleProbes(request);
}

async function handleProbes(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawLimit = Number(request.nextUrl.searchParams.get('limit') || '25');
    const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 25;
    const rawSamples = Number(request.nextUrl.searchParams.get('sample_count') || '2');
    const sampleCount = Number.isFinite(rawSamples) ? Math.min(5, Math.max(1, Math.floor(rawSamples))) : 2;
    const dryRun = request.nextUrl.searchParams.get('dry_run') === '1';

    const snapshots = Array.from((await getLatestSnapshotsMap()).values());

    if (dryRun) {
      const { buildProbeTargets } = await import('@/lib/probe');
      const targets = buildProbeTargets(snapshots);
      return NextResponse.json({
        success: true,
        dry_run: true,
        snapshots: snapshots.length,
        targets: targets.length,
        timestamp: new Date().toISOString(),
      });
    }

    const result = await runEndpointProbes({ snapshots, limit, sampleCount });
    const { records: _records, ...summary } = result;
    return NextResponse.json({ success: true, ...summary });
  } catch (error: any) {
    logger.error(`Probe cron failure: ${error.message}`);
    return NextResponse.json({ success: false, error: 'Probe cycle failed' }, { status: 500 });
  }
}
