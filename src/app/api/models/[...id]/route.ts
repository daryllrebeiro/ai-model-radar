import { NextRequest, NextResponse } from 'next/server';
import { getModelDetail } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string[] } }
) {
  try {
    const rawId = Array.isArray(params.id) ? params.id.join('/') : params.id;
    const modelId = decodeURIComponent(rawId);

    const data = await getModelDetail(modelId);
    if (!data) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API /api/models/[...id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch model detail' }, { status: 500 });
  }
}
