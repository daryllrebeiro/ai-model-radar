import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { checkSessionRateLimit, assertPayloadSize } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import { compoundRuleSchema } from '@/lib/validation/api-schemas';
import { validateCompoundRule } from '@/lib/compound-rules';
import { createCompoundRule, listCompoundRules } from '@/lib/db/queries';
import { trackServerEvent } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

/** GET /api/alerts/compound — caller's own compound rules. */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const rules = await listCompoundRules(session.user.id);
    return NextResponse.json({ rules });
  } catch (err: any) {
    return handleApiError(err, 'alerts/compound GET');
  }
}

/** POST /api/alerts/compound — create a compound rule (fixed condition set only). */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const limited = await checkSessionRateLimit(session.user.id, 'alerts-compound');
    if (limited) return limited;
    const tooLarge = assertPayloadSize(request, 32 * 1024);
    if (tooLarge) return tooLarge;

    const body = await request.json().catch(() => null);
    const parsed = compoundRuleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid rule', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    // Email destinations must be emails; webhook destinations must be URLs.
    if (parsed.data.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data.destination)) {
      return NextResponse.json({ error: 'Email channel requires an email destination.' }, { status: 400 });
    }
    if (parsed.data.channel === 'webhook' && !/^https?:\/\//.test(parsed.data.destination)) {
      return NextResponse.json({ error: 'Webhook channel requires an http(s) destination.' }, { status: 400 });
    }
    const violations = validateCompoundRule(parsed.data);
    if (violations.length > 0) {
      return NextResponse.json({ error: 'Invalid rule', details: violations }, { status: 400 });
    }
    const rule = await createCompoundRule({
      userId: session.user.id,
      ownerEmail: session.user.email,
      name: parsed.data.name,
      logic: parsed.data.logic,
      conditions: parsed.data.conditions,
      channel: parsed.data.channel,
      destination: parsed.data.destination,
    });
    trackServerEvent('compound_rule_created');
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'alerts/compound POST');
  }
}
