import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/db/queries';
import { getEventSummary } from '@/lib/utils';
import { baseUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { events } = await getEvents({ limit: 50 });
    const siteUrl = baseUrl();

    const feed = {
      version: 'https://jsonfeed.org/version/1.1',
      title: 'AI Model Radar — Market Changelog & Price Drops',
      home_page_url: siteUrl,
      feed_url: `${siteUrl}/api/feed/json`,
      description: 'Real-time changelog of AI model price cuts, free tier additions, and new releases.',
      items: events.map((e) => {
        const summary = getEventSummary(e);
        return {
          id: `${e.model_id}-${e.detected_at}`,
          url: `${siteUrl}/models/${encodeURIComponent(e.model_id)}`,
          title: summary.title,
          content_text: summary.subtitle,
          date_published: new Date(e.detected_at).toISOString(),
          tags: [e.event_type, e.provider || 'OpenRouter'],
          _model_id: e.model_id,
          _pct_change: e.pct_change,
        };
      }),
    };

    return NextResponse.json(feed, {
      headers: {
        'Content-Type': 'application/feed+json; charset=utf-8',
        'Cache-Control': 's-maxage=300, stale-while-revalidate',
      },
    });
  } catch (error: any) {
    console.error('JSON Feed generation error:', error);
    return NextResponse.json({ error: 'Failed to generate feed' }, { status: 500 });
  }
}
