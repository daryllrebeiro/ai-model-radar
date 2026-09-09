import { NextRequest, NextResponse } from 'next/server';
import { requireFeature } from '@/lib/access-guard';
import { checkSessionRateLimit } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import { getShadowFindings } from '@/lib/db/queries';
import { runShadowDiscovery } from '@/lib/shadow-discovery';
import { ShadowFindingStatus } from '@/types/governance';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: ShadowFindingStatus[] = ['open', 'acknowledged', 'dismissed'];

/**
 * GET /api/v1/governance/shadow-ai — list caller-visible Shadow-AI findings.
 * Optional ?status=open|acknowledged|dismissed filter.
 */
export async function GET(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'governance');
    if (limited) return limited;

    const statusParam = new URL(request.url).searchParams.get('status');
    let status: ShadowFindingStatus | undefined;
    if (statusParam !== null) {
      if (!VALID_STATUSES.includes(statusParam as ShadowFindingStatus)) {
        return NextResponse.json(
          { error: 'status must be one of open, acknowledged, dismissed' },
          { status: 400 }
        );
      }
      status = statusParam as ShadowFindingStatus;
    }

    const findings = await getShadowFindings({ email: session.user.email, status });
    return NextResponse.json({ findings, count: findings.length });
  } catch (err: any) {
    return handleApiError(err, 'governance/shadow-ai GET');
  }
}

/**
 * POST /api/v1/governance/shadow-ai — run discovery across the caller's
 * personal + team scopes, persist findings, emit deduplicated alerts.
 * Optional body: { approved_model_ids: string[] } allowlist.
 */
export async function POST(request: NextRequest) {
  try {
    const { session, error } = await requireFeature(request, 'GOVERNANCE');
    if (error) return error;

    const limited = await checkSessionRateLimit(session.user.id, 'governance');
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const raw = body?.approved_model_ids;
    const approved: string[] = Array.isArray(raw)
      ? raw.filter((m: unknown) => typeof m === 'string').map((m: string) => m.trim()).filter(Boolean).slice(0, 500)
      : [];

    const result = await runShadowDiscovery(session.user.email, approved);
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err, 'governance/shadow-ai POST');
  }
}
