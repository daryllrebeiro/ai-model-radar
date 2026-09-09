import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import {
  getShadowFindings,
  setShadowFindingStatus,
} from '@/lib/db/queries';
import { ShadowFindingStatus } from '@/types/governance';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/governance/shadow-ai/[id] — acknowledge or dismiss a finding.
 * Body: { status: "acknowledged" | "dismissed" | "open" } (re-open allowed).
 * Only findings in the caller's personal/team visibility can transition;
 * all other ids share one uniform 404 (no existence oracle).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string | string[] } }
) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'governance');
    if (limited) return limited;

    const idRaw = Array.isArray(params.id) ? params.id[0] : params.id;
    const findingId = Number(idRaw);
    if (!Number.isInteger(findingId) || findingId <= 0) {
      return NextResponse.json({ error: 'Invalid finding id' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const status = body?.status;
    if (status !== 'acknowledged' && status !== 'dismissed' && status !== 'open') {
      return NextResponse.json(
        { error: 'status must be one of acknowledged, dismissed, open' },
        { status: 400 }
      );
    }

    const visible = await getShadowFindings({ email: session.user.email, limit: 500 });
    if (!visible.some((f) => Number(f.id) === findingId)) {
      return NextResponse.json(
        { error: 'Finding not found or not accessible' },
        { status: 404 }
      );
    }

    const updated = await setShadowFindingStatus(
      findingId,
      status as ShadowFindingStatus
    );
    if (!updated) {
      return NextResponse.json(
        { error: 'Finding not found or not accessible' },
        { status: 404 }
      );
    }
    return NextResponse.json({ finding: updated });
  } catch (err: any) {
    return handleApiError(err, 'governance/shadow-ai/:id POST');
  }
}
