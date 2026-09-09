import { describe, it, expect } from 'vitest';
import { checkCircuitBreaker, msUntilMonthReset } from '@/lib/spend-breaker';
import type { BudgetRule, BudgetRuleEvaluation } from '@/types/governance';

function rule(overrides: Partial<BudgetRule> = {}): BudgetRule {
  return {
    id: 1,
    name: 'Cap',
    scope: 'personal',
    team_id: null,
    owner_email: 'owner@test.dev',
    monthly_budget_usd: 100,
    alert_threshold_pct: 0.8,
    approval_required: false,
    hard_cap: true,
    notify_email: null,
    active: true,
    ...overrides,
  };
}

function evaluation(
  r: BudgetRule,
  status: 'ok' | 'approaching' | 'over'
): BudgetRuleEvaluation {
  return {
    rule: r,
    projected_monthly_usd: status === 'over' ? 150 : 10,
    pct_used: status === 'over' ? 1.5 : 0.1,
    status,
    family_breakdown: [],
    new_alert: null,
  };
}

describe('checkCircuitBreaker', () => {
  it('trips when an active hard-cap rule is over budget', () => {
    const result = checkCircuitBreaker([evaluation(rule({ id: 7 }), 'over')]);
    expect(result.tripped).toBe(true);
    expect(result.trippedRuleIds).toEqual([7]);
    expect(result.trippedEvaluations).toHaveLength(1);
  });

  it('does not trip for alert-only rules even when over budget', () => {
    const result = checkCircuitBreaker([
      evaluation(rule({ hard_cap: false }), 'over'),
    ]);
    expect(result.tripped).toBe(false);
    expect(result.trippedRuleIds).toEqual([]);
  });

  it('does not trip for inactive hard-cap rules', () => {
    const result = checkCircuitBreaker([
      evaluation(rule({ active: false }), 'over'),
    ]);
    expect(result.tripped).toBe(false);
  });

  it('does not trip on approaching status', () => {
    const result = checkCircuitBreaker([evaluation(rule(), 'approaching')]);
    expect(result.tripped).toBe(false);
  });

  it('trips on any tripped rule in a mixed set', () => {
    const result = checkCircuitBreaker([
      evaluation(rule({ id: 1, hard_cap: false }), 'over'),
      evaluation(rule({ id: 2 }), 'ok'),
      evaluation(rule({ id: 3 }), 'over'),
    ]);
    expect(result.tripped).toBe(true);
    expect(result.trippedRuleIds).toEqual([3]);
  });

  it('returns untripped for empty evaluations', () => {
    expect(checkCircuitBreaker([]).tripped).toBe(false);
  });
});

describe('msUntilMonthReset', () => {
  it('targets the first of next month UTC', () => {
    const now = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    const expected = Date.UTC(2026, 1, 1) - now.getTime();
    expect(msUntilMonthReset(now)).toBe(expected);
  });

  it('wraps December to January of the next year', () => {
    const now = new Date(Date.UTC(2026, 11, 31, 23, 59, 0));
    expect(msUntilMonthReset(now)).toBe(60_000);
  });
});
