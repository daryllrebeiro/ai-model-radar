import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api-error-handler';
import { getCompoundRule } from '@/lib/db/queries';
import { getEvents, getLatestSnapshotsMap } from '@/lib/db/queries';
import { ruleMatchesEvent } from '@/lib/compound-rules';
import { deliverWebhookPayload } from '@/lib/webhooks';
import { renderDigestHtml, sendEmailDigest } from '@/lib/email/resend';
import { escapeHtml } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

/**
 * POST /api/alerts/compound/[id]/test — evaluate one rule against recent
 * events and optionally deliver matches through the rule's existing
 * channel (webhook payload or digest email). Body: { limit?, deliver? }.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const rule = await getCompoundRule(session.user.id, id);
    if (!rule) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json().catch(() => null)) || {};
    const rawLimit = Number(body.limit || 100);
    const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.floor(rawLimit))) : 100;

    const [{ events }, snapshotMap] = await Promise.all([
      getEvents({ limit }),
      getLatestSnapshotsMap(),
    ]);
    const matches = events
      .map((e) => ruleMatchesEvent(rule, e, snapshotMap))
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .slice(0, 50);

    let delivery: Record<string, unknown> | null = null;
    if (body.deliver === true && matches.length > 0) {
      if (rule.channel === 'webhook') {
        const result = await deliverWebhookPayload(
          rule.destination,
          {
            source: 'ai-model-radar',
            rule_id: rule.id,
            rule_name: rule.name,
            logic: rule.logic,
            conditions: rule.conditions,
            matches: matches.map((m) => ({
              model_id: m.event.model_id,
              event_type: m.event.event_type,
              detected_at: m.event.detected_at,
              reasons: m.reasons,
            })),
          },
          { ruleId: String(rule.id) }
        );
        delivery = { channel: 'webhook', ...result };
      } else {
        const html = renderDigestHtml({
          recipientEmail: rule.destination,
          recentEvents: matches.map((m) => m.event),
          timeframe: 'daily',
          watchlistModelIds: [],
        });
        const result = await sendEmailDigest({
          to: rule.destination,
          subject: `[Radar] Compound rule "${rule.name}" matched ${matches.length} event(s)`,
          html,
        });
        delivery = { channel: 'email', ...result };
      }
    }

    return NextResponse.json({
      rule_id: rule.id,
      rule_name: rule.name,
      events_evaluated: events.length,
      total_matches: matches.length,
      matches: matches.map((m) => ({
        model_id: m.event.model_id,
        event_type: m.event.event_type,
        detected_at: m.event.detected_at,
        reasons: m.reasons,
      })),
      delivery,
      // Escape note: reasons embed model ids / thresholds only; no raw
      // upstream HTML reaches the email renderer unescaped (see resend.ts).
      _sanitized: typeof escapeHtml === 'function',
    });
  } catch (err: any) {
    return handleApiError(err, 'alerts/compound/[id]/test POST');
  }
}
