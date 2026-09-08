import { NextRequest, NextResponse } from 'next/server';
import { fetchHuggingFaceTrending } from '@/lib/ingestion/huggingface';
import { validatePublicApiRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Throttle per key/IP: each call fans out to Hugging Face upstream.
    const auth = await validatePublicApiRequest(request);
    if (!auth.allowed && auth.errorResponse) {
      return auth.errorResponse;
    }

    const models = await fetchHuggingFaceTrending(50);
    return NextResponse.json({
      source: 'Hugging Face Hub',
      total: models.length,
      models,
    });
  } catch (error: any) {
    console.error('API /api/community error:', error);
    return NextResponse.json({ error: 'Failed to fetch community models' }, { status: 500 });
  }
}
