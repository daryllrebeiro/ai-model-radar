import { describe, it, expect, vi } from 'vitest';
import { parseArgs, resolveApiKey, resolveEndpoint } from '../src/cli/index';
import { POST } from '../src/app/api/bot/slash/route';
import { NextRequest } from 'next/server';
import { trackEvent, getServerEventCounts } from '../src/lib/analytics';

describe('Phase Q3: Developer Experience — CLI & Chat Bot Webhook Router', () => {
  it('1. CLI argument parser correctly parses commands, flags, and options', () => {
    const parsed = parseArgs(['compare', 'claude-3-7-sonnet', 'deepseek-r1', '--json', '--endpoint', 'http://localhost:3000']);
    expect(parsed.command).toBe('compare');
    expect(parsed.positionals).toEqual(['claude-3-7-sonnet', 'deepseek-r1']);
    expect(parsed.isJson).toBe(true);
    expect(parsed.flags['endpoint']).toBe('http://localhost:3000');
  });

  it('2. Resolves API key with flag > env > config hierarchy', () => {
    process.env.AMR_API_KEY = 'env_secret_key_123';
    
    // Flag takes highest priority
    const fromFlag = resolveApiKey({ 'api-key': 'flag_secret_key_999' });
    expect(fromFlag).toBe('flag_secret_key_999');

    // Env is used when flag absent
    const fromEnv = resolveApiKey({});
    expect(fromEnv).toBe('env_secret_key_123');

    delete process.env.AMR_API_KEY;
  });

  it('3. Handles Slack form-urlencoded slash commands and returns mrkdwn blocks', async () => {
    const formData = new URLSearchParams();
    formData.append('command', '/radar');
    formData.append('text', 'price gpt-4o');

    const req = new NextRequest('https://ai-model-radar.com/api/bot/slash', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.response_type).toBe('in_channel');
    expect(json.text).toContain('GPT-4o');
    expect(json.blocks).toBeDefined();
    expect(json.blocks[0].type).toBe('section');
  });

  it('4. Handles Discord interaction webhook and responds with type 4 or type 1 PING', async () => {
    // Test PING handshake
    const pingReq = new NextRequest('https://ai-model-radar.com/api/bot/slash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 1 }),
    });
    const pingRes = await POST(pingReq);
    expect(pingRes.status).toBe(200);
    const pingJson = await pingRes.json();
    expect(pingJson.type).toBe(1);

    // Test Command execution
    const cmdReq = new NextRequest('https://ai-model-radar.com/api/bot/slash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 2,
        id: 'interaction_123',
        token: 'token_abc',
        data: {
          name: 'deals',
        },
      }),
    });
    const cmdRes = await POST(cmdReq);
    expect(cmdRes.status).toBe(200);
    const cmdJson = await cmdRes.json();
    expect(cmdJson.type).toBe(4);
    expect(cmdJson.data.content).toBeDefined();
  });

  it('5. Records analytics telemetry for bot slash commands', () => {
    const before = getServerEventCounts()['bot_command'] || 0;
    trackEvent('bot_command', { platform: 'slack', subCommand: 'compare' });
    const after = getServerEventCounts()['bot_command'] || 0;
    expect(after).toBe(before + 1);
  });
});
