import { NextRequest, NextResponse } from 'next/server';
import { getModelCurrentList } from '@/lib/db/queries';
import { runChangelogPoll } from '@/lib/ingestion/deprecation-changelog';
import { secretsEqual } from '@/lib/secrets';
import { logAuthDenied } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * P1-4 — S1 Phase-1 collector: weekly changelog/RSS poll emitting sourced
 * DEPRECATION_ANNOUNCED events. CRON_SECRET-gated like poll/probes/digest;
 * `dry_run=1` scans without persisting, for ops checks and hermetic tests.
 */
export async function GET(request: NextRequest) {
  return handleChangelog(request);
}

export async function POST(request: NextRequest) {
  return handleChangelog(request);
}

async function handleChangelog(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !secretsEqual(authHeader, `Bearer ${cronSecret}`)) {
    logAuthDenied('cron/deprecations', request, !cronSecret ? 'secret-unset' : 'bad-secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const dryRun = request.nextUrl.searchParams.get('dry_run') === '1';
    // Bounded window (500 = catalog cap): announcement matching is per-model.
    const { models } = await getModelCurrentList({ limit: 500 });
    const result = await runChangelogPoll({
      knownModelIds: models.map((m) => m.model_id),
      persist: !dryRun,
    });
    return NextResponse.json({ success: true, dry_run: dryRun, ...result });
  } catch (error: any) {
    logger.error(`Deprecation changelog poll failure: ${error.message}`);
    return NextResponse.json({ success: false, error: 'Changelog poll failed' }, { status: 500 });
  }
}
