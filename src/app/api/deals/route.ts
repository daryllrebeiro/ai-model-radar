import { NextResponse } from 'next/server';
import { getDealsData } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getDealsData();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API /api/deals error:', error);
    return NextResponse.json({ error: 'Failed to fetch deals data' }, { status: 500 });
  }
}
