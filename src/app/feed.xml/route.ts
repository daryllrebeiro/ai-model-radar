import { NextResponse } from 'next/server';
import { getEvents } from '@/lib/db/queries';
import { getEventSummary } from '@/lib/utils';
import { escapeXml } from '@/lib/sanitize';
import { baseUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { events } = await getEvents({ limit: 50 });
    const siteUrl = baseUrl();

    const itemsXml = events
      .map((e) => {
        const summary = getEventSummary(e);
        const link = `${siteUrl}/models/${encodeURIComponent(e.model_id)}`;
        const pubDate = new Date(e.detected_at).toUTCString();
        const safeGuid = escapeXml(`${e.model_id}-${e.detected_at}`);
        const safeCategory = escapeXml(e.event_type);
        const safeSubtitle = escapeXml(summary.subtitle);
        const safeEventType = escapeXml(e.event_type);
        const safeProvider = escapeXml(e.provider || 'OpenRouter');

        return `
    <item>
      <title><![CDATA[${summary.title}]]></title>
      <link>${link}</link>
      <guid isPermaLink="false">${safeGuid}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${safeSubtitle} | Event: ${safeEventType} | Provider: ${safeProvider}]]></description>
      <category>${safeCategory}</category>
    </item>`;
      })
      .join('');

    const rssXml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AI Model Radar — Market Changelog &amp; Price Drops</title>
    <link>${siteUrl}</link>
    <description>Real-time changelog of AI model price cuts, free tier additions, context updates, and new releases across providers.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml" />
    ${itemsXml}
  </channel>
</rss>`;

    return new NextResponse(rssXml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 's-maxage=300, stale-while-revalidate',
      },
    });
  } catch (error: any) {
    console.error('RSS generation error:', error);
    return new NextResponse('<error>Failed to generate RSS feed</error>', { status: 500 });
  }
}
