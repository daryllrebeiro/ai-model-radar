import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api-error-handler';
import { checkAdminSecret } from '@/lib/admin-auth';
import { reencryptAllConnectorSecrets } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/exports/reencrypt — re-encrypt all connector secrets
 * with the current key ring. ADMIN_SECRET required.
 * Returns { reencrypted, failed[] }.
 */
export async function POST(request: NextRequest) {
  try {
    const denied = checkAdminSecret(request, 'admin/exports/reencrypt');
    if (denied) return denied;

    const result = await reencryptAllConnectorSecrets();
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return handleApiError(err, 'admin/exports/reencrypt POST');
  }
}