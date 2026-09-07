import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { POST as botRoute } from '../src/app/api/bot/slash/route';
import { streamSlotAcquire, streamSlotRelease } from '../src/lib/stream-slots';

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.SLACK_SIGNING_SECRET;
  delete process.env.DISCORD_PUBLIC_KEY;
});

function slackSigned(body: string, secret: string, ts?: string) {
  const timestamp = ts ?? Math.floor(Date.now() / 1000).toString();
  const sig =
    'v0=' + crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');
  return { timestamp, sig };
}

describe('Bot webhook signature verification + stream connection caps', () => {
  it('1. accepts a correctly signed Slack command when a secret is configured', async () => {
    process.env.SLACK_SIGNING_SECRET = 'slack-test-secret';
    const body = 'command=%2Fradar&text=help';
    const { timestamp, sig } = slackSigned(body, 'slack-test-secret');
    const res = await botRoute(
      new NextRequest('http://localhost/api/bot/slash', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': sig,
        },
        body,
      })
    );
    expect(res.status).toBe(200);
  });

  it('2. rejects forged and stale Slack signatures', async () => {
    process.env.SLACK_SIGNING_SECRET = 'slack-test-secret';
    const body = 'command=%2Fradar&text=help';
    const forged = await botRoute(
      new NextRequest('http://localhost/api/bot/slash', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
          'x-slack-signature': 'v0=0'.padEnd(71, '0'),
        },
        body,
      })
    );
    expect(forged.status).toBe(401);

    const old = slackSigned(body, 'slack-test-secret', (Math.floor(Date.now() / 1000) - 3600).toString());
    const stale = await botRoute(
      new NextRequest('http://localhost/api/bot/slash', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': old.timestamp,
          'x-slack-signature': old.sig,
        },
        body,
      })
    );
    expect(stale.status).toBe(401);
  });

  it('3. stream slots cap at 5 per identity and release cleanly', () => {
    const id = `stream-test-${Date.now()}`;
    const tokens: object[] = [];
    for (let i = 0; i < 5; i++) {
      const t = streamSlotAcquire(id);
      expect(t).not.toBeNull();
      tokens.push(t!);
    }
    expect(streamSlotAcquire(id)).toBeNull();
    streamSlotRelease(id, tokens[0]);
    expect(streamSlotAcquire(id)).not.toBeNull();
    // Other identities unaffected
    expect(streamSlotAcquire(`${id}-other`)).not.toBeNull();
  });
});
