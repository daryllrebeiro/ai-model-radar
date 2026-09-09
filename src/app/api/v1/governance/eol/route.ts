import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import {
  getEolRegistry,
  registerEol,
  deleteEol,
  getLatestSnapshotsMap,
  getEvents,
} from '@/lib/db/queries';
import { buildEolReport } from '@/lib/eol';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/governance/eol — retirement countdowns for registered models
 * merged with removals actually observed in the event stream.
 */
export async function GET(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'governance');
    if (limited) return limited;

    const [registry, removals] = await Promise.all([
      getEolRegistry(),
      getEvents({ eventTypes: ['MODEL_REMOVED'], limit: 200 }),
    ]);
    const entries = buildEolReport(registry, removals.events);
    const counts = {
      active: entries.filter((e) => e.status === 'active').length,
      approaching: entries.filter((e) => e.status === 'approaching').length,
      expired: entries.filter((e) => e.status === 'expired').length,
      removed: entries.filter((e) => e.status === 'removed').length,
    };
    return NextResponse.json({ entries, count: entries.length, counts });
  } catch (err: any) {
    return handleApiError(err, 'governance/eol GET');
  }
}

/**
 * POST /api/v1/governance/eol — register (or re-announce) a retirement date.
 * Body: { model_id, eol_at (ISO), announced_at?, source?, notes? }.
 * Unknown-to-catalog models are accepted with catalog_match: false (warn,
 * don't block — delisted models leave the current view).
 */
export async function POST(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'governance');
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const modelId = typeof body?.model_id === 'string' ? body.model_id.trim() : '';
    if (!modelId) {
      return NextResponse.json({ error: 'model_id is required' }, { status: 400 });
    }
    if (typeof body?.eol_at !== 'string' || !Number.isFinite(new Date(body.eol_at).getTime())) {
      return NextResponse.json({ error: 'eol_at must be a valid ISO date' }, { status: 400 });
    }

    let entry;
    try {
      entry = await registerEol({
        model_id: modelId.slice(0, 500),
        eol_at: body.eol_at,
        announced_at: typeof body?.announced_at === 'string' ? body.announced_at : undefined,
        source: typeof body?.source === 'string' ? body.source : null,
        notes: typeof body?.notes === 'string' ? body.notes : null,
        created_by_email: session.user.email,
      });
    } catch (validationErr) {
      return NextResponse.json(
        { error: validationErr instanceof Error ? validationErr.message : 'Invalid EOL registration' },
        { status: 400 }
      );
    }

    const snapshots = await getLatestSnapshotsMap();
    const catalogMatch = [...snapshots.keys()].some(
      (id) => id.toLowerCase() === modelId.toLowerCase()
    );
    return NextResponse.json({ entry, catalog_match: catalogMatch }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'governance/eol POST');
  }
}

/**
 * DELETE /api/v1/governance/eol — remove a registration.
 * Body: { model_id }. Unknown ids are 404 (no oracle concern: registry is
 * caller-visible via GET).
 */
export async function DELETE(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'governance');
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const modelId = typeof body?.model_id === 'string' ? body.model_id.trim() : '';
    if (!modelId) {
      return NextResponse.json({ error: 'model_id is required' }, { status: 400 });
    }
    const removed = await deleteEol(modelId);
    if (!removed) {
      return NextResponse.json({ error: 'EOL registration not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: modelId });
  } catch (err: any) {
    return handleApiError(err, 'governance/eol DELETE');
  }
}
