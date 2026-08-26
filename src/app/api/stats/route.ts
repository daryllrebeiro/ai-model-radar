import { NextResponse } from 'next/server';
import { getMarketStats } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stats = await getMarketStats();
    return NextResponse.json(stats);
  } catch (error: any) {
    console.error('API /api/stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch market stats' }, { status: 500 });
  }
}
