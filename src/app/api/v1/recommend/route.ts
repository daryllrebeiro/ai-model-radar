import { NextRequest } from 'next/server';
import { getLatestSnapshotsMap, getEvents, upsertUsageProfile, getUsageProfileByEmail, UsageProfile } from '@/lib/db/queries';
import { buildRecommendations, UsageProfileInput } from '@/lib/recommendation';
import { detectMarketSignals } from '@/lib/signals';
import { validatePublicApiRequest, apiJsonResponse, assertPayloadSize } from '@/lib/api-auth';
import { requireFeature } from '@/lib/access-guard';

export const dynamic = 'force-dynamic';

function toInput(p: UsageProfile): UsageProfileInput {
  return {
    primary_model_id: p.primary_model_id,
    monthly_prompt_tokens: p.monthly_prompt_tokens,
    monthly_comp_tokens: p.monthly_comp_tokens,
    cache_hit_ratio: p.cache_hit_ratio,
    batch_discount: p.batch_discount,
  };
}

interface InlineProfile {
  primary_model_id?: string;
  monthly_prompt_tokens?: number | string;
  monthly_comp_tokens?: number | string;
  cache_hit_ratio?: number | string;
  batch_discount?: number | string;
}

/**
 * POST /api/v1/recommend
 *
 * MigrateSavings (Pro feature, gated via MIGRATION). Accepts an inline usage
 * profile (opt-in) and returns "switch and save $N/mo" recommendations rated
 * by EOL + forecast risk. A submitted profile is persisted under the API
 * owner's email and reused by weekly digests and deals badges.
 */
export async function POST(request: NextRequest) {
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }

  const guard = await requireFeature(request, 'MIGRATION');
  if (guard.error) {
    return guard.error;
  }

  if (!auth.ownerEmail) {
    return apiJsonResponse({ error: 'authenticated API key required' }, auth.rateLimitHeaders, 401);
  }

    let body: { profile?: InlineProfile } | null = null;
    try {
      const tooLarge = assertPayloadSize(request, 64 * 1024);
      if (tooLarge) return tooLarge;
      body = await request.json();
  } catch {
    return apiJsonResponse({ error: 'invalid JSON body' }, auth.rateLimitHeaders, 400);
  }

  const inline = body?.profile;
  let profile: UsageProfile | null = null;

  if (inline) {
    if (!inline.primary_model_id) {
      return apiJsonResponse(
        { error: 'profile.primary_model_id is required' },
        auth.rateLimitHeaders,
        400
      );
    }
    profile = await upsertUsageProfile({
      email: auth.ownerEmail,
      monthly_prompt_tokens: Math.floor(Number(inline.monthly_prompt_tokens) || 0),
      monthly_comp_tokens: Math.floor(Number(inline.monthly_comp_tokens) || 0),
      cache_hit_ratio: Number(inline.cache_hit_ratio) || 0,
      batch_discount: Number(inline.batch_discount) || 0,
      primary_model_id: inline.primary_model_id,
    });
  } else {
    profile = await getUsageProfileByEmail(auth.ownerEmail);
    if (!profile) {
      return apiJsonResponse(
        { error: 'no usage profile on file; POST with { "profile": { primary_model_id, ... } }' },
        auth.rateLimitHeaders,
        400
      );
    }
  }

  const [snapshotsMap, eventsRes] = await Promise.all([
    getLatestSnapshotsMap(),
    getEvents({ limit: 500 }),
  ]);
  const snapshots = Array.from(snapshotsMap.values());
  const signals = detectMarketSignals(snapshots, eventsRes.events)
    .filter((s) => s.signal_type === 'MODEL_EOL' || s.signal_type === 'PRICE_DROP_EXPECTED');

  const report = buildRecommendations({
    profile: toInput(profile),
    snapshots,
    signals,
  });

  return apiJsonResponse(
    {
      version: 'v1',
      generated_at: report.generated_at,
      primary_model: report.primary_model,
      flags: report.flags,
      recommendations: report.recommendations,
      best_switch: report.best_switch,
      total_monthly_savings_usd: report.total_monthly_savings_usd,
    },
    auth.rateLimitHeaders
  );
}