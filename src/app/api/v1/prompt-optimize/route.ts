import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { optimizePrompt } from '@/lib/prompt-optimizer';
import { recordMetric } from '@/lib/db/queries';
import { withPublicGuards } from '@/lib/route-guards';

/**
 * S3 — Prompt-cost optimizer. SESSION-ONLY: the request body is analyzed in
 * memory and never persisted, never logged, never used to tune anything.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  system_prompt: z.string().min(1).max(20000),
  example_turns: z.array(z.string().max(20000)).max(20).optional().default([]),
  target_model_id: z.string().trim().min(1).max(200),
});

export const POST = withPublicGuards(async (request: NextRequest) => {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad Request', message: 'Invalid JSON.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Bad Request', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 }
    );
  }
  const result = optimizePrompt(parsed.data);
  // Fire-and-forget success metric (N1 sink); content itself stays session-only.
  void recordMetric('s3.optimize.completed');
  const res = NextResponse.json({
    version: 'v1',
    privacy: 'Session-only: submitted prompt content is not persisted, not logged, and not used to improve shared heuristics.',
    ...result,
  });
  // Defense-in-depth: never cache optimizer responses at the edge.
  res.headers.set('Cache-Control', 'no-store');
  return res;
}, { maxBytes: 256 * 1024 });
