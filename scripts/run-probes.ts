import { runEndpointProbes, evaluateEndpointHealth } from '../src/lib/probe';
import { getLatestSnapshotsMap } from '../src/lib/db/queries';
import { logger } from '../src/lib/logger';

async function main() {
  console.log('📡 [AI Model Radar] Starting endpoint probe cycle...');
  const start = Date.now();
  // Feed the tracked catalog in: bare runEndpointProbes() with no snapshots
  // resolves zero targets, so the scheduled worker must pass them explicitly.
  const snapshots = Array.from((await getLatestSnapshotsMap()).values());
  const result = await runEndpointProbes({ snapshots });
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  if (result.probed > 0) {
    console.log(`✅ [Probe Cycle Completed in ${elapsed}s]`);
    console.log(`   - Endpoints Probed:       ${result.probed}`);
    console.log(`   - Healthy:                ${result.healthy}`);
    console.log(`   - Degraded:               ${result.degraded}`);
    console.log(`   - Down:                   ${result.down}`);
    console.log(`   - Records Persisted:      ${result.saved}`);
    if (result.down > 0 || result.degraded > 0) {
      for (const record of result.records) {
        const { status, reasons } = evaluateEndpointHealth(record);
        if (status !== 'healthy') {
          console.log(`   - [${status.toUpperCase()}] ${record.model_id}: ${reasons.join('; ')}`);
        }
      }
    }
  } else {
    console.log('⚠️  No probe targets resolved — no known provider endpoints configured.');
  }

  logger.info('Endpoint probe cycle finished', {
    probed: result.probed,
    healthy: result.healthy,
    degraded: result.degraded,
    down: result.down,
    runId: result.runId,
  });
}

main().catch((err) => {
  console.error('Fatal probe error:', err);
  process.exit(1);
});