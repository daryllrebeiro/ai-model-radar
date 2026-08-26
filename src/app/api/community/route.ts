import { NextResponse } from 'next/server';
import { fetchHuggingFaceTrending } from '@/lib/ingestion/huggingface';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
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
