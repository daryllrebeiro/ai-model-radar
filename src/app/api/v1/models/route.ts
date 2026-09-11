import { NextRequest } from 'next/server';
import { getModelCurrentList, getRecentEndpointTelemetry } from '@/lib/db/queries';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { modelsQuerySchema } from '@/lib/validation/api-schemas';
import { applyAttributeFilters, enrichModels, hasAttributeFilters, applyCategoryFilter, latestP95ByModel, sortModelsByLatency } from '@/lib/catalog-enrichment';
import { ACTIVE_PROBE_SCOPE_NOTE } from '@/types/active-probe';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }

  const { searchParams } = new URL(request.url);
  const rawParams: Record<string, any> = {};
  searchParams.forEach((val, key) => {
    rawParams[key] = val;
  });

  const parsed = modelsQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return apiJsonResponse(
      {
        error: 'Bad Request',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      auth.rateLimitHeaders,
      400
    );
  }

  const { q, provider, free, sortBy, limit, offset } = parsed.data;
  const category = (parsed.data as any).category as string | undefined;
  const filters = {
    toolCalling: (parsed.data as any).tool_calling as boolean | undefined,
    vision: (parsed.data as any).vision as boolean | undefined,
    commercial: (parsed.data as any).commercial as boolean | undefined,
    hipaaEligible: (parsed.data as any).hipaa_eligible as boolean | undefined,
    euResidency: (parsed.data as any).eu_residency as boolean | undefined,
  };
  const hasAttrFilter = hasAttributeFilters(filters);

  // When present, read a bounded window (500 = catalog cap) then filter +
  // paginate in Node so `total` reflects the filtered set. Latency sort is
  // always Node-side (telemetry lives outside the catalog query).
  const latencySort = sortBy === 'latency';
  const data = await getModelCurrentList({
    search: q,
    provider,
    isFree: free,
    sortBy: (latencySort ? 'name' : sortBy) as any,
    limit: hasAttrFilter || latencySort ? 500 : limit,
    offset: hasAttrFilter || latencySort ? 0 : offset,
  });

  let models = applyCategoryFilter(applyAttributeFilters(data.models, filters), category);
  let latencyScope: string | undefined;
  if (latencySort) {
    const telemetry = await getRecentEndpointTelemetry({ limit: 500 });
    models = sortModelsByLatency(models, latestP95ByModel(telemetry));
    latencyScope = ACTIVE_PROBE_SCOPE_NOTE;
  }
  const total = hasAttrFilter || (category && category !== 'all') || latencySort ? models.length : data.total;
  const page = hasAttrFilter || latencySort ? models.slice(offset, offset + limit) : models;

  const enriched = enrichModels(page);

  return apiJsonResponse(
    {
      version: 'v1',
      total,
      tier: auth.tier,
      limit,
      offset,
      ...(latencyScope ? { latency_scope: latencyScope } : {}),
      data: enriched,
    },
    auth.rateLimitHeaders
  );
}
