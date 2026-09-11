import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listDriftReviews, decideDriftReview, recordMetric, DriftReviewStatus } from '@/lib/db/queries';
import { withPublicGuards } from '@/lib/route-guards';
import { getSessionUser } from '@/lib/auth';
import { checkSessionRateLimit, logAuthDenied } from '@/lib/api-auth';
import { DRIFT_EVIDENCE_NOTE } from '@/types/active-probe';

/**
 * P3 — drift review queue. GET lists candidates WITH before/after evidence
 * (public, throttled). POST records a reviewer decision (session-authed:
 * deciding drift attribution is a privileged write, unlike reading).
 */
export const dynamic = 'force-dynamic';

export const GET = withPublicGuards(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('status');
  const status: DriftReviewStatus | undefined =
    raw === 'pending' || raw === 'confirmed' || raw === 'dismissed' ? raw : undefined;
  const reviews = await listDriftReviews(status);
  return NextResponse.json({ version: 'v1', evidence_note: DRIFT_EVIDENCE_NOTE, reviews });
});

const decideSchema = z.object({
  id: z.number().int().positive(),
  decision: z.enum(['confirmed', 'dismissed']),
});

export async function POST(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) {
    logAuthDenied('drift-reviews', request, 'no-session');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const limited = await checkSessionRateLimit(session.user.id, 'drift-review', { limit: 30 });
  if (limited) return limited;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad Request', message: 'Invalid JSON.' }, { status: 400 });
  }
  const parsed = decideSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad Request', message: 'Requires {id, decision: confirmed|dismissed}.' }, { status: 400 });
  }
  const ok = await decideDriftReview(parsed.data.id, parsed.data.decision, session.user.email);
  if (!ok) {
    return NextResponse.json({ error: 'Conflict', message: 'Review not found or already decided.' }, { status: 409 });
  }
  await recordMetric('drift.review.decided');
  return NextResponse.json({ version: 'v1', decided: true, ...parsed.data });
}
