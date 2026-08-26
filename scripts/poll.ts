import { runIngestionCycle } from '../src/lib/ingestion/runner';

async function main() {
  console.log('📡 [AI Model Radar] Starting OpenRouter polling & diffing cycle...');
  const start = Date.now();
  const result = await runIngestionCycle();
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  if (result.success) {
    console.log(`✅ [Ingestion Completed in ${elapsed}s]`);
    console.log(`   - Total Models Polled:   ${result.totalPolled}`);
    console.log(`   - New Models Detected:   ${result.newModels}`);
    console.log(`   - Price Changes:         ${result.priceChanges}`);
    console.log(`   - Free Tier Additions:   ${result.becameFree}`);
    console.log(`   - Free Tier Exits:       ${result.leftFree}`);
    console.log(`   - Context Length Diffs:  ${result.contextChanged}`);
    console.log(`   - Models Delisted:       ${result.removedModels}`);
    console.log(`   - Total Events Emitted:  ${result.totalEventsEmitted}`);
  } else {
    console.error(`❌ [Ingestion Failed after ${elapsed}s]:`, result.error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal polling error:', err);
  process.exit(1);
});
