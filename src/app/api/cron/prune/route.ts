import { NextRequest, NextResponse } from 'next/server';
import {
  pruneOldRawJson,
  pruneRoutingAttempts,
  pruneUsageImports,
  getRoutingReliability,
} from '@/lib/db/queries';
import {
  routingRetentionDays,
  usageRetentionDays,
  retentionCutoffIso,
} from '@/lib/retention';
import { secretsEqual } from '@/lib/secrets';
import { logAuthDenied } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handlePrune(request);
}

export async function POST(request: NextRequest) {
  return handlePrune(request);
}

async function handlePrune(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Fail closed: without a configured CRON_SECRET there is nothing to verify
  // against, so pruning must not be remotely triggerable.
  if (!cronSecret || !secretsEqual(authHeader, `Bearer ${cronSecret}`)) {
    logAuthDenied('cron/prune', request, !cronSecret ? 'secret-unset' : 'bad-secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const days = process.env.PRUNE_DAYS ? parseInt(process.env.PRUNE_DAYS, 10) : 30;
    const result = await pruneOldRawJson(days);

    // P0 retention: aggregate-then-delete for write-per-request/upload tables.
    // Each stage is isolated — a retention failure never fails raw-json pruning.
    const routingDays = routingRetentionDays();
    const usageDays = usageRetentionDays();
    let routing: Record<string, unknown> = { skipped: true };
    let usage: Record<string, unknown> = { skipped: true };
    try {
      const reliability = await getRoutingReliability(Math.min(24 * 30, routingDays * 24));
      const pruned = await pruneRoutingAttempts(retentionCutoffIso(routingDays));
      routing = { window_days: routingDays, pre_prune_reliability: reliability, ...pruned };
    } catch (err) {
      logger.warn('Routing-attempt retention failed:', { error: String(err) });
      routing = { error: 'retention failed (see logs)' };
    }
    try {
      const pruned = await pruneUsageImports(retentionCutoffIso(usageDays));
      usage = { window_days: usageDays, ...pruned };
    } catch (err) {
      logger.warn('Usage-import retention failed:', { error: String(err) });
      usage = { error: 'retention failed (see logs)' };
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      daysToKeep: days,
      prunedSnapshotsCount: result.prunedCount,
      retention: { routing_attempts: routing, usage_imports: usage },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Prune operation failed',
      },
      { status: 500 }
    );
  }
}

