/**
 * governance.ts — compatibility barrel (P0 god-module remediation, first cut).
 *
 * The former 831-line module is now split per domain; this file only
 * re-exports so existing '@/lib/db/queries' importers keep working.
 * New code should import from the domain module directly:
 *
 *   governance/rules.ts      budget rules (personal/team guardrails)
 *   governance/alerts.ts     budget alert emissions log
 *   governance/shadow.ts     shadow-AI discovery feed
 *   governance/approvals.ts  migration approvals + quorum voting
 */
export * from './governance/rules';
export * from './governance/alerts';
export * from './governance/shadow';
export * from './governance/approvals';
