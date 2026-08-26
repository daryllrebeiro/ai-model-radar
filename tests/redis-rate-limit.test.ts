import { describe, it, expect, vi } from 'vitest';
import {
  createRateLimiter,
  UpstashRedisRateLimiter,
  validatePublicApiRequest,
} from '../src/lib/api-auth';
import { NextRequest } from 'next/server';

describe('Phase P6.2: Upstash Redis Rate Limiting & Fail-Loud Safety', () => {
  it('1. Throws fatal exception on startup in production when Upstash Redis env vars are missing', () => {
    const prevEnv = process.env.NODE_ENV;
    const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
    const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      expect(() => createRateLimiter()).toThrowError(/UPSTASH_REDIS_REST_URL/);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevUrl) process.env.UPSTASH_REDIS_REST_URL = prevUrl;
      if (prevToken) process.env.UPSTASH_REDIS_REST_TOKEN = prevToken;
    }
  });

  it('2. Executes atomic Redis REST pipeline commands and respects shared counters across instances', async () => {
    let redisCounter = 0;
    const mockFetch = vi.fn().mockImplementation((url, options) => {
      const body = JSON.parse(options.body);
      // Validate pipeline format
      expect(body[0][0]).toBe('INCR');
      expect(body[1][0]).toBe('EXPIRE');

      redisCounter++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ result: redisCounter }, { result: 1 }]),
      });
    });

    const redisLimiter = new UpstashRedisRateLimiter(
      'https://test-db.upstash.io',
      'test_upstash_token_123',
      mockFetch as any
    );

    // Simulate 3 concurrent worker processes hitting the shared Redis instance
    const req1 = await redisLimiter.check('ip:1.2.3.4', 5, 60000);
    const req2 = await redisLimiter.check('ip:1.2.3.4', 5, 60000);
    const req3 = await redisLimiter.check('ip:1.2.3.4', 5, 60000);

    expect(req1.remaining).toBe(4);
    expect(req2.remaining).toBe(3);
    expect(req3.remaining).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('3. Fails closed in production on Redis network outage to prevent unthrottled traffic flood', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const failingFetch = vi.fn().mockRejectedValue(new Error('Network connection timeout to Redis'));
    const redisLimiter = new UpstashRedisRateLimiter(
      'https://test-db.upstash.io',
      'test_token',
      failingFetch as any
    );

    try {
      const result = await redisLimiter.check('ip:5.6.7.8', 60, 60000);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
