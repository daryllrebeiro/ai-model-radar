import { NextRequest } from 'next/server';
import { getEvents } from '@/lib/db/queries';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { requireFeature } from '@/lib/access-guard';
import { evaluateAdvancedAlertRules, DEFAULT_ALERT_CONFIG } from '@/lib/alerts';
import { AlertRuleConfig } from '@/types/alerts';
import { handleApiError } from '@/lib/api-error-handler';

export const dynamic = 'force-dynamic';

const NUMERIC_FIELDS = [
  'minPriceDropPct',
  'minAbsoluteDropUsd',
  'maxContextWindowTokens',
  'minContextWindowTokens',
] as const;

/**
 * POST /api/v1/alerts/evaluate
 *
 * (Pro, ADVANCED_ALERT_RULES) Evaluates a set of recent market events against
 * an advanced (compound) alert rule configuration. Body: { config?, limit? }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await validatePublicApiRequest(request);
    if (!auth.allowed && auth.errorResponse) {
      return auth.errorResponse;
    }

    const guard = await requireFeature(request, 'ADVANCED_ALERT_RULES');
    if (guard.error) {
      return guard.error;
    }

    const body = (await request.json().catch(() => null)) || {};
    const config: AlertRuleConfig = { ...DEFAULT_ALERT_CONFIG, ...body.config };

    for (const field of NUMERIC_FIELDS) {
      if (config[field] !== undefined && typeof config[field] !== 'number') {
        config[field] = Number(config[field]);
      }
    }
    if (config.minPriceDropPct !== undefined && isNaN(Number(config.minPriceDropPct))) {
      config.minPriceDropPct = DEFAULT_ALERT_CONFIG.minPriceDropPct;
    }

    const rawLimit = Number(body.limit || 100);
    const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.floor(rawLimit))) : 100;

    const { events } = await getEvents({ limit });
    const watched = new Set<string>((body.watchedModelIds as string[]) || []);
    const result = evaluateAdvancedAlertRules(events, config, watched);

    return apiJsonResponse(
      {
        version: 'v1',
        generated_at: new Date().toISOString(),
        mode: config.mode,
        total: result.total,
        top_score: result.events[0]?.score || 0,
        events: result.events.slice(0, 50),
      },
      auth.rateLimitHeaders
    );
  } catch (err: any) {
    return handleApiError(err, 'alerts/evaluate POST');
  }
}