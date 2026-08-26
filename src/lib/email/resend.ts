import crypto from 'crypto';
import { ModelEvent } from '@/types/events';
import { logger } from '../logger';

const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || 'amr_unsubscribe_secret_default';

/**
 * Generates an HMAC-SHA256 unsubscribe token for an email address
 */
export function generateUnsubscribeToken(email: string): string {
  return crypto
    .createHmac('sha256', UNSUBSCRIBE_SECRET)
    .update(email.toLowerCase().trim())
    .digest('hex');
}

/**
 * Verifies an unsubscribe token
 */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = generateUnsubscribeToken(email);
  return (
    expected.length === token.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  );
}

export interface DigestContentOptions {
  recipientEmail: string;
  recentEvents: ModelEvent[];
  timeframe: 'daily' | 'weekly';
  watchlistModelIds?: string[];
  baseUrl?: string;
}

/**
 * Renders a responsive HTML email digest with prioritized stack updates
 */
export function renderDigestHtml({
  recipientEmail,
  recentEvents,
  timeframe,
  watchlistModelIds = [],
  baseUrl = 'https://ai-model-radar.com',
}: DigestContentOptions): string {
  const token = generateUnsubscribeToken(recipientEmail);
  const unsubscribeUrl = `${baseUrl}/api/alerts/unsubscribe?email=${encodeURIComponent(
    recipientEmail
  )}&token=${token}`;

  const hasWatchlist = Array.isArray(watchlistModelIds) && watchlistModelIds.length > 0;
  const stackEvents = hasWatchlist
    ? recentEvents.filter((e) => watchlistModelIds.includes(e.model_id))
    : [];

  const priceDrops = recentEvents.filter(
    (e) => (e.event_type === 'PRICE_CHANGE' && (e.pct_change || 0) < 0) || e.event_type === 'BECAME_FREE'
  );
  const newReleases = recentEvents.filter((e) => e.event_type === 'NEW_MODEL');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>AI Model Radar ${timeframe === 'daily' ? 'Daily' : 'Weekly'} Digest</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0B0F17; color: #E5E7EB; margin: 0; padding: 24px; }
    .container { max-width: 600px; margin: 0 auto; background-color: #111827; border: 1px solid #1F2937; border-radius: 12px; overflow: hidden; }
    .header { padding: 24px; background: linear-gradient(to right, #0F172A, #1E1B4B); border-bottom: 1px solid #374151; }
    .title { color: #38BDF8; font-size: 20px; font-weight: bold; margin: 0 0 4px 0; }
    .subtitle { color: #9CA3AF; font-size: 13px; margin: 0; }
    .section { padding: 20px 24px; border-bottom: 1px solid #1F2937; }
    .section-title { font-size: 14px; font-weight: bold; text-transform: uppercase; color: #94A3B8; margin-bottom: 12px; letter-spacing: 0.05em; }
    .event-card { padding: 12px; background-color: #1E293B; border-radius: 8px; margin-bottom: 8px; border: 1px solid #334155; }
    .event-header { display: flex; justify-content: space-between; align-items: center; }
    .model-name { font-weight: bold; color: #F8FAFC; font-size: 14px; }
    .badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: bold; }
    .badge-green { background-color: #064E3B; color: #34D399; border: 1px solid #059669; }
    .badge-cyan { background-color: #082F49; color: #38BDF8; border: 1px solid #0284C7; }
    .footer { padding: 20px 24px; text-align: center; font-size: 12px; color: #6B7280; }
    .footer a { color: #38BDF8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">⚡ AI Model Radar</div>
      <div class="subtitle">${timeframe === 'daily' ? 'Daily Market Intelligence' : 'Weekly Intelligence Summary'} &bull; ${new Date().toLocaleDateString()}</div>
    </div>

    ${
      stackEvents.length > 0
        ? `
    <div class="section" style="background-color: #0C1A30; border-left: 4px solid #38BDF8;">
      <div class="section-title" style="color: #38BDF8;">⚡ Updates To Your Stack (${stackEvents.length})</div>
      ${stackEvents
        .slice(0, 8)
        .map(
          (e) => `
        <div class="event-card" style="background-color: #16243E; border-color: #1E3A8A;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="model-name" style="color: #60A5FA;">${e.model_name || e.model_id}</div>
            <span style="font-size: 10px; font-family: monospace; background-color: #1E3A8A; color: #93C5FD; padding: 2px 6px; border-radius: 4px;">WATCHLIST</span>
          </div>
          <div style="font-size: 12px; color: #93C5FD; margin-top: 4px;">
            ${
              e.event_type === 'PRICE_CHANGE'
                ? e.pct_change && e.pct_change < 0
                  ? `${Math.abs(Math.round(e.pct_change))}% price cut`
                  : `Price updated (${e.pct_change ? `${e.pct_change > 0 ? '+' : ''}${e.pct_change}%` : 'modified'})`
                : e.event_type === 'BECAME_FREE'
                ? 'Model is now 100% FREE'
                : e.event_type === 'CONTEXT_CHANGED'
                ? 'Context window updated'
                : 'Market update detected'
            } &bull; Provider: ${e.provider || 'AI Hub'}
          </div>
        </div>`
        )
        .join('')}
    </div>`
        : ''
    }

    ${
      priceDrops.length > 0
        ? `
    <div class="section">
      <div class="section-title">📉 Top Price Drops</div>
      ${priceDrops
        .slice(0, 5)
        .map(
          (e) => `
        <div class="event-card">
          <div class="model-name">${e.model_name || e.model_id}</div>
          <div style="font-size: 12px; color: #34D399; margin-top: 4px;">
            ${e.pct_change ? `${Math.abs(Math.round(e.pct_change))}% price cut` : 'Price dropped to free'} &bull; Provider: ${e.provider || 'AI Hub'}
          </div>
        </div>`
        )
        .join('')}
    </div>`
        : ''
    }

    ${
      newReleases.length > 0
        ? `
    <div class="section">
      <div class="section-title">✨ New Model Releases</div>
      ${newReleases
        .slice(0, 5)
        .map(
          (e) => `
        <div class="event-card">
          <div class="model-name">${e.model_name || e.model_id}</div>
          <div style="font-size: 12px; color: #94A3B8; margin-top: 4px;">Provider: ${e.provider || 'AI Hub'} &bull; Newly tracked model</div>
        </div>`
        )
        .join('')}
    </div>`
        : ''
    }

    <div class="footer">
      <p>You received this digest because you are subscribed to AI Model Radar alerts.</p>
      <p><a href="${unsubscribeUrl}">One-click Unsubscribe</a> &bull; <a href="${baseUrl}">View Live Radar Dashboard</a></p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Dispatches an email using Resend API or mock driver in test
 */
export async function sendEmailDigest(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (resendApiKey && resendApiKey.startsWith('re_')) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'AI Model Radar <alerts@ai-model-radar.com>',
          to: [params.to],
          subject: params.subject,
          html: params.html,
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        return { success: false, error: `Resend HTTP ${res.status}: ${errorBody}` };
      }

      const data = await res.json();
      return { success: true, id: data.id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // Mock send for dev/test
  logger.info(`[Mock Resend] Dispatched digest email to ${params.to}: "${params.subject}"`);
  return { success: true, id: `mock_email_${Date.now()}` };
}
