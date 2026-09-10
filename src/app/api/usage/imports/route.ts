import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { checkSessionRateLimit, assertPayloadSize } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import { usageImportSchema } from '@/lib/validation/api-schemas';
import { parseUsageCsv } from '@/lib/usage-import';
import { createUsageImport, listUsageImports } from '@/lib/db/queries';
import { trackServerEvent } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

/** GET /api/usage/imports — caller's own import history (no row contents). */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const items = await listUsageImports(session.user.id);
    return NextResponse.json({ imports: items });
  } catch (err: any) {
    return handleApiError(err, 'usage/imports GET');
  }
}

/**
 * POST /api/usage/imports — upload a provider usage CSV.
 * Authenticated, strictly scoped to the uploader, user-deletable, and never
 * used in aggregates. Upload completion is counted (R5 success metric)
 * without any spend contents.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const limited = await checkSessionRateLimit(session.user.id, 'usage-imports');
    if (limited) return limited;
    const tooLarge = assertPayloadSize(request, 2 * 1024 * 1024 + 64 * 1024);
    if (tooLarge) return tooLarge;

    const body = await request.json().catch(() => null);
    const parsed = usageImportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid upload', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    let agg;
    try {
      agg = parseUsageCsv(parsed.data.csv);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || 'Unparseable CSV.' }, { status: 400 });
    }
    const record = await createUsageImport({
      userId: session.user.id,
      ownerEmail: session.user.email,
      filename: parsed.data.filename || '',
      periodStart: parsed.data.period_start || null,
      periodEnd: parsed.data.period_end || null,
      rows: agg.rows,
      totalSpendUsd: agg.total_spend_usd,
    });
    trackServerEvent('usage_import_completed');
    return NextResponse.json(
      {
        id: record.id,
        row_count: record.row_count,
        total_spend_usd: record.total_spend_usd,
        cost_estimated: agg.cost_estimated,
        retention:
          'Stored privately for your account only. Delete anytime via DELETE /api/usage/imports/[id]. Never shared or aggregated without separate explicit consent.',
      },
      { status: 201 }
    );
  } catch (err: any) {
    return handleApiError(err, 'usage/imports POST');
  }
}
