/**
 * P2 routing SLO: the R10 reliability bar as code. Pilot bar (see
 * ROUTING_INCIDENT_PLAN.md): 1h success ≥ 99% AND p95 added overhead
 * < 250ms. Pure evaluation — the stats route embeds it and the nightly
 * SLO workflow fails (pages) on breach.
 */
import type { RoutingReliability } from '@/lib/db/routing';

export const ROUTING_SLO_MIN_SUCCESS = 0.99;
export const ROUTING_SLO_MAX_P95_MS = 250;

export interface SloVerdict {
  breached: boolean;
  reasons: string[];
}

export function checkRoutingSLO(rel: RoutingReliability): SloVerdict {
  const reasons: string[] = [];
  if (rel.attempts === 0) {
    return { breached: false, reasons: ['no attempts in window — nothing to judge'] };
  }
  if (rel.success_rate === null || rel.success_rate < ROUTING_SLO_MIN_SUCCESS) {
    reasons.push(`success_rate ${rel.success_rate} < ${ROUTING_SLO_MIN_SUCCESS}`);
  }
  if (rel.p95_latency_ms !== null && rel.p95_latency_ms > ROUTING_SLO_MAX_P95_MS) {
    reasons.push(`p95_latency_ms ${rel.p95_latency_ms} > ${ROUTING_SLO_MAX_P95_MS}`);
  }
  return { breached: reasons.length > 0, reasons };
}
