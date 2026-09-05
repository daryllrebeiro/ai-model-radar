import { NextRequest } from 'next/server';
import { getModelDetail } from '@/lib/db/queries';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string[] } }
) {
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }

  const modelId = Array.isArray(params.id)
    ? decodeURIComponent(params.id.join('/'))
    : params.id;

  const detail = await getModelDetail(modelId);

  if (!detail) {
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
      data: detail,
    },
    auth.rateLimitHeaders
  );
}
