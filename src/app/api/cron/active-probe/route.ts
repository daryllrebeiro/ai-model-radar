import { NextRequest, NextResponse } from 'next/server';
import { getModelCurrentList, recordProbeSpend } from '@/lib/db/queries';
import {
  runActiveProbeCycle,
  selectActiveProbeTargets,
  isActiveProbeEnabled,
  buildProbeGenerateFn,
} from '@/lib/active-probe';
import { DEFAULT_ACTIVE_PROBE_BUDGET } from '@/types/active-probe';
import {
  isProbeCycleInFlight,
  markProbeCycleStarted,
  markProbeCycleFinished,
} from '@/lib/probe-overlap';
import { secretsEqual } from '@/lib/secrets';
import { logAuthDenied } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * P2-2 — scheduled paid-cycle trigger for S4+S5 active probing.
 *
 * Gate order (each refuses before the next spends anything):
 *   1. CRON_SECRET auth (fail-closed, like poll/probes/digest).
 *   2. ACTIVE_PROBE_ENABLED kill switch (fail-closed default OFF).
 *   3. dry_run=1 → resolve targets, spend nothing, persist nothing.
 *   4. Live run requires a dedicated PROBE key — without one, 503 with an
 *      explicit message (never half-run, never app keys, never routing keys).
 *   5. Overlap guard: a second concurrent trigger gets 409 (best-effort,
 *      single-instance; multi-instance deploys should add a DB lease).
 *
 * Generation is OpenAI-compatible chat completions with a 15s per-call
 * timeout; every cycle writes per-model probe_spend_ledger rows (P1-1).
 */

export async function GET(request: NextRequest) {
  return handleActiveProbeCycle(request);
}

export async function POST(request: NextRequest) {
  return handleActiveProbeCycle(request);
}

async function handleActiveProbeCycle(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !secretsEqual(authHeader, `Bearer ${cronSecret}`)) {
    logAuthDenied('cron/active-probe', request, !cronSecret ? 'secret-unset' : 'bad-secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isActiveProbeEnabled()) {
    return NextResponse.json({
      success: false,
      status: 'disabled',
      message: 'Active probing is disabled (ACTIVE_PROBE_ENABLED !== true). No spend, no calls.',
    });
  }
  if (isProbeCycleInFlight()) {
    return NextResponse.json({ success: false, status: 'overlap', message: 'A probe cycle is already running.' }, { status: 409 });
  }
  const params = request.nextUrl.searchParams;
  const dryRun = params.get('dry_run') === '1';
  const onlyModels = (params.get('models') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const apiKey = process.env.PROBE_OPENAI_KEY || '';
  const baseUrl = process.env.PROBE_BASE_URL || 'https://api.openai.com/v1';

  try {
    const { models } = await getModelCurrentList({ limit: 500 });
    const catalogIds = models.map((m) => m.model_id);
    const pool = onlyModels.length > 0 ? onlyModels.filter((id) => catalogIds.includes(id)) : catalogIds;
    const targets = selectActiveProbeTargets(pool, [], DEFAULT_ACTIVE_PROBE_BUDGET);
    if (dryRun) {
      return NextResponse.json({
        success: true,
        dry_run: true,
        targets,
        budgeted_calls: Math.min(targets.length * DEFAULT_ACTIVE_PROBE_BUDGET.max_prompts_per_model, DEFAULT_ACTIVE_PROBE_BUDGET.max_calls_per_run),
        timestamp: new Date().toISOString(),
      });
    }
    if (!apiKey) {
      return NextResponse.json(
        { success: false, status: 'no-credentials', message: 'No dedicated PROBE key configured — refusing to run paid calls. Set PROBE_OPENAI_KEY (budget-capped, low-privilege).' },
        { status: 503 }
      );
    }
    if (!markProbeCycleStarted()) {
      return NextResponse.json({ success: false, status: 'overlap', message: 'A probe cycle is already running.' }, { status: 409 });
    }
    try {
      const cycleId = `active-${Date.now().toString(36)}`;
      const result = await runActiveProbeCycle({
        modelIds: targets,
        generateFn: buildProbeGenerateFn({ baseUrl, apiKey }),
        asOf: new Date().toISOString(),
      });
      for (const modelId of targets) {
        const samples = result.samples.filter((s) => s.model_id === modelId);
        const estTokens = samples.reduce((a, s) => a + Math.ceil(s.output.length / 4), 0);
        await recordProbeSpend({
          cycle_id: cycleId,
          model_id: modelId,
          provider: modelId.split('/')[0] || '',
          calls: samples.length,
          errors: result.per_model_errors[modelId] || 0,
          est_tokens: estTokens,
        });
      }
      const { samples: _s, diffs: _d, ...summary } = result;
      return NextResponse.json({ success: true, cycle_id: cycleId, ...summary });
    } finally {
      markProbeCycleFinished();
    }
  } catch (error: any) {
    markProbeCycleFinished();
    logger.error(`Active probe cycle failure: ${error.message}`);
    return NextResponse.json({ success: false, error: 'Active probe cycle failed' }, { status: 500 });
  }
}
