import { NextRequest } from 'next/server';
import { queryCatalog, getRecentEndpointTelemetry } from '@/lib/db/queries';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { modelsQuerySchema } from '@/lib/validation/api-schemas';
import { enrichModels, latestP95ByModel } from '@/lib/catalog-enrichment';

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
  const latencySort = sortBy === 'latency';
  const { models, total, latencyScope } = await queryCatalog({
    search: q,
    provider,
    isFree: free,
    sortBy: sortBy as any,
    limit,
    offset,
    filters,
    category,
    ...(latencySort
      ? {
          fetchLatencyP95: async () =>
            latestP95ByModel(await getRecentEndpointTelemetry({ limit: 500 })),
        }
      : {}),
  });

  const enriched = enrichModels(models);

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
