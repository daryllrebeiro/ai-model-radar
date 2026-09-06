import { normalizeAllUserTiers } from '../src/lib/db/queries';
import { logger } from '../src/lib/logger';

/**
 * One-time backfill: normalize every user row to the canonical
 * free/pro/enterprise tier vocabulary (see migrations/007_* for Postgres).
 *
 * Works in both persistence modes via the query layer. Idempotent.
 * Run with: npx tsx scripts/backfill-tiers.ts
 */
async function main() {
  try {
    const { checked, updated } = await normalizeAllUserTiers();
    logger.info(`Tier backfill complete: checked ${checked} users, updated ${updated.length}.`);
    for (const line of updated) {
      logger.info(`  ${line}`);
    }
    process.exit(0);
  } catch (err: any) {
    logger.error('Tier backfill failed:', { error: err.message || String(err) });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
