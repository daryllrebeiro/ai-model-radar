import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { recordDriftCandidates, listDriftReviews, decideDriftReview } from '../src/lib/db/queries';
import { GET as driftGET, POST as driftPOST } from '../src/app/api/v1/drift-reviews/route';
import { DriftDiff } from '../src/types/active-probe';

function diff(candidate: boolean): DriftDiff {
  const base = {
    model_id: `dq/m-${Date.now()}`,
    prompt_id: 'factual-qa-capital',
    previous: { model_id: '', prompt_id: '', prompt_version: 1, output: 'Paris', ttft_ms: 100, tokens_per_sec: 50, sampled_at: '' },
    current: { model_id: '', prompt_id: '', prompt_version: 1, output: candidate ? 'Lyon entirely' : 'Paris', ttft_ms: 100, tokens_per_sec: 50, sampled_at: '' },
    diff_lines: candidate ? ['- Paris', '+ Lyon entirely'] : ['  Paris'],
    changed_lines: candidate ? 1 : 0,
    total_lines: 1,
    candidate_for_review: candidate,
  };
  base.previous.model_id = base.model_id;
  base.previous.prompt_id = base.prompt_id;
  base.current.model_id = base.model_id;
  base.current.prompt_id = base.prompt_id;
  return base as DriftDiff;
}

describe('P3 drift review queue (evidence in, human verdict out)', () => {
  it('stores candidates with full evidence; drops non-candidates', async () => {
    const cycle = `dq-${Date.now()}`;
    const n = await recordDriftCandidates(cycle, [diff(true), diff(false)]);
    expect(n).toBe(1);
    const pending = await listDriftReviews('pending');
    const mine = pending.filter((r) => r.cycle_id === cycle);
    expect(mine).toHaveLength(1);
    expect(mine[0].prev_output).toBe('Paris');
    expect(mine[0].diff_lines.join('\n')).toContain('Lyon');
  });

  it('decision requires reviewer identity; double-decide conflicts', async () => {
    const cycle = `dq2-${Date.now()}`;
    await recordDriftCandidates(cycle, [diff(true)]);
    const mine = (await listDriftReviews('pending')).filter((r) => r.cycle_id === cycle);
    await expect(decideDriftReview(mine[0].id!, 'confirmed', '')).rejects.toThrow(/identity/);
    expect(await decideDriftReview(mine[0].id!, 'confirmed', 'reviewer@test.dev')).toBe(true);
    expect(await decideDriftReview(mine[0].id!, 'dismissed', 'reviewer@test.dev')).toBe(false);
  });

  it('GET lists with evidence note; POST without session is 401', async () => {
    const res = await driftGET(new NextRequest('http://localhost/api/v1/drift-reviews?status=pending'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.evidence_note.toLowerCase()).toContain('human');
    const post = await driftPOST(
      new NextRequest('http://localhost/api/v1/drift-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 1, decision: 'confirmed' }),
      })
    );
    expect(post.status).toBe(401);
  });
});
