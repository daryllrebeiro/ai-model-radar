import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { exportUserData } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUser(request);

    if (!session) {
      return NextResponse.json(
        { error: 'Authentication required to export account data' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    const exportBundle = await exportUserData(userId);
    if (!exportBundle) {
      return NextResponse.json({ error: 'User record not found' }, { status: 404 });
    }

    return NextResponse.json(exportBundle, {
      headers: {
        'Content-Disposition': `attachment; filename="ai-model-radar-data-export-${userId}.json"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to export user data' }, { status: 500 });
  }
}
