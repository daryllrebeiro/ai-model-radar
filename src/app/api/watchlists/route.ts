import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import {
  getUserWatchlist,
  addToWatchlist,
  removeFromWatchlist,
} from '@/lib/db/queries';
import { handleApiError } from '@/lib/api-error-handler';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ watchlist: [] });
    }

    const items = await getUserWatchlist(session.user.id);
    return NextResponse.json({
      watchlist: items,
      userId: session.user.id,
      email: session.user.email,
    });
  } catch (error: any) {
    return handleApiError(error, 'watchlists GET');
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request);

    if (!session) {
      return NextResponse.json(
        { error: 'Authenticated session is required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { modelId, action } = body;

    if (!modelId) {
      return NextResponse.json({ error: 'modelId is required' }, { status: 400 });
    }

    const user = session.user;

    if (action === 'remove') {
      await removeFromWatchlist(user.id, modelId);
    } else {
      await addToWatchlist(user.id, modelId);
    }

    const updated = await getUserWatchlist(user.id);
    return NextResponse.json({
      success: true,
      action: action === 'remove' ? 'removed' : 'added',
      modelId,
      watchlist: updated,
    });
  } catch (error: any) {
    return handleApiError(error, 'watchlists POST');
  }
}
