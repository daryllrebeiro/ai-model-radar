import { NextRequest, NextResponse } from 'next/server';
import { pruneOldRawJson } from '@/lib/db/queries';
import { secretsEqual } from '@/lib/secrets';
import { logAuthDenied } from '@/lib/api-auth';

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

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      daysToKeep: days,
      prunedSnapshotsCount: result.prunedCount,
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

