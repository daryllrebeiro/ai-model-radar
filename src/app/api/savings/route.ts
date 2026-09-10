import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { checkSessionRateLimit, assertPayloadSize } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import { caseStudySchema } from '@/lib/validation/api-schemas';
import { createCaseStudy, listApprovedCaseStudies, listOwnCaseStudies } from '@/lib/db/queries';
import { getUsageImport } from '@/lib/db/queries';
import { trackServerEvent } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

/** GET /api/savings — public leaderboard (approved only, no owner emails). */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    const { searchParams } = new URL(request.url);
    if (searchParams.get('mine') === 'true') {
      if (!session) {
        return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
      }
      const mine = await listOwnCaseStudies(session.user.id);
      return NextResponse.json({ mine });
    }
    const studies = await listApprovedCaseStudies(50);
    return NextResponse.json({ case_studies: studies });
  } catch (err: any) {
    return handleApiError(err, 'savings GET');
  }
}

/**
 * POST /api/savings — opt-in public submission. Double opt-in by design:
 * using R5 privately is NOT consent; this call with consent:true IS the
 * second, per-submission consent. Lands in the moderation queue (pending),
 * never public on write. Spam guard: savings must be > 0 and models differ.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const limited = await checkSessionRateLimit(session.user.id, 'savings-submit');
    if (limited) return limited;
    const tooLarge = assertPayloadSize(request, 32 * 1024);
    if (tooLarge) return tooLarge;

    const body = await request.json().catch(() => null);
    const parsed = caseStudySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid submission', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    const d = parsed.data;
    if (d.from_model_id.toLowerCase() === d.to_model_id.toLowerCase()) {
      return NextResponse.json({ error: 'from_model_id and to_model_id must differ.' }, { status: 400 });
    }
    if (d.savings_usd_per_month <= 0) {
      return NextResponse.json({ error: 'Only real, positive savings are publishable.' }, { status: 400 });
    }
    // usage_import_id, when given, must be the caller's own import —
    // otherwise it is ignored (never another user's data).
    let usageImportId: number | null = null;
    if (d.usage_import_id) {
      const own = await getUsageImport(session.user.id, d.usage_import_id);
      if (own) usageImportId = own.id;
    }
    const study = await createCaseStudy({
      userId: session.user.id,
      ownerEmail: session.user.email,
      teamName: d.team_name,
      fromModelId: d.from_model_id,
      toModelId: d.to_model_id,
      savingsUsdPerMonth: d.savings_usd_per_month,
      periodLabel: d.period_label,
      story: d.story,
      usageImportId,
    });
    trackServerEvent('case_study_submitted');
    return NextResponse.json(
      { id: study.id, status: study.status, message: 'Received — pending moderation before any public listing.' },
      { status: 201 }
    );
  } catch (err: any) {
    return handleApiError(err, 'savings POST');
  }
}
