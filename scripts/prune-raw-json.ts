import { pruneOldRawJson } from '../src/lib/db/queries';
import { logger } from '../src/lib/logger';

async function main() {
  const days = process.env.PRUNE_DAYS ? parseInt(process.env.PRUNE_DAYS, 10) : 30;
  logger.info(`Starting raw JSON pruning job for snapshots older than ${days} days...`);

  try {
    const result = await pruneOldRawJson(days);
    logger.info(`Successfully pruned raw_json from ${result.prunedCount} older snapshots.`);
    process.exit(0);
  } catch (error: any) {
    logger.error('Failed to execute raw JSON pruning job:', { error: error.message || String(error) });
    process.exit(1);
  }
}

main();
