import { NextRequest } from 'next/server';
import { RAW_BENCHMARK_DATA } from '@/lib/benchmarks';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { benchmarksQuerySchema } from '@/lib/validation/api-schemas';

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

  const parsed = benchmarksQuerySchema.safeParse(rawParams);
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

  const { provider } = parsed.data;

  let data = RAW_BENCHMARK_DATA;
  if (provider && provider !== 'All') {
    data = data.filter((d) => d.provider.toLowerCase() === provider.toLowerCase());
  }

  return apiJsonResponse(
    {
      version: 'v1',
      total: data.length,
      tier: auth.tier,
      methodology: 'Verified unsynthesized evaluation records',
      data,
    },
    auth.rateLimitHeaders
  );
}
