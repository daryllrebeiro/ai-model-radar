import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { recordMetric, getMetricSums, METRIC_NAMES } from '../src/lib/db/queries';
import { POST as finetunePOST } from '../src/app/api/v1/finetune-estimate/route';

describe('N1 metric sink (fire-and-forget success counts)', () => {
  it('registry covers the four counted surfaces', () => {
    expect([...METRIC_NAMES].sort()).toEqual(
      ['drift.review.decided', 's3.optimize.completed', 's6.estimate.completed', 's8.codegen.completed'].sort()
    );
  });

  it('records and sums per name (both backends)', async () => {
    const tag = `n1test-${Date.now()}`;
    const before = (await getMetricSums(new Date(Date.now() - 1000).toISOString()))[tag] || 0;
    expect(before).toBe(0);
    await recordMetric('s6.estimate.completed');
    const sums = await getMetricSums(new Date(Date.now() - 60_000).toISOString());
    expect(sums['s6.estimate.completed']).toBeGreaterThanOrEqual(1);
  });

  it('estimator success emits its completion metric', async () => {
    const before = (await getMetricSums(new Date(Date.now() - 60_000).toISOString()))['s6.estimate.completed'] || 0;
    const res = await finetunePOST(
      new NextRequest('http://localhost/api/v1/finetune-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthly_prompt_tokens: 10_000_000,
          monthly_comp_tokens: 2_000_000,
          training_tokens: 5_000_000,
          large_model_id: 'openai/gpt-4o',
          small_model_id: 'openai/gpt-4o-mini',
        }),
      })
    );
    expect(res.status).toBe(200);
    // Local backend writes synchronously inside recordMetric; allow one tick for PG.
    await new Promise((r) => setTimeout(r, 50));
    const after = (await getMetricSums(new Date(Date.now() - 60_000).toISOString()))['s6.estimate.completed'] || 0;
    expect(after).toBeGreaterThan(before);
  });

  it('metric failure never breaks callers (invalid value is a no-op)', async () => {
    await expect(recordMetric('s6.estimate.completed', 1.5)).resolves.toBeUndefined();
  });
});
