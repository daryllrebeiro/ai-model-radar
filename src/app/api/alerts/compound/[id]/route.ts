import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api-error-handler';
import { getCompoundRule, updateCompoundRule, deleteCompoundRule } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

function ruleId(params: { id: string }): number | null {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** GET /api/alerts/compound/[id] — own rule only. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const id = ruleId(params);
    if (id === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const rule = await getCompoundRule(session.user.id, id);
    if (!rule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ rule });
  } catch (err: any) {
    return handleApiError(err, 'alerts/compound/[id] GET');
  }
}

/** PATCH /api/alerts/compound/[id] — name/destination/active only (conditions are immutable). */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const id = ruleId(params);
    if (id === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const body = await request.json().catch(() => null);
    const patch: { name?: string; active?: boolean; destination?: string } = {};
    if (typeof body?.name === 'string') patch.name = body.name;
    if (typeof body?.active === 'boolean') patch.active = body.active;
    if (typeof body?.destination === 'string') patch.destination = body.destination;
    const rule = await updateCompoundRule(session.user.id, id, patch);
    if (!rule) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ rule });
  } catch (err: any) {
    return handleApiError(err, 'alerts/compound/[id] PATCH');
  }
}

/** DELETE /api/alerts/compound/[id] — own rule only. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const id = ruleId(params);
    if (id === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const ok = await deleteCompoundRule(session.user.id, id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleApiError(err, 'alerts/compound/[id] DELETE');
  }
}
