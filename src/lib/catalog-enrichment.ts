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

export interface AttributeFilters {
  toolCalling?: boolean;
  vision?: boolean;
  commercial?: boolean;
}

export function hasAttributeFilters(f: AttributeFilters): boolean {
  return f.toolCalling !== undefined || f.vision !== undefined || f.commercial !== undefined;
}

/** Attribute filters join sourced static datasets — no DB column. */
export function applyAttributeFilters(models: ModelCurrent[], f: AttributeFilters): ModelCurrent[] {
  if (!hasAttributeFilters(f)) return models;
  return models.filter((m) => {
    if (f.toolCalling !== undefined && findCapabilityForModel(m.model_id)?.tool_calling !== f.toolCalling) return false;
    if (f.vision !== undefined && findCapabilityForModel(m.model_id)?.vision !== f.vision) return false;
    if (f.commercial !== undefined && (findLicenseForModel(m.model_id)?.commercial_use_allowed === true) !== f.commercial) return false;
    return true;
  });
}

export type EnrichedModel = ModelCurrent & {
  capabilities: ReturnType<typeof findCapabilityForModel>;
  license: ReturnType<typeof findLicenseForModel>;
};

export function enrichModels(models: ModelCurrent[]): EnrichedModel[] {
  return models.map((m) => ({
    ...m,
    capabilities: findCapabilityForModel(m.model_id),
    license: findLicenseForModel(m.model_id),
  }));
}
