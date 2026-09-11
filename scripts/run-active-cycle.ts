/**
 * run-active-cycle.ts — supervised first-cycle runner (review §3 P0 procedure).
 *
 * DEFAULT IS DRY: resolves targets, prints the budgeted call count, spends
 * nothing, persists nothing. A live run requires ALL THREE, otherwise it
 * refuses (exit 1) instead of half-running:
 *   1. ACTIVE_PROBE_ENABLED=true in the environment,
 *   2. PROBE_OPENAI_KEY set (dedicated, budget-capped key — never app keys),
 *   3. explicit --live flag AND explicit --models a,b,c (no "all catalog" mode).
 *
 * Live runs write per-model probe_spend_ledger rows and record drift
 * candidates to the review queue, then print the ledger summary for the
 * operator to read before scheduling anything.
 *
 * Usage:
 *   npx tsx scripts/run-active-cycle.ts [--live --models openai/gpt-4o,...]
 */
import { getModelCurrentList, recordProbeSpend } from '../src/lib/db/queries';
import {
  runActiveProbeCycle,
  selectActiveProbeTargets,
  isActiveProbeEnabled,
  buildProbeGenerateFn,
} from '../src/lib/active-probe';
import { DEFAULT_ACTIVE_PROBE_BUDGET } from '../src/types/active-probe';
import { recordDriftCandidates } from '../src/lib/db/queries';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npx tsx scripts/run-active-cycle.ts [--live --models a,b,c]');
    console.log('Default is a dry run (targets only, zero spend, zero persistence).');
    process.exit(0);
  }
  const live = args.includes('--live');
  const modelsArg = args.find((a) => a.startsWith('--models='))?.slice('--models='.length) || '';
  const onlyModels = modelsArg.split(',').map((s) => s.trim()).filter(Boolean);

  const { models } = await getModelCurrentList({ limit: 500 });
  const catalogIds = models.map((m) => m.model_id);
  const pool = onlyModels.length > 0 ? onlyModels.filter((id) => catalogIds.includes(id)) : catalogIds;
  const targets = selectActiveProbeTargets(pool, [], DEFAULT_ACTIVE_PROBE_BUDGET);
  const budgeted = Math.min(targets.length * DEFAULT_ACTIVE_PROBE_BUDGET.max_prompts_per_model, DEFAULT_ACTIVE_PROBE_BUDGET.max_calls_per_run);
  console.log(`Targets (${targets.length}): ${targets.join(', ') || '(none)'}`);
  console.log(`Budgeted paid calls: ${budgeted}`);

  if (!live) {
    console.log('DRY RUN — no spend, no persistence. Re-run with --live --models=... to spend.');
    process.exit(0);
  }
  if (!isActiveProbeEnabled()) {
    console.error('REFUSED: ACTIVE_PROBE_ENABLED !== true. Set it deliberately, then re-run.');
    process.exit(1);
  }
  const apiKey = process.env.PROBE_OPENAI_KEY || '';
  if (!apiKey) {
    console.error('REFUSED: PROBE_OPENAI_KEY unset. Provision a dedicated budget-capped key first.');
    process.exit(1);
  }
  if (onlyModels.length === 0) {
    console.error('REFUSED: live runs require explicit --models= (no whole-catalog mode).');
    process.exit(1);
  }
  const cycleId = `supervised-${Date.now().toString(36)}`;
  console.log(`LIVE cycle ${cycleId} — spending real money. Ctrl+C aborts (per-call isolation contains partial state).`);
  const result = await runActiveProbeCycle({
    modelIds: targets,
    generateFn: buildProbeGenerateFn({ baseUrl: process.env.PROBE_BASE_URL || 'https://api.openai.com/v1', apiKey }),
    asOf: new Date().toISOString(),
  });
  for (const modelId of targets) {
    const samples = result.samples.filter((s) => s.model_id === modelId);
    await recordProbeSpend({
      cycle_id: cycleId,
      model_id: modelId,
      provider: modelId.split('/')[0] || '',
      calls: samples.length,
      errors: result.per_model_errors[modelId] || 0,
      est_tokens: samples.reduce((a, s) => a + Math.ceil(s.output.length / 4), 0),
    });
  }
  const queued = await recordDriftCandidates(cycleId, result.diffs);
  console.log(`Done: calls=${result.calls_made} skipped=${result.calls_skipped_over_budget} errors=${result.errors} queued=${queued}. Read probe_spend_ledger before scheduling.`);
}

main().catch((err) => {
  console.error(`Supervised cycle failed: ${err?.message || err}`);
  process.exit(1);
});
