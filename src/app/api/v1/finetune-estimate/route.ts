import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { estimateBuildVsBuy } from '@/lib/finetuning';
import { FINETUNE_QUALITY_DISCLAIMER } from '@/types/finetuning';
import { validatePublicApiRequest, assertPayloadSize } from '@/lib/api-auth';

/**
 * S6 — Build-vs-buy estimator. Cost-only; quality parity is explicitly
 * disclaimed on every response.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  monthly_prompt_tokens: z.number().int().min(0).max(1_000_000_000_000),
  monthly_comp_tokens: z.number().int().min(0).max(1_000_000_000_000),
  training_tokens: z.number().int().min(0).max(1_000_000_000_000),
  large_model_id: z.string().trim().min(1).max(200),
  small_model_id: z.string().trim().min(1).max(200),
});

export async function POST(request: NextRequest) {
  // Audit H1: throttle compute-heavy POST like other public writes.
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }
  const tooLarge = assertPayloadSize(request);
  if (tooLarge) return tooLarge;
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
  const estimate = estimateBuildVsBuy(parsed.data);
  if (!estimate) {
    return NextResponse.json(
      { error: 'Unprocessable', message: 'Missing tracked pricing for one or both models. Only sourced pricing is used — no guessed rates.' },
      { status: 422 }
    );
  }
  return NextResponse.json({ version: 'v1', disclaimer: FINETUNE_QUALITY_DISCLAIMER, estimate });
}
