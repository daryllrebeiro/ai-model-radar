import { NextRequest, NextResponse } from 'next/server';
import { getDealsData } from '@/lib/db/queries';
import { validatePublicApiRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Public read surface: allow anonymous but throttle per key/IP.
    const auth = await validatePublicApiRequest(request);
    if (!auth.allowed && auth.errorResponse) {
      return auth.errorResponse;
    }

    const data = await getDealsData();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API /api/deals error:', error);
    return NextResponse.json({ error: 'Failed to fetch deals data' }, { status: 500 });
  }
}
