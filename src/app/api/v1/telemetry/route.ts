import { NextRequest } from 'next/server';
import { getRecentEndpointTelemetry } from '@/lib/db/queries';
import { evaluateEndpointHealth } from '@/lib/probe';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { requireFeature } from '@/lib/access-guard';
import { EndpointTelemetry } from '@/types/telemetry';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/telemetry?model_id=...&provider=...&limit=20&degraded_only=true
 *
 * Live endpoint intelligence (Pro feature, gated via APT_PROBE).
 * Returns persisted probe telemetry (P95 latency, tokens/sec, 429 rate,
 * free-tier availability) with a per-record health classification.
 */
export async function GET(request: NextRequest) {
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }

  const guard = await requireFeature(request, 'APT_PROBE');
  if (guard.error) {
    return guard.error;
  }

  const params = request.nextUrl.searchParams;
  const modelId = params.get('model_id') || undefined;
  const provider = params.get('provider') || undefined;
  const rawLimit = Number(params.get('limit') || '50');
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 50;
  const degradedOnly = params.get('degraded_only') === 'true';

  const telemetry = await getRecentEndpointTelemetry({ modelId, provider, limit });

  const withHealth = telemetry.map((record: EndpointTelemetry) => ({
    ...record,
    health: evaluateEndpointHealth(record),
  }));

  const filtered = degradedOnly
    ? withHealth.filter((r) => r.health.status !== 'healthy')
    : withHealth;

  return apiJsonResponse(
    {
      version: 'v1',
      generated_at: new Date().toISOString(),
      summary: {
        total: telemetry.length,
        healthy: telemetry.filter((r) => evaluateEndpointHealth(r).status === 'healthy').length,
        degraded: telemetry.filter((r) => evaluateEndpointHealth(r).status === 'degraded').length,
        down: telemetry.filter((r) => evaluateEndpointHealth(r).status === 'down').length,
      },
      telemetry: filtered,
    },
    auth.rateLimitHeaders
  );
}