import { checkSources } from '../src/lib/source-verify';

async function main() {
  const maxAgeDays = Number(process.env.SOURCE_MAX_AGE_DAYS || '365');
  console.log(`Verifying curated-dataset sources (max age ${maxAgeDays}d)...`);
  const { results, failed, warned } = await checkSources({ maxAgeDays });
  for (const r of results) {
    if (r.verdict !== 'ok') {
      console.log(`[${r.verdict.toUpperCase()}] ${r.dataset} ${r.model_id} :: ${r.source_url} :: ${r.detail} :: age ${r.age_days}d`);
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
