/**
 * Shared R3/R4 catalog enrichment: attribute filters + pagination over the
 * filtered set + capabilities/license join. Single home for logic previously
 * duplicated between the legacy `/api/models` and `v1/models` twins —
 * per ADR-4 the legacy surface is frozen, so both twins call these helpers
 * and no third copy may be added.
 */
import { ModelCurrent } from '@/types/models';
import { findCapabilityForModel } from './capabilities';
import { findLicenseForModel } from './licenses';
import { findComplianceForModel } from './compliance';
import { classifyModelCategory, findEmbeddingForModel, findEmbeddingBenchmark } from './embeddings';

export interface AttributeFilters {
  toolCalling?: boolean;
  vision?: boolean;
  commercial?: boolean;
  hipaaEligible?: boolean;
  euResidency?: boolean;
}

export function hasAttributeFilters(f: AttributeFilters): boolean {
  return f.toolCalling !== undefined || f.vision !== undefined || f.commercial !== undefined || f.hipaaEligible !== undefined || f.euResidency !== undefined;
}

/** Attribute filters join sourced static datasets — no DB column. */
export function applyAttributeFilters(models: ModelCurrent[], f: AttributeFilters): ModelCurrent[] {
  if (!hasAttributeFilters(f)) return models;
  return models.filter((m) => {
    if (f.toolCalling !== undefined && findCapabilityForModel(m.model_id)?.tool_calling !== f.toolCalling) return false;
    if (f.vision !== undefined && findCapabilityForModel(m.model_id)?.vision !== f.vision) return false;
    if (f.commercial !== undefined && (findLicenseForModel(m.model_id)?.commercial_use_allowed === true) !== f.commercial) return false;
    if (f.hipaaEligible !== undefined && findComplianceForModel(m.model_id)?.hipaa_eligible !== f.hipaaEligible) return false;
    if (f.euResidency !== undefined && findComplianceForModel(m.model_id)?.eu_data_residency !== f.euResidency) return false;
    return true;
  });
}

export type EnrichedModel = ModelCurrent & {
  capabilities: ReturnType<typeof findCapabilityForModel>;
  license: ReturnType<typeof findLicenseForModel>;
  compliance: ReturnType<typeof findComplianceForModel>;
  category: ReturnType<typeof classifyModelCategory>;
  embedding: ReturnType<typeof findEmbeddingForModel>;
  embeddingBenchmark: ReturnType<typeof findEmbeddingBenchmark>;
};

export function enrichModels(models: ModelCurrent[]): EnrichedModel[] {
  return models.map((m) => ({
    ...m,
    capabilities: findCapabilityForModel(m.model_id),
    license: findLicenseForModel(m.model_id),
    compliance: findComplianceForModel(m.model_id),
    category: classifyModelCategory(m.model_id),
    embedding: findEmbeddingForModel(m.model_id),
    embeddingBenchmark: findEmbeddingBenchmark(m.model_id),
  }));
}

/** S9 category filter — applied post-query like attribute filters. */
export function applyCategoryFilter(models: ModelCurrent[], category?: string): ModelCurrent[] {
  if (!category || category === 'all') return models;
  if (category !== 'chat' && category !== 'embedding') return models;
  return models.filter((m) => classifyModelCategory(m.model_id) === category);
}

/**
 * P3 (S5) — latency sort from first-party probe telemetry. Latest p95 per
 * model; models without telemetry sort LAST (unknown slowness must never
 * outrank measured speed, nor pose as fast). Scope note travels with the
 * response — see ACTIVE_PROBE_SCOPE_NOTE.
 */
export function latestP95ByModel(
  records: Array<{ model_id: string; p95_latency_ms: number | null; checked_at: string }>
): Map<string, number> {
  const best = new Map<string, { p95: number; at: number }>();
  for (const r of records) {
    if (r.p95_latency_ms === null || r.p95_latency_ms === undefined) continue;
    const at = new Date(r.checked_at).getTime();
    const cur = best.get(r.model_id);
    if (!cur || at > cur.at) best.set(r.model_id, { p95: r.p95_latency_ms, at });
  }
  return new Map([...best.entries()].map(([k, v]) => [k, v.p95]));
}

export function sortModelsByLatency(models: ModelCurrent[], p95ByModel: Map<string, number>): ModelCurrent[] {
  return [...models].sort((a, b) => {
    const pa = p95ByModel.get(a.model_id);
    const pb = p95ByModel.get(b.model_id);
    if (pa === undefined && pb === undefined) return 0;
    if (pa === undefined) return 1;
    if (pb === undefined) return -1;
    return pa - pb;
  });
}
