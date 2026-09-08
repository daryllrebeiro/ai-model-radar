import { NextRequest, NextResponse } from 'next/server';
import { getModelCurrentList } from '@/lib/db/queries';
import { validatePublicApiRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Same key/IP rate limiting as the v1 twin: this legacy route was
    // reachable with no auth and no throttle (proven: 70 rapid hits, 0 429s).
    const auth = await validatePublicApiRequest(request);
    if (!auth.allowed && auth.errorResponse) {
      return auth.errorResponse;
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('q') || undefined;
    const provider = searchParams.get('provider') || undefined;
    const isFree = searchParams.get('free') === 'true';
    const sortBy = (searchParams.get('sortBy') as any) || 'name';
    const sortOrder = (searchParams.get('sortOrder') as any) || 'asc';
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const data = await getModelCurrentList({
      search,
      provider,
      isFree,
      sortBy,
      sortOrder,
      limit,
      offset,
    });

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API /api/models error:', error);
    return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 });
  }
}
