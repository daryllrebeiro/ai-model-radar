import { NextRequest } from 'next/server';
import { validatePublicApiRequest, apiJsonResponse } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import { getRoutingReliability, checkRoutingPilot } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/routing/stats — pilot-gated reliability readout.
 * Reliability (success rate, latency overhead) is the R10 success metric and
 * must clear the bar BEFORE usage growth counts as signal.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await validatePublicApiRequest(request);
    if (!auth.allowed && auth.errorResponse) {
      return auth.errorResponse;
    }
    const pilot = await checkRoutingPilot(auth.ownerEmail);
    if (!pilot.ok) {
      return apiJsonResponse({ error: 'Routing gateway is in closed pilot.' }, auth.rateLimitHeaders, 403);
    }
    const { searchParams } = new URL(request.url);
    const raw = Number(searchParams.get('hours') || '24');
    const hours = Number.isFinite(raw) ? Math.min(24 * 30, Math.max(1, Math.floor(raw))) : 24;
    const reliability = await getRoutingReliability(hours);
    return apiJsonResponse({ version: 'v1', generated_at: new Date().toISOString(), ...reliability }, auth.rateLimitHeaders);
  } catch (err: any) {
    return handleApiError(err, 'routing/stats GET');
  }
}
