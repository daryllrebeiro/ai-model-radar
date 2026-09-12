import { NextRequest, NextResponse } from 'next/server';
import { queryCatalog, getRecentEndpointTelemetry } from '@/lib/db/queries';
import { validatePublicApiRequest } from '@/lib/api-auth';
import { enrichModels, latestP95ByModel } from '@/lib/catalog-enrichment';

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
      hipaaEligible: want(searchParams.get('hipaa_eligible')),
      euResidency: want(searchParams.get('eu_residency')),
    };
    const category = searchParams.get('category') || 'all';

    // Single shared query path with the v1 twin (queryCatalog) — no third copy.
    const { models, total, latencyScope } = await queryCatalog({
      search,
      provider,
      isFree,
      sortBy,
      sortOrder,
      limit,
      offset,
      filters,
      category,
      ...(sortBy === 'latency'
        ? {
            fetchLatencyP95: async () =>
              latestP95ByModel(await getRecentEndpointTelemetry({ limit: 500 })),
          }
        : {}),
    });

    // P3 (ADR-4 freeze re-affirmed): the legacy surface is frozen — every
    // response carries machine-readable sunset headers pointing at v1.
    const res = NextResponse.json({
      models: enrichModels(models),
      total,
      ...(latencyScope ? { latency_scope: latencyScope } : {}),
    });
    res.headers.set('Deprecation', 'true');
    res.headers.set('Sunset', 'Wed, 01 Jul 2026 00:00:00 GMT');
    res.headers.set('Link', '</api/v1/models>; rel="successor-version"');
    return res;
  } catch (error: any) {
    console.error('API /api/models error:', error);
    return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 });
  }
}
