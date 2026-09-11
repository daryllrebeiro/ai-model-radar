import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api-error-handler';
import {
  getExportConnectorForRun,
  markConnectorRun,
} from '@/lib/db/queries';
import { getEvents } from '@/lib/db/queries';
import { runExportConnector, DATADOG_DEFAULT_URL } from '@/lib/export-connectors';
import { enqueueDlqDelivery } from '@/lib/db/queries';
import { trackServerEvent } from '@/lib/analytics';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function connectorId(params: { id: string }): number | null {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * POST /api/exports/[id]/run — push recent price-change events through the
 * caller's own connector. Body: { limit? }. Reuses the public event stream
 * as the data source; this is pre-built delivery, not new backend data.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const id = connectorId(params);
    if (id === null) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const connector = await getExportConnectorForRun(session.user.id, id);
    if (!connector || !connector.active) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = (await request.json().catch(() => null)) || {};
    const rawLimit = Number(body.limit || 20);
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 20;

    const { events } = await getEvents({
      eventTypes: ['PRICE_CHANGE', 'BECAME_FREE', 'NEW_MODEL'],
      limit,
    });
    const result = await runExportConnector({
      type: connector.type,
      destinationUrl: connector.destination_url,
      secret: connector.secret || undefined,
      events,
    });
    await markConnectorRun(id, result.success ? 'success' : 'failed');
    // P2 DLQ coverage: terminal export failures park for manual redrive
    // (same queue as webhooks, namespaced rule id). Never fails the run.
    let dlqId: number | null = null;
    if (!result.success) {
      try {
        const parked = await enqueueDlqDelivery({
          delivery_id: `export-${id}-${Date.now().toString(36)}`,
          rule_id: `export:${id}`,
          destination_url: connector.destination_url || (connector.type === 'datadog' ? DATADOG_DEFAULT_URL : ''),
          payload: JSON.stringify({
            connector_id: id,
            connector_type: connector.type,
            events_attempted: events.length,
            events_pushed: result.pushed,
            error: result.error || 'unknown',
          }).slice(0, 20000),
          last_error: result.error || 'export failed',
        });
        dlqId = parked.id ?? null;
      } catch (dlqErr) {
        logger.warn('Export DLQ enqueue failed:', { error: String(dlqErr) });
      }
    }
    if (result.success) trackServerEvent('export_connector_run');
    return NextResponse.json({ connector_id: id, type: connector.type, dlq_id: dlqId, ...result });
  } catch (err: any) {
    return handleApiError(err, 'exports/[id]/run POST');
  }
}

