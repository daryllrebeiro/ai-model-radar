import { NextRequest } from 'next/server';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { normalizeTier, getFeaturesForTier } from '@/lib/feature-flags';
import { TIER_LIMITS } from '@/lib/api-keys';
import { handleApiError } from '@/lib/api-error-handler';

export const dynamic = 'force-dynamic';

/**
 * P3 GET /api/v1/quotas — self-serve quota display for the caller's key
 * tier (per-request limits, window, gated feature list). Account-level
 * metadata only — no usage counters (durable metering needs Redis; the
 * metering aggregation in lib/metering.ts is the offline counterpart).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await validatePublicApiRequest(request);
    if (!auth.allowed && auth.errorResponse) {
      return auth.errorResponse;
    }
    const tier = normalizeTier(auth.tier);
    const limits = TIER_LIMITS[auth.tier] || TIER_LIMITS.anonymous;
    return apiJsonResponse(
      {
        version: 'v1',
        key_tier: auth.tier,
        access_tier: tier,
        quota: {
          requests_per_window: limits.limit,
          window_ms: limits.windowMs,
          windows_per_hour: Math.floor(3600000 / limits.windowMs),
          max_requests_per_hour: limits.limit * Math.floor(3600000 / limits.windowMs),
        },
        features: getFeaturesForTier(tier).map((f) => f.key),
      },
      auth.rateLimitHeaders
    );
  } catch (err: any) {
    return handleApiError(err, 'quotas GET');
  }
}
