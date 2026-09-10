import { NextRequest, NextResponse } from 'next/server';
import { getModelCurrentList } from '@/lib/db/queries';
import { validatePublicApiRequest } from '@/lib/api-auth';
import { findCapabilityForModel } from '@/lib/capabilities';
import { findLicenseForModel } from '@/lib/licenses';

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
    // R3/R4 attribute filters (same semantics as the v1 twin).
    const toolCalling = searchParams.get('tool_calling');
    const vision = searchParams.get('vision');
    const commercial = searchParams.get('commercial');
    const hasAttrFilter = toolCalling !== null || vision !== null || commercial !== null;

    const data = await getModelCurrentList({
      search,
      provider,
      isFree,
      sortBy,
      sortOrder,
      limit: hasAttrFilter ? 500 : limit,
      offset: hasAttrFilter ? 0 : offset,
    });

    let models = data.models;
    if (hasAttrFilter) {
      const want = (v: string | null) => (v === null ? undefined : v === 'true');
      const wantTool = want(toolCalling);
      const wantVision = want(vision);
      const wantCommercial = want(commercial);
      models = models.filter((m) => {
        if (wantTool !== undefined && findCapabilityForModel(m.model_id)?.tool_calling !== wantTool) return false;
        if (wantVision !== undefined && findCapabilityForModel(m.model_id)?.vision !== wantVision) return false;
        if (wantCommercial !== undefined && (findLicenseForModel(m.model_id)?.commercial_use_allowed === true) !== wantCommercial) return false;
        return true;
      });
    }
    const total = hasAttrFilter ? models.length : data.total;
    const page = hasAttrFilter ? models.slice(offset, offset + limit) : models;

    return NextResponse.json({
      models: page.map((m) => ({
        ...m,
        capabilities: findCapabilityForModel(m.model_id),
        license: findLicenseForModel(m.model_id),
      })),
      total,
    });
  } catch (error: any) {
    console.error('API /api/models error:', error);
    return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 });
  }
}
