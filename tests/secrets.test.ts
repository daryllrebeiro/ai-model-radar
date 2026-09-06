import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { secretsEqual } from '../src/lib/secrets';
import { GET as pollRoute } from '../src/app/api/cron/poll/route';
import { GET as digestRoute } from '../src/app/api/cron/digest/route';
import { GET as pruneRoute } from '../src/app/api/cron/prune/route';

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('Phase 1.4 - Constant-time secret comparison', () => {
  it('1. accepts equal secrets, rejects every mismatch shape', () => {
    expect(secretsEqual('Bearer abc123', 'Bearer abc123')).toBe(true);
    expect(secretsEqual('x-admin-secret-value', 'x-admin-secret-value')).toBe(true);
    // Differ in last char only (the timing-attack-relevant case)
    expect(secretsEqual('Bearer abc123', 'Bearer abc124')).toBe(false);
    // Differ in first char
    expect(secretsEqual('Bearer abc123', 'Xearer abc123')).toBe(false);
    // Different lengths both directions
    expect(secretsEqual('short', 'much-longer-secret-value')).toBe(false);
    expect(secretsEqual('much-longer-secret-value', 'short')).toBe(false);
  });

  it('2. never authenticates empty or non-string input', () => {
    expect(secretsEqual('', '')).toBe(false);
    expect(secretsEqual('secret', '')).toBe(false);
    expect(secretsEqual('', 'secret')).toBe(false);
    expect(secretsEqual(null, 'secret')).toBe(false);
    expect(secretsEqual('secret', null)).toBe(false);
    expect(secretsEqual(undefined, undefined)).toBe(false);
    expect(secretsEqual(12345 as any, '12345')).toBe(false);
  });

  it('3. cron routes reject wrong bearer tokens when CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 'test-cron-secret-1';
    const wrong = { headers: { Authorization: 'Bearer wrong-secret' } };

    const poll = await pollRoute(new NextRequest('http://localhost/api/cron/poll', wrong));
    expect(poll.status).toBe(401);

    const digest = await digestRoute(new NextRequest('http://localhost/api/cron/digest', wrong));
    expect(digest.status).toBe(401);

    const prune = await pruneRoute(new NextRequest('http://localhost/api/cron/prune', wrong));
    expect(prune.status).toBe(401);

    // Missing header is also rejected (no silent pass-through)
    const missing = await pollRoute(new NextRequest('http://localhost/api/cron/poll'));
    expect(missing.status).toBe(401);
  });

  it('4. digest cron accepts the correct secret and completes without recipients', async () => {
    process.env.CRON_SECRET = 'test-cron-secret-2';
    const res = await digestRoute(
      new NextRequest('http://localhost/api/cron/digest', {
        headers: { Authorization: 'Bearer test-cron-secret-2' },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.timeframe).toBe('daily');
  });
});
