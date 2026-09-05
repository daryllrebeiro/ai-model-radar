import { NextRequest, NextResponse } from 'next/server';
import { getRecentEvents, getActiveAlertRules, getUserWatchlistByEmail } from '@/lib/db/queries';
import { renderDigestHtml, sendEmailDigest } from '@/lib/email/resend';
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

    // Filter email recipients
    const emailRecipients = rules
      .filter((r) => r.type === 'email' && r.destination && r.destination.includes('@'))
      .map((r) => r.destination);

    // De-duplicate recipient emails
    const uniqueEmails = Array.from(new Set(emailRecipients));
    let deliveredCount = 0;

    for (const email of uniqueEmails) {
      const userWatchlist = await getUserWatchlistByEmail(email);

      const html = renderDigestHtml({
        recipientEmail: email,
        recentEvents,
        timeframe,
        watchlistModelIds: userWatchlist,
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
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error(`Digest cron failure: ${error.message}`);
    return NextResponse.json({ success: false, error: 'Digest generation failed' }, { status: 500 });
  }
}
