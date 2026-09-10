import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api-error-handler';
import { takedownCaseStudy } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/** DELETE /api/savings/[id] — owner takedown of their own submission. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const ok = await takedownCaseStudy(session.user.id, id);
    if (!ok) return NextResponse.json({ error: 'Not found or already removed' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleApiError(err, 'savings/[id] DELETE');
  }
}
