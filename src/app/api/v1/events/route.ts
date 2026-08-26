import { NextRequest } from 'next/server';
import { getEvents } from '@/lib/db/queries';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { eventsQuerySchema } from '@/lib/validation/api-schemas';
import { EventType } from '@/types/events';

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

  const parsed = eventsQuerySchema.safeParse(rawParams);
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

  const { types, type, provider, free, q, cursor, limit, offset } = parsed.data;

  const eventTypesParam = types || type;
  const eventTypes = eventTypesParam
    ? (eventTypesParam.split(',') as EventType[])
    : undefined;

  const data = await getEvents({
    eventTypes,
    provider,
    isFree: free,
    search: q,
    cursor,
    limit,
    offset,
  });

  return apiJsonResponse(
    {
      version: 'v1',
      total: data.total,
      has_more: data.hasMore,
      next_cursor: data.nextCursor || null,
      tier: auth.tier,
      limit,
      offset,
      data: data.events,
    },
    auth.rateLimitHeaders
  );
}
