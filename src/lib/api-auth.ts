import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey, TIER_LIMITS, ApiKeyTier } from './api-keys';

export interface ApiAuthResult {
  allowed: boolean;
  tier: ApiKeyTier | 'anonymous';
  ownerEmail?: string;
  rateLimitHeaders: Record<string, string>;
  errorResponse?: NextResponse;
}

interface RateLimitCheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetInSec: number;
}

/**
 * Interface for rate limit stores (Upstash Redis or In-Memory)
 */
export interface IRateLimiter {
  check(identifier: string, limit: number, windowMs: number): Promise<RateLimitCheckResult> | RateLimitCheckResult;
  reset(identifier?: string): Promise<void> | void;
}

/**
 * In-Memory Sliding-Window Rate Limiter (strictly for local development & unit testing)
 */
export class InMemoryRateLimiter implements IRateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  public check(identifier: string, limit = 60, windowMs = 60 * 1000): RateLimitCheckResult {
    const now = Date.now();
    let bucket = this.buckets.get(identifier);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 1, resetAt: now + windowMs };
      this.buckets.set(identifier, bucket);
      return {
        allowed: true,
        limit,
        remaining: limit - 1,
        resetInSec: Math.ceil(windowMs / 1000),
      };
    }

    bucket.count++;
    const remaining = Math.max(0, limit - bucket.count);
    const resetInSec = Math.ceil((bucket.resetAt - now) / 1000);

    if (bucket.count > limit) {
      return { allowed: false, limit, remaining: 0, resetInSec };
    }

    return { allowed: true, limit, remaining, resetInSec };
  }

  public reset(identifier?: string): void {
    if (identifier) {
      this.buckets.delete(identifier);
    } else {
      this.buckets.clear();
    }
  }
}

/**
 * Serverless Upstash Redis Rate Limiter via HTTP REST Pipeline
 * Fails loud on network failure when in production rather than silently masking errors.
 */
export class UpstashRedisRateLimiter implements IRateLimiter {
  private url: string;
  private token: string;
  private fetchFn: typeof fetch;

  constructor(url: string, token: string, fetchFn: typeof fetch = fetch) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
    this.fetchFn = fetchFn;
  }

  public async check(identifier: string, limit = 60, windowMs = 60 * 1000): Promise<RateLimitCheckResult> {
    const windowSec = Math.ceil(windowMs / 1000);
    const key = `ratelimit:${identifier}:${Math.floor(Date.now() / windowMs)}`;

    try {
      // Execute Redis INCR + EXPIRE via REST pipeline
      const response = await this.fetchFn(`${this.url}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', key],
          ['EXPIRE', key, windowSec],
        ]),
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Upstash Redis REST returned HTTP ${response.status}: ${response.statusText}`);
      }

      const results = await response.json();
      const count = Number(results[0]?.result || 1);
      const remaining = Math.max(0, limit - count);

      return {
        allowed: count <= limit,
        limit,
        remaining,
        resetInSec: windowSec,
      };
    } catch (err) {
      console.error('CRITICAL: Upstash Redis rate limiter error:', err);
      if (process.env.NODE_ENV === 'production') {
        // Fail closed in production to prevent unbounded abuse during Redis partition
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetInSec: windowSec,
        };
      }
      throw err;
    }
  }

  public async reset(identifier?: string): Promise<void> {
    if (identifier) {
      try {
        await this.fetchFn(`${this.url}/del/ratelimit:${identifier}:*`, {
          headers: { Authorization: `Bearer ${this.token}` },
        });
      } catch {
        // ignore reset error
      }
    }
  }
}

/**
 * Initializes rate limiter store.
 * Throws immediately in production if Upstash credentials are missing.
 */
export function createRateLimiter(): IRateLimiter {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    return new UpstashRedisRateLimiter(redisUrl, redisToken);
  }

  // Allow static build phase to collect page data without live secrets
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return new InMemoryRateLimiter();
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured in production environment. In-memory rate limiting is prohibited in production.'
    );
  }

  return new InMemoryRateLimiter();
}

export const globalRateLimiter = createRateLimiter();

/**
 * Validates public API requests with API Key verification and tiered rate limits
 */
export async function validatePublicApiRequest(
  request: NextRequest,
  limiter: IRateLimiter = globalRateLimiter
): Promise<ApiAuthResult> {
  const authHeader =
    request.headers.get('authorization') ||
    request.headers.get('Authorization');
  const apiKeyHeader =
    request.headers.get('x-api-key') ||
    request.headers.get('X-Api-Key') ||
    request.headers.get('X-API-KEY');

  let rawKey: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawKey = authHeader.substring(7).trim();
  } else if (authHeader && authHeader.startsWith('bearer ')) {
    rawKey = authHeader.substring(7).trim();
  } else if (apiKeyHeader) {
    rawKey = apiKeyHeader.trim();
  }

  // Verify key if provided
  const keyVerification = await verifyApiKey(rawKey);
  const tier = keyVerification.tier;
  const tierConfig = TIER_LIMITS[tier] || TIER_LIMITS.anonymous;

  // Rate limit identifier: use key prefix for auth users, client IP for anonymous
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';

  const rateLimitId = keyVerification.valid && keyVerification.record
    ? `key:${keyVerification.record.key_prefix}`
    : `ip:${ip}`;

  const check = await limiter.check(rateLimitId, tierConfig.limit, tierConfig.windowMs);

  const rateLimitHeaders: Record<string, string> = {
    'X-RateLimit-Limit': check.limit.toString(),
    'X-RateLimit-Remaining': check.remaining.toString(),
    'X-RateLimit-Reset': check.resetInSec.toString(),
    'X-RateLimit-Tier': tier,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
  };

  if (!check.allowed) {
    const errorResponse = NextResponse.json(
      {
        error: 'Too Many Requests',
        tier,
        message: `Rate limit of ${check.limit} requests per minute exceeded for ${tier} tier. Retry after ${check.resetInSec} seconds.`,
        retry_after_seconds: check.resetInSec,
      },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders,
          'Retry-After': check.resetInSec.toString(),
        },
      }
    );

    return {
      allowed: false,
      tier,
      ownerEmail: keyVerification.record?.owner_email,
      rateLimitHeaders,
      errorResponse,
    };
  }

  return {
    allowed: true,
    tier,
    ownerEmail: keyVerification.record?.owner_email,
    rateLimitHeaders,
  };
}

export function apiJsonResponse(data: any, headers?: Record<string, string>, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}
