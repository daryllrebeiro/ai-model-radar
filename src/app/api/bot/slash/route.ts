import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getRecentEvents, getModelCurrentList } from '@/lib/db/queries';
import { computeArbitrageOpportunities } from '@/lib/arbitrage';
import { RAW_BENCHMARK_DATA } from '@/lib/benchmarks';
import { trackEvent } from '@/lib/analytics';
import { globalRateLimiter, logAuthDenied, getClientIp } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const SLACK_TIMESTAMP_TOLERANCE_SEC = 60 * 5;
const BOT_IP_LIMIT = 60;
const BOT_IP_WINDOW_MS = 60 * 1000;

/**
 * Verifies a Slack slash-command request (v0 HMAC over v0:timestamp:body).
 */
function verifySlackSignature(rawBody: string, timestamp: string | null, signature: string | null, secret: string): boolean {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SLACK_TIMESTAMP_TOLERANCE_SEC) return false;
  const expected =
    'v0=' +
    crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Verifies a Discord interaction (Ed25519 over timestamp+body).
 */
function verifyDiscordSignature(
  rawBody: string,
  timestamp: string | null,
  signatureHex: string | null,
  publicKeyHex: string
): boolean {
  if (!timestamp || !signatureHex) return false;
  try {
    const x = Buffer.from(publicKeyHex.replace(/^0x/, ''), 'hex').toString('base64url');
    const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
    return crypto.verify(
      null,
      Buffer.from(timestamp + rawBody),
      key,
      Buffer.from(signatureHex, 'hex')
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Fail closed in production: an unsigned bot endpoint lets anyone burn
    // DB-backed compute and speak in the workspace's trusted bot context.
    const slackSecret = process.env.SLACK_SIGNING_SECRET;
    const discordKey = process.env.DISCORD_PUBLIC_KEY;
    if (process.env.NODE_ENV === 'production' && !slackSecret && !discordKey) {
      return NextResponse.json({ error: 'Bot webhook not configured' }, { status: 503 });
    }
    if (process.env.NODE_ENV !== 'production' && !slackSecret && !discordKey) {
      logger.warn('Bot webhook running WITHOUT platform signatures (non-production only).');
    }

    // Anonymous abuse brake: per-IP bucket shared across bot callers.
    const ip = getClientIp(request);
    const ipCheck = await globalRateLimiter.check(`ip:bot:${ip}`, BOT_IP_LIMIT, BOT_IP_WINDOW_MS);
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: 'Too Many Requests', retry_after_seconds: ipCheck.resetInSec },
        { status: 429, headers: { 'Retry-After': ipCheck.resetInSec.toString() } }
      );
    }

    const contentType = request.headers.get('content-type') || '';
    // Read the raw body once: signature verification needs the exact bytes.
    const rawBody = await request.text();
    let commandText = '';
    let isSlack = false;
    let isDiscord = false;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      // Slack slash command format
      isSlack = true;
      if (slackSecret) {
        const ok = verifySlackSignature(
          rawBody,
          request.headers.get('x-slack-request-timestamp'),
          request.headers.get('x-slack-signature'),
          slackSecret
        );
        if (!ok) {
          logAuthDenied('bot/slash', request, 'bad-slack-signature');
          return NextResponse.json({ error: 'Invalid Slack signature' }, { status: 401 });
        }
      }
      const formData = new URLSearchParams(rawBody);
      commandText = (formData.get('text') || '').trim();
    } else if (contentType.includes('application/json')) {
      // Discord application command or generic webhook
      let body: any;
      try {
        body = JSON.parse(rawBody || '{}');
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
      }

      const looksDiscord = body.type !== undefined || body.data !== undefined;
      if (looksDiscord && discordKey) {
        const ok = verifyDiscordSignature(
          rawBody,
          request.headers.get('x-signature-timestamp'),
          request.headers.get('x-signature-ed25519'),
          discordKey
        );
        if (!ok) {
          logAuthDenied('bot/slash', request, 'bad-discord-signature');
          return NextResponse.json({ error: 'Invalid Discord signature' }, { status: 401 });
        }
      }

      // Discord PING check (type: 1)
      if (body.type === 1) {
        return NextResponse.json({ type: 1 });
      }

      isDiscord = true;

      // Extract command and arguments from Discord options
      if (body.data?.name) {
        const sub = body.data.options?.[0];
        if (sub?.value) {
          commandText = `${body.data.name} ${sub.value}`;
        } else if (sub?.name) {
          const innerOpt = sub.options?.map((o: any) => o.value).join(' ') || '';
          commandText = `${sub.name} ${innerOpt}`.trim();
        } else {
          commandText = body.data.name;
        }
      } else if (body.text || body.command) {
        commandText = (body.text || body.command).trim();
      }
    }

    const parts = commandText.split(/\s+/).filter(Boolean);
    const subCommand = (parts[0] || 'help').toLowerCase();
    const args = parts.slice(1);

    trackEvent('bot_command', {
      platform: isSlack ? 'slack' : isDiscord ? 'discord' : 'webhook',
      subCommand,
    });

    let markdownResponse = '';

    switch (subCommand) {
      case 'compare': {
        if (args.length < 2) {
          markdownResponse = '⚠️ Usage: `/radar compare <model1> <model2>` (e.g. `/radar compare claude-3-7-sonnet deepseek-r1`)';
          break;
        }
        const { models: allModels } = await getModelCurrentList({ limit: 100 });
        const targets = args.slice(0, 3);
        
        let report = `⚖️ **AI Model Comparison**\n\n`;
        for (const t of targets) {
          const m = allModels.find(
            (item) =>
              item.model_id.toLowerCase().includes(t.toLowerCase()) ||
              item.name.toLowerCase().includes(t.toLowerCase())
          );
          if (!m) {
            report += `• **${t}**: Model not found in radar registry\n`;
            continue;
          }
          const pPrompt = m.price_prompt !== null ? `$${(m.price_prompt * 1_000_000).toFixed(2)}/1M` : (m.is_free ? 'FREE' : '—');
          const pComp = m.price_completion !== null ? `$${(m.price_completion * 1_000_000).toFixed(2)}/1M` : (m.is_free ? 'FREE' : '—');
          const ctx = m.context_length ? `${Math.round(m.context_length / 1024)}k` : '128k';
          report += `• **${m.name}** (${m.provider})\n  - Prompt: \`${pPrompt}\` | Completion: \`${pComp}\` | Context: \`${ctx}\`\n`;
        }
        markdownResponse = report.trim();
        break;
      }

      case 'deals':
      case 'arbitrage': {
        const { models: allModels } = await getModelCurrentList({ limit: 100 });
        const clusters = computeArbitrageOpportunities(allModels);

        if (clusters.length === 0) {
          markdownResponse = 'ℹ️ No active cross-provider pricing spreads detected right now.';
          break;
        }

        let report = `💰 **Top Provider Arbitrage Deals**\n\n`;
        for (const c of clusters.slice(0, 5)) {
          const cheap = c.cheapest_option.provider;
          const exp = c.expensive_option.provider;
          const savings = Math.round(c.max_prompt_savings_pct);
          report += `• **${c.display_name}**: Save **${savings}%** via **${cheap}** vs ${exp}\n`;
        }
        markdownResponse = report.trim();
        break;
      }

      case 'price': {
        if (args.length === 0) {
          markdownResponse = '⚠️ Usage: `/radar price <model-id>` (e.g. `/radar price gpt-4o`)';
          break;
        }
        const query = args[0].toLowerCase();
        const { models: allModels } = await getModelCurrentList({ limit: 100 });
        const m = allModels.find(
          (item) =>
            item.model_id.toLowerCase().includes(query) ||
            item.name.toLowerCase().includes(query)
        );

        if (m) {
          const pPrompt = m.price_prompt !== null ? `$${(m.price_prompt * 1_000_000).toFixed(2)} / 1M tokens` : (m.is_free ? 'FREE' : '—');
          const pComp = m.price_completion !== null ? `$${(m.price_completion * 1_000_000).toFixed(2)} / 1M tokens` : (m.is_free ? 'FREE' : '—');
          markdownResponse = `🏷️ **${m.name}** (\`${m.model_id}\`)\n• Provider: **${m.provider}**\n• Input Prompt: \`${pPrompt}\`\n• Output Completion: \`${pComp}\`\n• Context Window: \`${m.context_length ? `${Math.round(m.context_length / 1024)}k` : '128k'}\``;
          break;
        }

        const benchmark = RAW_BENCHMARK_DATA.find(
          (b) =>
            b.model_id.toLowerCase().includes(query) ||
            b.name.toLowerCase().includes(query)
        );

        if (benchmark) {
          const pPrompt = benchmark.pricing_prompt_1m !== undefined ? `$${benchmark.pricing_prompt_1m.toFixed(2)} / 1M tokens` : 'N/A';
          const pComp = benchmark.pricing_comp_1m !== undefined ? `$${benchmark.pricing_comp_1m.toFixed(2)} / 1M tokens` : 'N/A';
          markdownResponse = `🏷️ **${benchmark.name}** (\`${benchmark.model_id}\`)\n• Provider: **${benchmark.provider}**\n• Input Prompt: \`${pPrompt}\`\n• Output Completion: \`${pComp}\`\n• Arena Elo: \`${benchmark.arena_elo || 'N/A'}\` (Source: ${benchmark.source_name || 'Verified'})`;
          break;
        }

        markdownResponse = `❌ Model matching "${query}" was not found in registry.`;
        break;
      }

      case 'latest':
      case 'events': {
        const events = await getRecentEvents(4);
        if (events.length === 0) {
          markdownResponse = 'ℹ️ No recent market events recorded.';
          break;
        }

        let report = `⚡ **Latest AI Market Events**\n\n`;
        for (const e of events) {
          const pct = e.pct_change ? ` (${e.pct_change > 0 ? '+' : ''}${Math.round(e.pct_change)}%)` : '';
          report += `• **[${e.event_type}]** ${e.model_name || e.model_id}${pct} — ${e.provider || 'AI Hub'}\n`;
        }
        markdownResponse = report.trim();
        break;
      }

      case 'help':
      default: {
        markdownResponse = `⚡ **AI Model Radar Bot Commands**\n\n• \`/radar compare <model1> <model2>\` — Compare pricing & context side-by-side\n• \`/radar deals\` — List top provider arbitrage savings\n• \`/radar price <model-id>\` — Instant pricing lookup for any model\n• \`/radar latest\` — Latest price cuts and model releases`;
        break;
      }
    }

    if (isSlack) {
      return NextResponse.json({
        response_type: 'in_channel',
        text: markdownResponse,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: markdownResponse,
            },
          },
        ],
      });
    }

    if (isDiscord) {
      return NextResponse.json({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          content: markdownResponse,
        },
      });
    }

    // Generic JSON response
    return NextResponse.json({
      text: markdownResponse,
      command: subCommand,
      args,
    });
  } catch (error: any) {
    logger.error(`Bot slash router failed: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to process bot command' },
      { status: 500 }
    );
  }
}
