/**
 * Radar Router engine: pure model-selection logic for the OpenAI-compatible
 * smart proxy (`POST /api/v1/chat/completions`). Side-effect-free and fully
 * unit-testable — the route is a thin adapter over selectBestModel().
 */

export interface ModelCandidate {
  model_id: string;
  provider: string;
  name: string;
  price_prompt: number | null;
  price_completion: number | null;
  context_length: number | null;
  is_free: boolean;
  provider_healthy: boolean;
}

export interface RoutingPolicy {
  max_price_prompt?: number;
  max_price_completion?: number;
  min_context_length?: number;
  allowed_providers?: string[];
  blocked_providers?: string[];
  prefer_free: boolean;
  require_healthy: boolean;
}

export function getDefaultPolicy(tier: string): RoutingPolicy {
  switch (tier) {
    case 'enterprise':
      return {
        max_price_prompt: 100,
        max_price_completion: 100,
        min_context_length: 4096,
        prefer_free: false,
        require_healthy: true,
      };
    case 'pro':
      return {
        max_price_prompt: 10,
        max_price_completion: 10,
        min_context_length: 4096,
        prefer_free: false,
        require_healthy: true,
      };
    case 'free':
    default:
      return {
        max_price_prompt: 1,
        max_price_completion: 1,
        min_context_length: 4096,
        prefer_free: true,
        require_healthy: true,
      };
  }
}

export function selectBestModel(
  models: ModelCandidate[],
  policy: RoutingPolicy
): ModelCandidate | null {
  let candidates = models.filter((m) => m.provider_healthy);

  if (policy.allowed_providers?.length) {
    candidates = candidates.filter((m) => policy.allowed_providers!.includes(m.provider));
  }

  if (policy.blocked_providers?.length) {
    candidates = candidates.filter((m) => !policy.blocked_providers!.includes(m.provider));
  }

  if (policy.min_context_length) {
    candidates = candidates.filter(
      (m) => (m.context_length ?? 0) >= policy.min_context_length!
    );
  }

  if (policy.max_price_prompt !== undefined) {
    candidates = candidates.filter(
      (m) => m.price_prompt !== null && m.price_prompt <= policy.max_price_prompt!
    );
  }

  if (policy.max_price_completion !== undefined) {
    candidates = candidates.filter(
      (m) => m.price_completion !== null && m.price_completion <= policy.max_price_completion!
    );
  }

  if (candidates.length === 0) return null;

  if (policy.prefer_free) {
    const freeModels = candidates.filter((m) => m.is_free);
    if (freeModels.length > 0) {
      candidates = freeModels;
    }
  }

  // Sort by price (cheapest first), then by health, then by context length
  candidates.sort((a, b) => {
    const aPrompt = a.price_prompt ?? Infinity;
    const bPrompt = b.price_prompt ?? Infinity;
    if (aPrompt !== bPrompt) return aPrompt - bPrompt;

    const aHealth = a.provider_healthy ? 0 : 1;
    const bHealth = b.provider_healthy ? 0 : 1;
    if (aHealth !== bHealth) return aHealth - bHealth;

    return (b.context_length ?? 0) - (a.context_length ?? 0);
  });

  return candidates[0] || null;
}

export type RoutingPolicyMode = 'cheapest' | 'benchmark' | 'fallback_chain';

function applyBasePolicy(models: ModelCandidate[], policy: RoutingPolicy): ModelCandidate[] {
  let candidates = models.filter((m) => m.provider_healthy);
  if (policy.allowed_providers?.length) {
    candidates = candidates.filter((m) => policy.allowed_providers!.includes(m.provider));
  }
  if (policy.blocked_providers?.length) {
    candidates = candidates.filter((m) => !policy.blocked_providers!.includes(m.provider));
  }
  if (policy.min_context_length) {
    candidates = candidates.filter(
      (m) => (m.context_length ?? 0) >= policy.min_context_length!
    );
  }
  if (policy.max_price_prompt !== undefined) {
    candidates = candidates.filter(
      (m) => m.price_prompt !== null && m.price_prompt <= policy.max_price_prompt!
    );
  }
  if (policy.max_price_completion !== undefined) {
    candidates = candidates.filter(
      (m) => m.price_completion !== null && m.price_completion <= policy.max_price_completion!
    );
  }
  return candidates;
}

/**
 * R10 benchmark policy: best sourced benchmark (arena Elo) among candidates
 * passing the base policy. No synthesized score — raw Elo, cheapest breaks ties.
 */
export function selectBenchmarkModel(
  models: ModelCandidate[],
  policy: RoutingPolicy,
  eloByModelId: Map<string, number>
): ModelCandidate | null {
  const candidates = applyBasePolicy(models, policy);
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((m) => ({ m, elo: eloByModelId.get(m.model_id.toLowerCase()) ?? null }))
    .filter((r): r is { m: ModelCandidate; elo: number } => r.elo !== null);
  if (ranked.length === 0) return null;
  ranked.sort((a, b) => {
    if (b.elo !== a.elo) return b.elo - a.elo;
    return (a.m.price_prompt ?? Infinity) - (b.m.price_prompt ?? Infinity);
  });
  return ranked[0].m;
}

/**
 * R10 fallback-chain policy: first chain entry that exists in the catalog
 * (and is healthy). Explicit user-ordered chain — never a silent substitution.
 */
export function selectFallbackModel(
  models: ModelCandidate[],
  chain: string[],
  requireHealthy: boolean
): ModelCandidate | null {
  const byId = new Map(models.map((m) => [m.model_id.toLowerCase(), m]));
  const clean = chain.map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 10);
  for (const id of clean) {
    const hit = byId.get(id);
    if (!hit) continue;
    if (requireHealthy && !hit.provider_healthy) continue;
    return hit;
  }
  return null;
}
