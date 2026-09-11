/**
 * P3 usage-based billing metering (offline aggregation).
 *
 * Pure rollup over existing telemetry (routing attempts, digest deliveries)
 * into billable metrics. No Stripe calls here — live metered billing stays
 * behind STRIPE_ENABLED and is a separate integration; this module is the
 * aggregation job's math, unit-tested without credentials.
 */

export interface MeteredAttempt {
  policy: string;
  success: boolean;
  latency_ms: number | null;
}

export interface BillableMetrics {
  window: string;
  proxied_calls: number;
  successful_proxied_calls: number;
  failed_proxied_calls: number;
  by_policy: Record<string, number>;
  digest_deliveries: number;
  billable_units: number;
}

export const PROXIED_CALL_WEIGHT = 1;
export const DIGEST_DELIVERY_WEIGHT = 0.1;

/** Rolls routing attempts + delivery counts into billable units. */
export function meterUsage(input: {
  window: string;
  attempts: MeteredAttempt[];
  digestDeliveries?: number;
}): BillableMetrics {
  const byPolicy: Record<string, number> = {};
  let successful = 0;
  for (const a of input.attempts) {
    const p = a.policy || 'explicit';
    byPolicy[p] = (byPolicy[p] || 0) + 1;
    if (a.success) successful++;
  }
  const deliveries = Math.max(0, Math.floor(input.digestDeliveries ?? 0));
  const billable = Math.round(
    (input.attempts.length * PROXIED_CALL_WEIGHT + deliveries * DIGEST_DELIVERY_WEIGHT) * 100
  ) / 100;
  return {
    window: input.window,
    proxied_calls: input.attempts.length,
    successful_proxied_calls: successful,
    failed_proxied_calls: input.attempts.length - successful,
    by_policy: byPolicy,
    digest_deliveries: deliveries,
    billable_units: billable,
  };
}
