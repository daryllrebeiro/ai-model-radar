import { ModelSnapshot } from '@/types/models';
import { RAW_BENCHMARK_DATA } from '@/lib/benchmarks';
import { RawBenchmarkRecord } from '@/types/benchmarks';

export interface MigrationAlternative {
  model_id: string;
  model_name: string;
  provider: string;
  prompt_per_1m: number;
  comp_per_1m: number;
  context_length: number;
  modality: string;
  cost_savings_pct: number;
  cost_difference_label: string;
  context_comparison_label: string;
  benchmark_comparison?: {
    arena_elo?: number;
    humaneval?: number;
    math_500?: number;
    delta_elo?: number;
    source_name: string;
    source_url: string;
  };
  is_same_provider: boolean;
  is_direct_drop_in: boolean;
  rationale: string;
}

export interface MigrationReport {
  target_model: {
    model_id: string;
    model_name: string;
    provider: string;
    prompt_per_1m: number;
    comp_per_1m: number;
    context_length: number;
    modality: string;
  };
  alternatives: MigrationAlternative[];
  compare_url: string;
}

/**
 * Finds top 2-3 transparent migration alternatives for any given target model.
 * Matches on modality, context length, pricing efficiency, and benchmark tier.
 */
export function findMigrationAlternatives(
  targetModelId: string,
  snapshots: ModelSnapshot[]
): MigrationReport | null {
  const normalizedTargetId = targetModelId.toLowerCase().trim();

  // Find target in snapshots or benchmark catalog
  let target = snapshots.find(
    (s) =>
      s.model_id.toLowerCase() === normalizedTargetId ||
      s.model_id.toLowerCase().includes(normalizedTargetId) ||
      s.name.toLowerCase().includes(normalizedTargetId)
  );

  const targetBenchmark = RAW_BENCHMARK_DATA.find(
    (b) =>
      b.model_id.toLowerCase() === normalizedTargetId ||
      normalizedTargetId.includes(b.model_id.toLowerCase()) ||
      b.name.toLowerCase().includes(normalizedTargetId)
  );

  const targetPrompt1m = target?.price_prompt !== null && target?.price_prompt !== undefined
    ? target.price_prompt * 1_000_000
    : targetBenchmark?.pricing_prompt_1m || 3.0;

  const targetComp1m = target?.price_completion !== null && target?.price_completion !== undefined
    ? target.price_completion * 1_000_000
    : targetBenchmark?.pricing_comp_1m || 15.0;

  const targetBlended = (targetPrompt1m * 0.5) + (targetComp1m * 0.5);
  const targetContext = target?.context_length || 128000;
  const targetModality = target?.modality || 'Text + Multimodal';
  const targetProvider = target?.provider || targetBenchmark?.provider || 'Unknown';
  const targetName = target?.name || targetBenchmark?.name || targetModelId;

  // Filter pool of potential alternatives (exclude target)
  const candidateSnapshots = snapshots.filter(
    (s) => s.model_id.toLowerCase() !== (target?.model_id || normalizedTargetId).toLowerCase()
  );

  const matchedAlternatives: MigrationAlternative[] = [];

  // 1. Check verified benchmarks pool for high-confidence options
  const benchmarkCandidates = RAW_BENCHMARK_DATA.filter(
    (b) => b.model_id.toLowerCase() !== normalizedTargetId
  );

  for (const b of benchmarkCandidates) {
    const snap = candidateSnapshots.find((s) => s.model_id.toLowerCase() === b.model_id.toLowerCase());
    const prompt1m = (snap?.price_prompt !== null && snap?.price_prompt !== undefined
      ? snap.price_prompt * 1_000_000
      : b.pricing_prompt_1m) ?? 0;
    const comp1m = (snap?.price_completion !== null && snap?.price_completion !== undefined
      ? snap.price_completion * 1_000_000
      : b.pricing_comp_1m) ?? 0;

    const blended = (prompt1m * 0.5) + (comp1m * 0.5);
    const savingsPct = targetBlended > 0 ? Math.round(((targetBlended - blended) / targetBlended) * 100) : 0;
    const ctx = snap?.context_length || 128000;
    const isSameProvider = (snap?.provider || b.provider).toLowerCase() === targetProvider.toLowerCase();
    const eloDelta = (b.arena_elo && targetBenchmark?.arena_elo) ? b.arena_elo - targetBenchmark.arena_elo : undefined;

    let rationale = '';
    if (savingsPct > 0 && eloDelta !== undefined && eloDelta >= -15) {
      rationale = `${savingsPct}% lower token costs with virtually identical reasoning performance (${b.arena_elo} Arena Elo).`;
    } else if (savingsPct > 50) {
      rationale = `Major cost efficiency (${savingsPct}% cheaper) with high general capability.`;
    } else if (eloDelta !== undefined && eloDelta > 0) {
      rationale = `Upgraded reasoning capability (+${eloDelta} Elo) at $${prompt1m.toFixed(2)}/1M input pricing.`;
    } else {
      rationale = `Standard drop-in alternative with ${Math.round(ctx / 1024)}k context window.`;
    }

    matchedAlternatives.push({
      model_id: b.model_id,
      model_name: b.name,
      provider: snap?.provider || b.provider,
      prompt_per_1m: prompt1m,
      comp_per_1m: comp1m,
      context_length: ctx,
      modality: snap?.modality || 'Text + Multimodal',
      cost_savings_pct: savingsPct,
      cost_difference_label: `$${prompt1m.toFixed(2)} / $${comp1m.toFixed(2)} per 1M (vs $${targetPrompt1m.toFixed(2)} / $${targetComp1m.toFixed(2)})`,
      context_comparison_label: ctx >= targetContext ? `${Math.round(ctx / 1024)}k tokens (${ctx > targetContext ? 'Larger' : 'Equal'})` : `${Math.round(ctx / 1024)}k tokens`,
      benchmark_comparison: {
        arena_elo: b.arena_elo,
        humaneval: b.humaneval,
        math_500: b.math_500,
        delta_elo: eloDelta,
        source_name: b.source_name || 'Verified Evaluations',
        source_url: b.source_url || 'https://lmsys.org',
      },
      is_same_provider: isSameProvider,
      is_direct_drop_in: isSameProvider || b.model_id.includes('openai') || b.model_id.includes('deepseek'),
      rationale,
    });
  }

  // Sort: prioritize highest savings among comparable or higher benchmark models
  matchedAlternatives.sort((a, b) => {
    // If one is vastly cheaper with similar benchmark, prioritize it
    return b.cost_savings_pct - a.cost_savings_pct;
  });

  const selectedAlternatives = matchedAlternatives.slice(0, 3);
  const compareModelIds = [target?.model_id || normalizedTargetId, ...selectedAlternatives.map((a) => a.model_id)].join(',');

  return {
    target_model: {
      model_id: target?.model_id || normalizedTargetId,
      model_name: targetName,
      provider: targetProvider,
      prompt_per_1m: targetPrompt1m,
      comp_per_1m: targetComp1m,
      context_length: targetContext,
      modality: targetModality,
    },
    alternatives: selectedAlternatives,
    compare_url: `/compare?models=${encodeURIComponent(compareModelIds)}`,
  };
}
