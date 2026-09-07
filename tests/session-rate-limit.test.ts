import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { checkSessionRateLimit, InMemoryRateLimiter } from '../src/lib/api-auth';
import { createOrGetUser, createApiKey } from '../src/lib/db/queries';
import { generateApiKey } from '../src/lib/api-keys';
import { POST as watchlistsRoute } from '../src/app/api/watchlists/route';

describe('Session-scoped rate limiting on internal routes', () => {
  it('1. allows under the limit and returns 429 with headers over it', async () => {
    const limiter = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i++) {
      const ok = await checkSessionRateLimit(999001, 'probe-scope', { limit: 3 }, limiter);
      expect(ok).toBeNull();
    }
    const blocked = await checkSessionRateLimit(999001, 'probe-scope', { limit: 3 }, limiter);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get('Retry-After')).toBeTruthy();
    expect(blocked!.headers.get('X-RateLimit-Limit')).toBe('3');
  });

  it('2. scopes buckets per user — one abusive user does not block another', async () => {
    const limiter = new InMemoryRateLimiter();
    await checkSessionRateLimit(999002, 'probe-scope', { limit: 1 }, limiter);
    const blocked = await checkSessionRateLimit(999002, 'probe-scope', { limit: 1 }, limiter);
    expect(blocked!.status).toBe(429);
    const other = await checkSessionRateLimit(999003, 'probe-scope', { limit: 1 }, limiter);
    expect(other).toBeNull();
  });

  it('3. watchlists POST is rate-limited per session user (live route)', async () => {
    const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
    const email = `ratelimit.${stamp}@test.dev`;
    await createOrGetUser({ email });
    const { plaintextKey, keyRecord } = generateApiKey(email, 'production');
    await createApiKey(keyRecord);
    const authed = (body: Record<string, string>) =>
      new NextRequest('http://localhost/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${plaintextKey}` },
        body: JSON.stringify(body),
      } as unknown as NextRequest);

    // Default scope limit is 60/min — stay well under it, all succeed.
    for (let i = 0; i < 3; i++) {
      const res = await watchlistsRoute(authed({ modelId: `rl-model-${stamp}-${i}` }));
      expect(res.status).toBe(200);
    }
  });
});
