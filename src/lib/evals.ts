/**
 * BYO Eval Harness (pure): validation + leaderboard aggregation for
 * user-submitted benchmark runs.
 *
 * A run scores one model on one suite: { metric -> 0..100 }. Metric names
 * are caller-defined (snake_case, e.g. "sql_gen_v2") so teams can track
 * internal evals the curated catalog never covers. The leaderboard shows
 * per-model means + sample counts; an optional weights map produces a
 * single composite for ranking.
 */

export const MAX_EVAL_METRICS = 20;
export const MAX_EVAL_SAMPLES = 100_000;
const METRIC_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;

export function validateEvalScores(scores: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof scores !== 'object' || scores === null || Array.isArray(scores)) {
    return { ok: false, errors: ['scores must be an object of metric -> 0..100'] };
  }
  const entries = Object.entries(scores);
  if (entries.length === 0) errors.push('scores must contain at least one metric');
  if (entries.length > MAX_EVAL_METRICS) {
    errors.push(`scores must contain at most ${MAX_EVAL_METRICS} metrics`);
  }
  for (const [metric, value] of entries) {
    if (!METRIC_RE.test(metric)) {
      errors.push(`invalid metric name "${metric.slice(0, 40)}" (snake_case, max 64 chars)`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      errors.push(`metric "${metric}" must be a number between 0 and 100`);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export interface EvalRunInput {
  suite: string;
  model_id: string;
  scores: Record<string, number>;
  samples?: number;
}

export function validateEvalRun(input: {
  suite: unknown;
  model_id: unknown;
  scores: unknown;
  samples?: unknown;
}): { ok: true; run: EvalRunInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const suite = typeof input.suite === 'string' ? input.suite.trim().slice(0, 120) : '';
  if (!suite) errors.push('suite is required');
  const model_id = typeof input.model_id === 'string' ? input.model_id.trim().slice(0, 500) : '';
  if (!model_id) errors.push('model_id is required');
  const scoreCheck = validateEvalScores(input.scores);
  if (!scoreCheck.ok) errors.push(...(scoreCheck as { errors: string[] }).errors);
  let samples = 1;
  if (input.samples !== undefined) {
    samples = Number(input.samples);
    if (!Number.isInteger(samples) || samples < 1 || samples > MAX_EVAL_SAMPLES) {
      errors.push(`samples must be an integer between 1 and ${MAX_EVAL_SAMPLES}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, run: { suite, model_id, scores: input.scores as Record<string, number>, samples } };
}

export interface LeaderboardEntry {
  model_id: string;
  runs: number;
  total_samples: number;
  mean_scores: Record<string, number>;
  composite: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Aggregates runs into per-model means. weights (optional) maps metric ->
 * positive weight for a weighted composite; without weights the composite
 * is the mean of metric means. Unknown weight keys are ignored; metrics
 * without weights score 0 in weighted mode.
 */
export function buildLeaderboard(
  runs: Array<{ model_id: string; scores: Record<string, number>; samples: number }>,
  weights?: Record<string, number>
): LeaderboardEntry[] {
  const byModel = new Map<string, { sums: Map<string, number>; n: number; samples: number }>();
  for (const r of runs) {
    let agg = byModel.get(r.model_id);
    if (!agg) {
      agg = { sums: new Map(), n: 0, samples: 0 };
      byModel.set(r.model_id, agg);
    }
    agg.n += 1;
    agg.samples += r.samples;
    for (const [metric, value] of Object.entries(r.scores)) {
      agg.sums.set(metric, (agg.sums.get(metric) ?? 0) + value);
    }
  }

  const cleanWeights = new Map<string, number>();
  if (weights) {
    for (const [k, v] of Object.entries(weights)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        cleanWeights.set(k, v);
      }
    }
  }

  const entries: LeaderboardEntry[] = [];
  for (const [model_id, agg] of byModel) {
    const mean_scores: Record<string, number> = {};
    for (const [metric, sum] of agg.sums) {
      mean_scores[metric] = round2(sum / agg.n);
    }
    let composite: number | null = null;
    const metrics = Object.keys(mean_scores);
    if (metrics.length > 0) {
      if (cleanWeights.size > 0) {
        let weighted = 0;
        let totalW = 0;
        for (const m of metrics) {
          const w = cleanWeights.get(m) ?? 0;
          weighted += mean_scores[m] * w;
          totalW += w;
        }
        composite = totalW > 0 ? round2(weighted / totalW) : null;
      } else {
        composite = round2(metrics.reduce((s, m) => s + mean_scores[m], 0) / metrics.length);
      }
    }
    entries.push({ model_id, runs: agg.n, total_samples: agg.samples, mean_scores, composite });
  }
  entries.sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));
  return entries;
}
