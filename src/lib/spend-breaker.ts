/**
 * Spend Circuit Breaker engine (pure): decides whether proxied Radar Router
 * calls must be blocked because a hard-cap budget rule is over 100% spend.
 *
 * A rule trips the breaker only when ALL hold:
 *  - rule.active is true
 *  - rule.hard_cap is true (alert-only rules never block)
 *  - evaluation.status is 'over' (projected spend >= 100% of budget)
 */

import type { BudgetRuleEvaluation } from '@/types/governance';

export interface BreakerResult {
  /** True when at least one hard-cap rule is over budget. */
  tripped: boolean;
  /** The over-budget hard-cap evaluations causing the trip. */
  trippedEvaluations: BudgetRuleEvaluation[];
  /** Rule ids that tripped, for the 429 response body. */
  trippedRuleIds: number[];
}

export function checkCircuitBreaker(evaluations: BudgetRuleEvaluation[]): BreakerResult {
  const trippedEvaluations = evaluations.filter(
    (e) => e.rule.active && e.rule.hard_cap === true && e.status === 'over'
  );
  const trippedRuleIds = trippedEvaluations
    .map((e) => e.rule.id)
    .filter((id): id is number => typeof id === 'number');
  return {
    tripped: trippedEvaluations.length > 0,
    trippedEvaluations,
    trippedRuleIds,
  };
}

/**
 * Milliseconds until the next calendar-month boundary (UTC), used as the
 * Retry-After basis for 429 spend-breaker rejections: caps reset monthly.
 */
export function msUntilMonthReset(now: Date = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return Math.max(0, next.getTime() - now.getTime());
}
