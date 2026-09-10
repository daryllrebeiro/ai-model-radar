import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { checkAdminSecret } from '@/lib/admin-auth';
import { listPendingCaseStudies, moderateCaseStudy } from '@/lib/db/queries';
import { trackServerEvent } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

/** GET /api/admin/savings — moderation queue (ADMIN_SECRET). */
export async function GET(request: NextRequest) {
  try {
    const denied = checkAdminSecret(request, 'admin/savings');
    if (denied) return denied;
    const pending = await listPendingCaseStudies(50);
    return NextResponse.json({ pending });
  } catch (err: any) {
    return handleApiError(err, 'admin/savings GET');
  }
}

/** POST /api/admin/savings — { id, decision: approved|rejected|removed } (ADMIN_SECRET). */
export async function POST(request: NextRequest) {
  try {
    const denied = checkAdminSecret(request, 'admin/savings');
    if (denied) return denied;
    const body = await request.json().catch(() => null);
    const id = Number(body?.id);
    const decision = body?.decision;
    if (!Number.isInteger(id) || id <= 0 || !['approved', 'rejected', 'removed'].includes(decision)) {
      return NextResponse.json({ error: 'id and decision (approved|rejected|removed) are required.' }, { status: 400 });
    }
    const study = await moderateCaseStudy(id, decision);
    if (!study) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    trackServerEvent('case_study_moderated');
    return NextResponse.json({ study });
  } catch (err: any) {
    return handleApiError(err, 'admin/savings POST');
  }
}
