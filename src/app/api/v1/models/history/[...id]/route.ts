import { NextRequest } from 'next/server';
import { getModelPriceHistory, isHistoryRange, HistoryRange } from '@/lib/db/queries';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { requireFeature } from '@/lib/access-guard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/models/history/:modelId?range=7d
 *
 * Time-series price history + event annotations for a single model.
 * Pro feature (PRICE_HISTORY_CHARTS), gated via requireFeature.
 * range: 7d | 30d | 90d | 1y | all (default: all)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string[] } }
) {
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }

  const guard = await requireFeature(request, 'PRICE_HISTORY_CHARTS');
  if (guard.error) {
    return guard.error;
  }

  const modelId = Array.isArray(params.id)
    ? decodeURIComponent(params.id.join('/'))
    : params.id;

  const rawRange = request.nextUrl.searchParams.get('range');
  const range: HistoryRange = isHistoryRange(rawRange) ? rawRange : 'all';

  const data = await getModelPriceHistory(modelId, range);

  if (!data) {
    return apiJsonResponse(
      { error: 'Model not found', model_id: modelId },
      auth.rateLimitHeaders,
      404
    );
  }

  return apiJsonResponse(
    {
      version: 'v1',
      model_id: modelId,
      range,
      data,
    },
    auth.rateLimitHeaders
  );
}