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
 * In-Memory Sliding-Window Rate Limiter (strictly for local development & unit testing).
 * Exact sliding window: per-identifier hit timestamps, pruned on every check.
 */
export class InMemoryRateLimiter implements IRateLimiter {
  private buckets = new Map<string, number[]>();

  public check(identifier: string, limit = 60, windowMs = 60 * 1000): RateLimitCheckResult {
    const now = Date.now();
    const cutoff = now - windowMs;
    let hits = this.buckets.get(identifier) || [];
    hits = hits.filter((ts) => ts > cutoff);

    if (hits.length >= limit) {
      this.buckets.set(identifier, hits);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetInSec: hits.length > 0 ? Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) : Math.ceil(windowMs / 1000),
      };
    }

    hits.push(now);
    this.buckets.set(identifier, hits);
    return {
      allowed: true,
      limit,
      remaining: limit - hits.length,
      resetInSec: Math.ceil(windowMs / 1000),
    };
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
    const now = Date.now();
    const windowIndex = Math.floor(now / windowMs);
    const windowStart = windowIndex * windowMs;
    const elapsed = now - windowStart;
    const prevWeight = Math.max(0, (windowMs - elapsed) / windowMs);
    const key = `ratelimit:${identifier}:${windowIndex}`;
    const prevKey = `ratelimit:${identifier}:${windowIndex - 1}`;

    try {
      // Weighted sliding window: current bucket INCR + previous bucket read
      // in one REST pipeline. Estimate = current + previous × overlap share,
      // so bursts straddling a window edge can no longer double the limit.
      const response = await this.fetchFn(`${this.url}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', key],
          ['EXPIRE', key, windowSec],
          ['GET', prevKey],
        ]),
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Upstash Redis REST returned HTTP ${response.status}: ${response.statusText}`);
      }

      const results = await response.json();
      const count = Number(results[0]?.result || 1);
      const prevCount = Number(results[2]?.result || 0);
      const estimate = count + prevCount * prevWeight;
      const remaining = Math.max(0, limit - Math.ceil(estimate));

      return {
        allowed: estimate <= limit,
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
      // Upstash REST DEL takes exact keys (no glob expansion), so delete the
      // current and previous window buckets explicitly. Covers the default
      // 60s window; older buckets expire on their own via EXPIRE.
      try {
        const windowMs = 60 * 1000;
        const windowIndex = Math.floor(Date.now() / windowMs);
        await this.fetchFn(
          `${this.url}/del/ratelimit:${identifier}:${windowIndex}/ratelimit:${identifier}:${windowIndex - 1}`,
          {
            headers: { Authorization: `Bearer ${this.token}` },
          }
        );
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
 * Best-effort client IP for rate-limit bucketing. Takes the LAST
 * x-forwarded-for entry: proxies append the observed client IP, so attacker-
 * prepended spoof entries sit earlier in the list. Direct-origin requests can
 * still forge the whole header (documented residual) — key-scoped buckets
 * remain the primary defense for authenticated callers.
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return request.headers.get('x-real-ip') || '127.0.0.1';
}

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
  const ip = getClientIp(request);

  const rateLimitId = keyVerification.valid && keyVerification.record
    ? `key:${keyVerification.record.key_prefix}`
    : `ip:${ip}`;

  const check = await limiter.check(rateLimitId, tierConfig.limit, tierConfig.windowMs);

  // CORS allowlist: ALLOWED_ORIGINS (comma-separated) pins browser access to
  // documented consumers and echoes back a matching Origin with Vary.
  // Unset (or non-matching Origin) falls back to '*' for the public,
  // unauthenticated catalog surface — no credentials are ever accepted
  // cross-origin (no Allow-Credentials), so '*' cannot exfiltrate sessions.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const requestOrigin = (request.headers.get('origin') || '').replace(/\/$/, '');
  const corsOrigin =
    requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : '*';

  const rateLimitHeaders: Record<string, string> = {
    'X-RateLimit-Limit': check.limit.toString(),
    'X-RateLimit-Remaining': check.remaining.toString(),
    'X-RateLimit-Reset': check.resetInSec.toString(),
    'X-RateLimit-Tier': tier,
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    ...(corsOrigin !== '*' ? { Vary: 'Origin' } : {}),
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

/**
 * Session-scoped rate limit for authenticated internal routes
 * (teams, watchlists, billing, user, alerts/test).
 *
 * The v1 public API is rate-limited by API key/IP via validatePublicApiRequest,
 * but session-authenticated routes had no limiter at all — any authenticated
 * user could hammer team/governance writes, billing checkout, exports, or the
 * webhook test endpoint (which triggers outbound fetches) without bound.
 * Keyed per user + scope so one abusive user cannot exhaust others' budgets.
 *
 * Returns a 429 NextResponse when over limit, or null when the request may
 * proceed. Uses the same globalRateLimiter store as the public API
 * (Upstash Redis in production, in-memory otherwise).
 */
export async function checkSessionRateLimit(
  userId: string | number,
  scope: string,
  opts?: { limit?: number; windowMs?: number },
  limiter: IRateLimiter = globalRateLimiter
): Promise<NextResponse | null> {
  const limit = opts?.limit ?? 60;
  const windowMs = opts?.windowMs ?? 60 * 1000;
  const check = await limiter.check(`sess:${userId}:${scope}`, limit, windowMs);

  if (!check.allowed) {
    return NextResponse.json(
      {
        error: 'Too Many Requests',
        message: `Rate limit of ${check.limit} requests per minute exceeded for this action. Retry after ${check.resetInSec} seconds.`,
        retry_after_seconds: check.resetInSec,
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': check.limit.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': check.resetInSec.toString(),
          'Retry-After': check.resetInSec.toString(),
        },
      }
    );
  }
  return null;
}

/**
 * Structured audit log for authentication/authorization denials.
 * Records route + hashed client IP (no raw PII) so brute-force and probing
 * campaigns are visible in logs without retaining identifiers.
 */
export function logAuthDenied(route: string, request: NextRequest, reason: string): void {
  const ip = getClientIp(request);
  // Lazy import avoids a hard edge-runtime dependency cycle.
  void import('./logger').then(({ logger, hashIp }) =>
    logger.warn('auth.denied', { route, reason, client: hashIp(ip) })
  );
}

/**
 * Rejects oversized request bodies before JSON parsing. Next.js parses the
 * full body synchronously, so a multi-MB payload to a compute-heavy route
 * (ask/evaluate/recommend) is a cheap DoS. Default cap 256 KB; expensive
 * routes pass smaller caps. Returns a 413 NextResponse or null.
 */
export function assertPayloadSize(request: NextRequest, maxBytes = 256 * 1024): NextResponse | null {
  const raw = request.headers.get('content-length');
  if (raw !== null) {
    const len = Number(raw);
    if (Number.isFinite(len) && len > maxBytes) {
      return NextResponse.json(
        { error: 'Payload Too Large', message: `Request body exceeds ${maxBytes} bytes.` },
        { status: 413 }
      );
    }
  }
  return null;
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
