import { NextRequest, NextResponse } from 'next/server';
import { getEvents } from '@/lib/db/queries';
import { EventType } from '@/types/events';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const eventTypesParam = searchParams.get('types');
    const provider = searchParams.get('provider') || undefined;
    const isFree = searchParams.get('free') === 'true';
    const search = searchParams.get('q') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const eventTypes = eventTypesParam
      ? (eventTypesParam.split(',') as EventType[])
      : undefined;

    const data = await getEvents({
      eventTypes,
      provider,
      isFree,
      search,
      limit,
      offset,
    });

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API /api/events error:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}
