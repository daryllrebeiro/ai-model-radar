import { NextRequest } from 'next/server';
import { getModelCurrentList } from '@/lib/db/queries';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { modelsQuerySchema } from '@/lib/validation/api-schemas';
import { findCapabilityForModel } from '@/lib/capabilities';
import { findLicenseForModel } from '@/lib/licenses';

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
  const toolCalling = (parsed.data as any).tool_calling as boolean | undefined;
  const vision = (parsed.data as any).vision as boolean | undefined;
  const commercial = (parsed.data as any).commercial as boolean | undefined;
  const hasAttrFilter = toolCalling !== undefined || vision !== undefined || commercial !== undefined;

  // Attribute filters join sourced static datasets (R3/R4) — no DB column.
  // When present, read a bounded window (500 = catalog cap) then filter +
  // paginate in Node so `total` reflects the filtered set.
  const data = await getModelCurrentList({
    search: q,
    provider,
    isFree: free,
    sortBy: sortBy as any,
    limit: hasAttrFilter ? 500 : limit,
    offset: hasAttrFilter ? 0 : offset,
  });

  let models = data.models;
  if (hasAttrFilter) {
    models = models.filter((m) => {
      if (toolCalling !== undefined && findCapabilityForModel(m.model_id)?.tool_calling !== toolCalling) return false;
      if (vision !== undefined && findCapabilityForModel(m.model_id)?.vision !== vision) return false;
      if (commercial !== undefined && (findLicenseForModel(m.model_id)?.commercial_use_allowed === true) !== commercial) return false;
      return true;
    });
  }
  const total = hasAttrFilter ? models.length : data.total;
  const page = hasAttrFilter ? models.slice(offset, offset + limit) : models;

  const enriched = page.map((m) => ({
    ...m,
    capabilities: findCapabilityForModel(m.model_id),
    license: findLicenseForModel(m.model_id),
  }));

  return apiJsonResponse(
    {
      version: 'v1',
      total,
      tier: auth.tier,
      limit,
      offset,
      data: enriched,
    },
    auth.rateLimitHeaders
  );
}
