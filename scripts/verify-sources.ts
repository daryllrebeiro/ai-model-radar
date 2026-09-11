import { checkSources, DATASET_MAX_AGE_DAYS, DATASET_OWNERS } from '../src/lib/source-verify';

async function main() {
  // P1-6: per-dataset budgets by default (compliance/finetune rot faster).
  // SOURCE_MAX_AGE_DAYS still overrides globally — use deliberately, it
  // weakens the compliance/finetune fuse when set above 180.
  const overrideRaw = process.env.SOURCE_MAX_AGE_DAYS;
  const override = overrideRaw ? Number(overrideRaw) : undefined;
  console.log(
    override !== undefined
      ? `Verifying curated-dataset sources (global override max age ${override}d)...`
      : `Verifying curated-dataset sources (per-dataset ages: ${Object.entries(DATASET_MAX_AGE_DAYS).map(([k, v]) => `${k}=${v}d`).join(', ')})...`
  );
  const { results, failed, warned } = await checkSources(override !== undefined ? { maxAgeDays: override } : {});
  for (const r of results) {
    if (r.verdict !== 'ok') {
      console.log(`[${r.verdict.toUpperCase()}] ${r.dataset} ${r.model_id} :: ${r.source_url} :: ${r.detail} :: age ${r.age_days}d :: owner: ${DATASET_OWNERS[r.dataset]}`);
    }
  }
  console.log(`Checked ${results.length} records: ${results.length - failed - warned} ok, ${warned} warn, ${failed} fail.`);
  if (failed > 0) {
    console.error('Source verification FAILED — re-source failing records or bump ages deliberately.');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Source verification crashed:', err);
  process.exit(1);
});
