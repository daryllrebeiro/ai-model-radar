import { NextRequest } from 'next/server';
import { getEvents, getLatestSnapshotsMap } from '@/lib/db/queries';
import { validatePublicApiRequest } from '@/lib/api-auth';
import { requireFeature } from '@/lib/access-guard';

export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 5000;
const KEEPALIVE_MS = 15000;

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * GET /api/v1/stream
 *
 * (Enterprise, REALTIME_STREAM) Server-Sent Events feed of market events.
 * Emits an initial `snapshot` with recent events + model count, then live
 * `event` pushes as new market events land, plus a periodic keep-alive.
 */
export async function GET(request: NextRequest) {
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }

  const guard = await requireFeature(request, 'REALTIME_STREAM');
  if (guard.error) {
    return guard.error;
  }

  const encoder = new TextEncoder();
  const controller = new AbortController();
  const signal = controller.signal;

  request.signal.addEventListener(
    'abort',
    () => {
      controller.abort();
    },
    { once: true }
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      let lastSeenEventId = 0;
      let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;

      const send = (chunk: string) => {
        try {
          streamController.enqueue(encoder.encode(chunk));
        } catch {
          /* stream closed */
        }
      };

      try {
        // Initial snapshot: recent events + market scope
        const [eventsRes, snapshotsMap] = await Promise.all([
          getEvents({ limit: 100 }),
          getLatestSnapshotsMap(),
        ]);
        const initialEvents = [...eventsRes.events].reverse();
        lastSeenEventId = initialEvents.reduce((max, e) => Math.max(max, e.id || 0), 0);

        send(sseEvent('snapshot', {
          connectedAt: new Date().toISOString(),
          modelCount: snapshotsMap.size,
          sinceEventId: lastSeenEventId,
          initialEvents,
        }));

        // Live polling loop
        pollTimer = setInterval(async () => {
          try {
            if (signal.aborted) {
              if (pollTimer) clearInterval(pollTimer);
              return;
            }
            const res = await getEvents({ limit: 100 });
            const fresh = res.events
              .filter((e) => (e.id || 0) > lastSeenEventId)
              .sort((a, b) => (a.id || 0) - (b.id || 0));
            if (fresh.length > 0) {
              const maxId = Math.max(...fresh.map((e) => e.id || 0));
              lastSeenEventId = Math.max(lastSeenEventId, maxId);
              for (const event of fresh) {
                send(sseEvent('event', event));
              }
            }
          } catch {
            // polling error — keep the connection alive
          }
        }, POLL_INTERVAL_MS);

        // Keep-alive comment flush to prevent idle proxy timeouts
        keepAliveTimer = setInterval(() => {
          try {
            streamController.enqueue(encoder.encode(': keep-alive\n\n'));
          } catch {
            if (pollTimer) clearInterval(pollTimer);
            if (keepAliveTimer) clearInterval(keepAliveTimer);
          }
        }, KEEPALIVE_MS);

        signal.addEventListener(
          'abort',
          () => {
            if (pollTimer) clearInterval(pollTimer);
            if (keepAliveTimer) clearInterval(keepAliveTimer);
          },
          { once: true }
        );
      } catch {
        send(sseEvent('error', { error: 'failed to initialize stream' }));
        streamController.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}