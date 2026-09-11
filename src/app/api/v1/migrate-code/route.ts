import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { transformCode } from '@/lib/migration-codegen';
import { MIGRATION_BEHAVIORAL_CAVEAT, SUPPORTED_PAIRS } from '@/types/migration-codegen';
import { validatePublicApiRequest, assertPayloadSize } from '@/lib/api-auth';

/**
 * S8 — Suggested diff only. No repo writes, no PR creation. Unsupported
 * pairs refuse loudly instead of guessing.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  code: z.string().min(1).max(20000),
  source_provider: z.string().min(1).max(100),
  target_provider: z.string().min(1).max(100),
  target_model: z.string().min(1).max(200),
  target_base_url: z.string().url().max(300).optional(),
});

export async function POST(request: NextRequest) {
  // Audit H1+H2: throttle + reject oversized bodies BEFORE parsing.
  const auth = await validatePublicApiRequest(request);
  if (!auth.allowed && auth.errorResponse) {
    return auth.errorResponse;
  }
  const tooLarge = assertPayloadSize(request, 256 * 1024);
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
  const result = transformCode(parsed.data);
  if (!result) {
    return NextResponse.json(
      {
        error: 'Unsupported',
        message: `Unsupported provider pair "${parsed.data.source_provider}" → "${parsed.data.target_provider}". Supported: ${SUPPORTED_PAIRS.join(', ')}.`,
        supported_pairs: SUPPORTED_PAIRS,
      },
      { status: 422 }
    );
  }
  return NextResponse.json({
    version: 'v1',
    review_only: true,
    caveat: MIGRATION_BEHAVIORAL_CAVEAT,
    ...result,
  });
}
