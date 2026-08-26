import { NextRequest } from 'next/server';
import { getModelCurrentList } from '@/lib/db/queries';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { modelsQuerySchema } from '@/lib/validation/api-schemas';

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

  const data = await getModelCurrentList({
    search: q,
    provider,
    isFree: free,
    sortBy: sortBy as any,
    limit,
    offset,
  });

  return apiJsonResponse(
    {
      version: 'v1',
      total: data.total,
      tier: auth.tier,
      limit,
      offset,
      data: data.models,
    },
    auth.rateLimitHeaders
  );
}
