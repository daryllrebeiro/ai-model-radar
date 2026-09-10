import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { checkSessionRateLimit, assertPayloadSize } from '@/lib/api-auth';
import { handleApiError } from '@/lib/api-error-handler';
import { exportConnectorSchema } from '@/lib/validation/api-schemas';
import { createExportConnector, listExportConnectors } from '@/lib/db/queries';
import { isSecretStorageConfigured } from '@/lib/secret-store';
import { trackServerEvent } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

/** GET /api/exports — own connectors (secrets redacted to has_secret). */
export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const connectors = await listExportConnectors(session.user.id);
    return NextResponse.json({ connectors });
  } catch (err: any) {
    return handleApiError(err, 'exports GET');
  }
}

/** POST /api/exports — register a connector (secret write-only). */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Authenticated session is required' }, { status: 401 });
    }
    const limited = await checkSessionRateLimit(session.user.id, 'exports');
    if (limited) return limited;
    const tooLarge = assertPayloadSize(request, 16 * 1024);
    if (tooLarge) return tooLarge;

    const body = await request.json().catch(() => null);
    const parsed = exportConnectorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid connector', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    // Fail-closed secret storage: without EXPORT_CONNECTOR_KEY there is no
    // encrypted-at-rest option, so secret-bearing connectors are refused
    // rather than persisted in plaintext.
    if (parsed.data.secret && !isSecretStorageConfigured()) {
      return NextResponse.json(
        { error: 'Server is not configured for secret storage (EXPORT_CONNECTOR_KEY). Register without a secret or contact ops.' },
        { status: 400 }
      );
    }
    let connector;
    try {
      connector = await createExportConnector({
        userId: session.user.id,
        ownerEmail: session.user.email,
        name: parsed.data.name,
        type: parsed.data.type,
        destinationUrl: parsed.data.destination_url,
        secret: parsed.data.secret,
      });
    } catch (err: any) {
      return NextResponse.json({ error: err.message || 'Secret storage failed.' }, { status: 400 });
    }
    trackServerEvent('export_connector_created');
    return NextResponse.json({ connector }, { status: 201 });
  } catch (err: any) {
    return handleApiError(err, 'exports POST');
  }
}
