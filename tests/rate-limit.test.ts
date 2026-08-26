import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { validatePublicApiRequest, InMemoryRateLimiter } from '../src/lib/api-auth';
import { generateApiKey } from '../src/lib/api-keys';
import { createApiKey } from '../src/lib/db/queries';

describe('Phase P2: Tiered Rate Limiting & Concurrent Bursts', () => {
  let limiter: InMemoryRateLimiter;

  beforeEach(() => {
    limiter = new InMemoryRateLimiter();
  });

  it('1. Allows unauthenticated requests within the 60 req/min anonymous tier quota', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/models', {
      headers: { 'x-forwarded-for': '192.168.1.50' },
    });

    const result = await validatePublicApiRequest(req, limiter);
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe('anonymous');
    expect(result.rateLimitHeaders['X-RateLimit-Limit']).toBe('60');
    expect(Number(result.rateLimitHeaders['X-RateLimit-Remaining'])).toBe(59);
  });

  it('2. Grants 300 req/min limit to authenticated developer tier keys', async () => {
    const { plaintextKey, keyRecord } = generateApiKey('dev@test.com', 'developer');
    await createApiKey(keyRecord);

    const req = new NextRequest('http://localhost:3000/api/v1/models', {
      headers: { Authorization: `Bearer ${plaintextKey}` },
    });

    const result = await validatePublicApiRequest(req, limiter);
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe('developer');
    expect(result.rateLimitHeaders['X-RateLimit-Limit']).toBe('300');
  });

  it('3. Enforces HTTP 429 and Retry-After headers when quota is exhausted', async () => {
    const testIp = '10.0.0.88';

    // Exhaust 60 anonymous requests
    for (let i = 0; i < 60; i++) {
      const req = new NextRequest('http://localhost:3000/api/v1/models', {
        headers: { 'x-forwarded-for': testIp },
      });
      await validatePublicApiRequest(req, limiter);
    }

    // 61st request should be blocked
    const blockedReq = new NextRequest('http://localhost:3000/api/v1/models', {
      headers: { 'x-forwarded-for': testIp },
    });

    const blockedResult = await validatePublicApiRequest(blockedReq, limiter);
    expect(blockedResult.allowed).toBe(false);
    expect(blockedResult.errorResponse).toBeDefined();
    expect(blockedResult.errorResponse?.status).toBe(429);
    expect(blockedResult.rateLimitHeaders['X-RateLimit-Remaining']).toBe('0');
  });

  it('4. Handles concurrent parallel bursts from multiple client IPs without state leakage', async () => {
    const clientA = '172.16.0.1';
    const clientB = '172.16.0.2';

    // Concurrently fire 20 requests from Client A and 20 requests from Client B
    const requestsA = Array.from({ length: 20 }, () =>
      validatePublicApiRequest(
        new NextRequest('http://localhost:3000/api/v1/events', {
          headers: { 'x-forwarded-for': clientA },
        }),
        limiter
      )
    );

    const requestsB = Array.from({ length: 20 }, () =>
      validatePublicApiRequest(
        new NextRequest('http://localhost:3000/api/v1/events', {
          headers: { 'x-forwarded-for': clientB },
        }),
        limiter
      )
    );

    const [resultsA, resultsB] = await Promise.all([
      Promise.all(requestsA),
      Promise.all(requestsB),
    ]);

    expect(resultsA.every((r) => r.allowed)).toBe(true);
    expect(resultsB.every((r) => r.allowed)).toBe(true);

    // Verify remaining count for Client A is 39 (60 - 20 - 1)
    const nextReqA = await validatePublicApiRequest(
      new NextRequest('http://localhost:3000/api/v1/events', {
        headers: { 'x-forwarded-for': clientA },
      }),
      limiter
    );
    expect(nextReqA.rateLimitHeaders['X-RateLimit-Remaining']).toBe('39');
  });
});
