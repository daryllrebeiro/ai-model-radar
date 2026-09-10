import { NextRequest, NextResponse } from 'next/server';
import { getRecentEvents, getActiveAlertRules, getUserWatchlistByEmail, getLatestSnapshotsMap, getEvents, getUsageProfileByEmail, listActiveCompoundRulesByOwnerEmails } from '@/lib/db/queries';
import { renderDigestHtml, sendEmailDigest } from '@/lib/email/resend';
import { evaluateCompoundRules } from '@/lib/compound-rules';
import { escapeHtml } from '@/lib/sanitize';
import { getPriceDropForecasts } from '@/lib/forecast';
import { detectMarketSignals } from '@/lib/signals';
import { maxMonthlySavingsForProfile } from '@/lib/recommendation';
import { buildMarketBrief } from '@/lib/briefs';
import { secretsEqual } from '@/lib/secrets';
import { logAuthDenied } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleDigest(request);
}

export async function POST(request: NextRequest) {
  return handleDigest(request);
}

async function handleDigest(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Fail closed: without a configured CRON_SECRET there is nothing to verify
  // against, so the digest fan-out (per-recipient email sends) must not be
  // remotely triggerable.
  if (!cronSecret || !secretsEqual(authHeader, `Bearer ${cronSecret}`)) {
    logAuthDenied('cron/digest', request, !cronSecret ? 'secret-unset' : 'bad-secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const timeframe = request.nextUrl.searchParams.get('timeframe') === 'weekly' ? 'weekly' : 'daily';
    const limit = timeframe === 'weekly' ? 100 : 25;

    // Fetch recent events
    const recentEvents = await getRecentEvents(limit);
    const rules = await getActiveAlertRules();

    // RadarForecast line for the digest
    const [snapshotsMap, eventsRes] = await Promise.all([
      getLatestSnapshotsMap(),
      getEvents({ limit: 500 }),
    ]);
    const forecasts = getPriceDropForecasts(Array.from(snapshotsMap.values()), eventsRes.events, {
      minProbability: 0.55,
      maxForecasts: 4,
    });

    const snapshots = Array.from(snapshotsMap.values());
    const marketSignals = detectMarketSignals(snapshots, eventsRes.events);
    const riskSignals = marketSignals.filter(
      (s) => s.signal_type === 'MODEL_EOL' || s.signal_type === 'PRICE_DROP_EXPECTED'
    );

    // Filter email recipients
    const emailRecipients = rules
      .filter((r) => r.type === 'email' && r.destination && r.destination.includes('@'))
      .map((r) => r.destination);

    // De-duplicate recipient emails
    const uniqueEmails = Array.from(new Set(emailRecipients));
    // Bound the fan-out: one cron tick sends to at most MAX_DIGEST_RECIPIENTS
    // recipients. Without a cap, a mass-created rule set turns this endpoint
    // into an outbound spam relay that also blows the serverless time budget.
    // Overflow is reported (not silently dropped) so ops can raise the cap or
    // shard runs; a future queue worker should carry overflow to next tick.
    const MAX_DIGEST_RECIPIENTS = Math.max(
      1,
      Number(process.env.DIGEST_MAX_RECIPIENTS || 500)
    );
    const batch = uniqueEmails.slice(0, MAX_DIGEST_RECIPIENTS);
    const deferred = uniqueEmails.length - batch.length;
    if (deferred > 0) {
      logger.warn(`Digest fan-out capped: ${deferred} recipients deferred (cap ${MAX_DIGEST_RECIPIENTS}).`);
    }
    let deliveredCount = 0;
    let compoundMatchesDelivered = 0;

    // R6: compound rules evaluate against the same event stream, in the same
    // tick. Email-channel rules owned by batch recipients get a digest
    // section; webhook-channel rules stay on-demand (test endpoint), matching
    // how the existing system delivers webhooks (test/redrive, never cron).
    const compoundByOwner = new Map<string, Array<{ ruleId: number | string; ruleName: string; matches: Array<{ model_id: string; event_type: string; detected_at: string; reasons: string[] }> }>>();
    try {
      const compoundRules = await listActiveCompoundRulesByOwnerEmails(batch);
      if (compoundRules.length > 0) {
        const evaluated = evaluateCompoundRules(
          eventsRes.events,
          compoundRules.map((r) => ({ id: r.id, name: r.name, logic: r.logic, conditions: r.conditions })),
          snapshotsMap
        );
        const nameById = new Map(compoundRules.map((r) => [r.id, { name: r.name, email: r.owner_email }]));
        for (const ev of evaluated) {
          const meta = nameById.get(Number(ev.ruleId));
          if (!meta) continue;
          const key = meta.email.toLowerCase();
          const list = compoundByOwner.get(key) || [];
          list.push({
            ruleId: ev.ruleId,
            ruleName: ev.ruleName,
            matches: ev.matches.slice(0, 5).map((m) => ({
              model_id: m.event.model_id,
              event_type: m.event.event_type,
              detected_at: m.event.detected_at,
              reasons: m.reasons,
            })),
          });
          compoundByOwner.set(key, list);
        }
      }
    } catch (hookErr) {
      // Compound matching must never fail the digest itself.
      logger.warn('Compound-rule digest hook failed:', { error: String(hookErr) });
    }

    for (const email of batch) {
      const userWatchlist = await getUserWatchlistByEmail(email);

      const brief = buildMarketBrief({
        watchlist: [...userWatchlist],
        source: {
          snapshots,
          events: eventsRes.events,
          signals: marketSignals,
          forecasts,
          telemetry: undefined,
        },
      });

      let savings;
      if (timeframe === 'weekly') {
        const profile = await getUsageProfileByEmail(email);
        if (profile) {
          const estimate = maxMonthlySavingsForProfile(
            {
              primary_model_id: profile.primary_model_id,
              monthly_prompt_tokens: profile.monthly_prompt_tokens,
              monthly_comp_tokens: profile.monthly_comp_tokens,
              cache_hit_ratio: profile.cache_hit_ratio,
              batch_discount: profile.batch_discount,
            },
            snapshots,
            riskSignals
          );
          if (estimate.best && estimate.monthly_savings_usd > 0) {
            savings = {
              monthly_usd: estimate.best.monthly_savings_usd,
              model_name: estimate.best.model_name,
              model_id: estimate.best.model_id,
              compare_url: estimate.best.compare_url,
            };
          }
        }
      }

      let html = renderDigestHtml({
        recipientEmail: email,
        recentEvents,
        timeframe,
        watchlistModelIds: userWatchlist,
        forecasts,
        savings,
        briefs: [brief],
      });

      const compoundSections = compoundByOwner.get(email.toLowerCase()) || [];
      if (compoundSections.length > 0) {
        const section = compoundSections
          .map(
            (s) => `
      <div class="section">
        <div class="section-title">Compound rule: ${escapeHtml(s.ruleName)}</div>
        ${s.matches.map((m) => `<div class="event-card"><div class="model-name">${escapeHtml(m.model_id)}</div><div style="font-size:12px;color:#93C5FD;">${escapeHtml(m.event_type)} — ${escapeHtml(m.reasons.join('; '))}</div></div>`).join('')}
      </div>`
          )
          .join('');
        html = html.replace('</body>', `${section}</body>`);
        compoundMatchesDelivered += compoundSections.reduce((n, s) => n + s.matches.length, 0);
      }

      const result = await sendEmailDigest({
        to: email,
        subject: `⚡ AI Model Radar: ${recentEvents.length} New Updates (${timeframe === 'daily' ? 'Daily' : 'Weekly'} Digest)`,
        html,
      });

      if (result.success) {
        deliveredCount++;
      }
    }

    return NextResponse.json({
      success: true,
      timeframe,
      eventsIncluded: recentEvents.length,
      recipientsTargeted: uniqueEmails.length,
      recipientsAttempted: batch.length,
      recipientsDeferred: deferred,
      deliveredCount,
      briefsDelivered: deliveredCount,
      compoundMatchesDelivered,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error(`Digest cron failure: ${error.message}`);
    return NextResponse.json({ success: false, error: 'Digest generation failed' }, { status: 500 });
  }
}

