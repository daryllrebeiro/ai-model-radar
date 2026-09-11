import { NextRequest, NextResponse } from 'next/server';
import { CANARY_BATTERY, CANARY_BATTERY_VERSION } from '@/lib/active-probe';
import { DEFAULT_ACTIVE_PROBE_BUDGET, ACTIVE_PROBE_SCOPE_NOTE, DRIFT_EVIDENCE_NOTE } from '@/types/active-probe';
import { validatePublicApiRequest } from '@/lib/api-auth';

/**
 * S4+S5 status: battery version, budget, scope. Real generation cycles run
 * from scheduled workers with dedicated PROBE_* keys — never from this route
 * (no paid calls on GET).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Audit H1: throttle like every other public read.
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }
  return NextResponse.json({
    version: 'v1',
    battery_version: CANARY_BATTERY_VERSION,
    battery: CANARY_BATTERY.map((p) => ({ id: p.id, dimension: p.dimension, version: p.version })),
    budget: DEFAULT_ACTIVE_PROBE_BUDGET,
    scope_note: ACTIVE_PROBE_SCOPE_NOTE,
    evidence_note: DRIFT_EVIDENCE_NOTE,
    credentials: 'Dedicated PROBE_* keys required; no cycle runs without them.',
  });
}
