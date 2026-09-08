import { NextRequest, NextResponse } from 'next/server';
import { getMarketStats } from '@/lib/db/queries';
import { validatePublicApiRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Public read surface: allow anonymous but throttle per key/IP.
    const auth = await validatePublicApiRequest(request);
    if (!auth.allowed && auth.errorResponse) {
      return auth.errorResponse;
    }

    const stats = await getMarketStats();
    return NextResponse.json(stats);
  } catch (error: any) {
    console.error('API /api/stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch market stats' }, { status: 500 });
  }
}
