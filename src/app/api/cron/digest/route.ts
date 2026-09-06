import { NextRequest, NextResponse } from 'next/server';
import { getRecentEvents, getActiveAlertRules, getUserWatchlistByEmail, getLatestSnapshotsMap, getEvents, getUsageProfileByEmail } from '@/lib/db/queries';
import { renderDigestHtml, sendEmailDigest } from '@/lib/email/resend';
import { getPriceDropForecasts } from '@/lib/forecast';
import { detectMarketSignals } from '@/lib/signals';
import { maxMonthlySavingsForProfile } from '@/lib/recommendation';
import { buildMarketBrief } from '@/lib/briefs';
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

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
    let deliveredCount = 0;

    for (const email of uniqueEmails) {
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

      const html = renderDigestHtml({
        recipientEmail: email,
        recentEvents,
        timeframe,
        watchlistModelIds: userWatchlist,
        forecasts,
        savings,
        briefs: [brief],
      });

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
      deliveredCount,
      briefsDelivered: deliveredCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error(`Digest cron failure: ${error.message}`);
    return NextResponse.json({ success: false, error: 'Digest generation failed' }, { status: 500 });
  }
}
