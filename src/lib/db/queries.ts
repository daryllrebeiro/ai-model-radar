/**
 * queries.ts — compatibility barrel (god-module remediation complete).
 *
 * The former 3,180-line god module is now split per domain; this file only
 * re-exports so the ~68 existing '@/lib/db/queries' importers keep working.
 * New code should import from the domain module directly:
 *
 *   _shared.ts    bulkInsert, Queryable, BULK_CHUNK_ROWS
 *   catalog.ts    snapshots, model directory, detail, history, deals, stats
 *   users.ts      identity, tiers, lifecycle, Stripe dedupe, SSO
 *   events.ts     bounded event reads (keyset pagination)
 *   ingestion.ts  bulk writers, poll transaction, run ledger, pruning
 *   api-keys.ts   key rows (issue/lookup/touch/revoke)
 *   alerts.ts     alert rules, rule status, digest audit log
 *   watchlists.ts per-user watchlists, GDPR export/delete
 *   teams.ts      workspaces, memberships, shared watchlists
 *   profiles.ts   advisor usage profiles
 *   telemetry.ts  endpoint probe telemetry
 *   governance.ts budgets, shadow-AI, approvals/quorum
 *   dlq.ts        webhook dead-letter queue
 *   evals.ts      BYO eval harness runs
 *   eol.ts        model end-of-life registry
 */
export * from './_shared';
export * from './catalog';
export * from './users';
export * from './events';
export * from './ingestion';
export * from './api-keys';
export * from './alerts';
export * from './watchlists';
export * from './teams';
export * from './profiles';
export * from './telemetry';
export * from './governance';
export * from './dlq';
export * from './evals';
export * from './eol';
export * from './usage-imports';
export * from './retention';
export * from './compound-rules';
export * from './case-studies';
export * from './export-connectors';
export * from './routing';
