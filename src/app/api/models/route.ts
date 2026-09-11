import { NextRequest, NextResponse } from 'next/server';
import { getModelCurrentList } from '@/lib/db/queries';
import { validatePublicApiRequest } from '@/lib/api-auth';
import { applyAttributeFilters, enrichModels, hasAttributeFilters } from '@/lib/catalog-enrichment';

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
    // R3/R4 attribute filters (same semantics as the v1 twin, one shared helper).
    const want = (v: string | null) => (v === null ? undefined : v === 'true');
    const filters = {
      toolCalling: want(searchParams.get('tool_calling')),
      vision: want(searchParams.get('vision')),
      commercial: want(searchParams.get('commercial')),
    };
    const hasAttrFilter = hasAttributeFilters(filters);

    const data = await getModelCurrentList({
      search,
      provider,
      isFree,
      sortBy,
      sortOrder,
      limit: hasAttrFilter ? 500 : limit,
      offset: hasAttrFilter ? 0 : offset,
    });

    const models = applyAttributeFilters(data.models, filters);
    const total = hasAttrFilter ? models.length : data.total;
    const page = hasAttrFilter ? models.slice(offset, offset + limit) : models;

    return NextResponse.json({ models: enrichModels(page), total });
  } catch (error: any) {
    console.error('API /api/models error:', error);
    return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 });
  }
}
