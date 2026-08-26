import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import {
  getUserWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  createOrGetUser,
} from '@/lib/db/queries';

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    const body = await request.json();
    const { modelId, action, email } = body;

    if (!modelId) {
      return NextResponse.json({ error: 'modelId is required' }, { status: 400 });
    }

    let user = session?.user;
    if (!user && email) {
      user = await createOrGetUser({ email });
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Authenticated session or user email is required' },
        { status: 401 }
      );
    }

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
