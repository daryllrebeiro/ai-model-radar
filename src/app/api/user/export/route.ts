import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { exportUserData, getUserByEmail } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    let userId = session?.user?.id;

    if (!userId) {
      const email = request.nextUrl.searchParams.get('email');
      if (email) {
        const user = await getUserByEmail(email);
        userId = user?.id;
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required to export account data' },
        { status: 401 }
      );
    }

    const exportBundle = await exportUserData(userId);
    if (!exportBundle) {
      return NextResponse.json({ error: 'User record not found' }, { status: 404 });
    }

    return NextResponse.json(exportBundle, {
      headers: {
        'Content-Disposition': `attachment; filename="ai-model-radar-data-export-${userId}.json"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
