import { NextRequest } from 'next/server';
import { getLatestSnapshotsMap, getEvents, getRecentEndpointTelemetry, getUsageProfileByEmail } from '@/lib/db/queries';
import { getPriceDropForecasts } from '@/lib/forecast';
import { detectMarketSignals } from '@/lib/signals';
import { validatePublicApiRequest, apiJsonResponse, assertPayloadSize } from '@/lib/api-auth';
import { requireFeature } from '@/lib/access-guard';
import { answerQuestion, AskContext, validateAnswer } from '@/lib/ask-answer';
import { askSchema } from '@/lib/validation/api-schemas';

export const dynamic = 'force-dynamic';

export const maxDuration = 30;

/**
 * POST /api/v1/ask
 * Body: { question: string, model_ids?: string[], profile?: {primary_model_id, monthly_prompt_tokens, monthly_comp_tokens, cache_hit_ratio, batch_discount} }
 *
 * "Ask the Radar" (Pro feature, gated via ASK_RADAR).
 * Retrieval-based conversational copilot over snapshots, events, signals,
 * forecasts and probe telemetry. The full answer object ships its citations,
 * which are validated against the same context before returning.
 */
export async function POST(request: NextRequest) {
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }

  const guard = await requireFeature(request, 'ASK_RADAR');
  if (guard.error) {
    return guard.error;
  }

  let body: any;
  try {
    const tooLarge = assertPayloadSize(request, 64 * 1024);
    if (tooLarge) return tooLarge;
    body = await request.json();
  } catch {
    return apiJsonResponse({ error: 'Invalid JSON body' }, auth.rateLimitHeaders, 400);
  }

  const parsed = askSchema.safeParse(body);
  if (!parsed.success) {
    return apiJsonResponse(
      { error: 'question must be between 3 and 2000 characters', issues: parsed.error.issues },
      auth.rateLimitHeaders,
      400
    );
  }

  const question = parsed.data.question;

  const [snapshotsMap, eventsRes, telemetryRes] = await Promise.all([
    getLatestSnapshotsMap(),
    getEvents({ limit: 500 }),
    getRecentEndpointTelemetry({ limit: 500 }),
  ]);

  const snapshots = Array.from(snapshotsMap.values());
  const forecasts = getPriceDropForecasts(snapshots, eventsRes.events, {
    minProbability: 0.35,
    maxForecasts: 15,
  });
  const signals = detectMarketSignals(snapshots, eventsRes.events);

  const context: AskContext = {
    snapshots,
    events: eventsRes.events,
    signals,
    forecasts,
    telemetry: telemetryRes && telemetryRes.length > 0 ? telemetryRes : undefined,
  };

  let profile: { primary_model_id?: string; monthly_prompt_tokens?: number; monthly_comp_tokens?: number } | undefined;

  if (body.profile && typeof body.profile === 'object') {
    const p = body.profile as { primary_model_id?: string; monthly_prompt_tokens?: number; monthly_comp_tokens?: number };
    if (typeof p.primary_model_id === 'string' && p.primary_model_id.length > 0) {
      profile = { ...p };
    }
  }

  if (!profile && auth.ownerEmail) {
    const stored = await getUsageProfileByEmail(auth.ownerEmail);
    if (stored) {
      profile = {
        primary_model_id: stored.primary_model_id,
        monthly_prompt_tokens: stored.monthly_prompt_tokens,
        monthly_comp_tokens: stored.monthly_comp_tokens,
      };
    }
  }

  const answer = await answerQuestion({ question, context, profile });

  const unverifiable = validateAnswer(answer, context);
  if (unverifiable.length > 0) {
    return apiJsonResponse(
      { error: 'Answer failed citation validation', unverifiable },
      auth.rateLimitHeaders,
      500
    );
  }

  return apiJsonResponse(
    {
      version: 'v1',
      generated_at: new Date().toISOString(),
      source: 'protocol',
      citations_validated: true,
      answer,
    },
    auth.rateLimitHeaders
  );
}