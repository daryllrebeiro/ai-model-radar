import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api-error-handler';
import { getUsageImport, deleteUsageImport } from '@/lib/db/queries';
import { getLatestSnapshotsMap } from '@/lib/db/queries';
import { reconcileUsageImport } from '@/lib/usage-import';
import { trackServerEvent } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

/** GET /api/usage/imports/[id] — own import + "X would have cost $Y" reconciliation. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const record = await getUsageImport(session.user.id, id);
    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const snapshots = Array.from((await getLatestSnapshotsMap()).values());
    const reconciliation = reconcileUsageImport(record.rows, snapshots);
    return NextResponse.json({
      import: {
        id: record.id,
        filename: record.filename,
        source: record.source,
        period_start: record.period_start,
        period_end: record.period_end,
        row_count: record.row_count,
        total_spend_usd: record.total_spend_usd,
        created_at: record.created_at,
      },
      reconciliation,
    });
  } catch (err: any) {
    return handleApiError(err, 'usage/imports/[id] GET');
  }
}

/** DELETE /api/usage/imports/[id] — permanent user-initiated deletion. */
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
    const ok = await deleteUsageImport(session.user.id, id);
    if (!ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    trackServerEvent('usage_import_deleted');
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return handleApiError(err, 'usage/imports/[id] DELETE');
  }
}
