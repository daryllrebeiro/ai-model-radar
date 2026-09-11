import { NextRequest, NextResponse } from 'next/server';
import { CANARY_BATTERY, CANARY_BATTERY_VERSION } from '@/lib/active-probe';
import { DEFAULT_ACTIVE_PROBE_BUDGET, ACTIVE_PROBE_SCOPE_NOTE, DRIFT_EVIDENCE_NOTE } from '@/types/active-probe';
import { withPublicGuards } from '@/lib/route-guards';

/**
 * S4+S5 status: battery version, budget, scope. Real generation cycles run
 * from scheduled workers with dedicated PROBE_* keys — never from this route
 * (no paid calls on GET).
 */
export const dynamic = 'force-dynamic';

export const GET = withPublicGuards(async (_request: NextRequest) => {
  return NextResponse.json({
    version: 'v1',
    battery_version: CANARY_BATTERY_VERSION,
    battery: CANARY_BATTERY.map((p) => ({ id: p.id, dimension: p.dimension, version: p.version })),
    budget: DEFAULT_ACTIVE_PROBE_BUDGET,
    scope_note: ACTIVE_PROBE_SCOPE_NOTE,
    evidence_note: DRIFT_EVIDENCE_NOTE,
    credentials: 'Dedicated PROBE_* keys required; no cycle runs without them.',
  });
});
