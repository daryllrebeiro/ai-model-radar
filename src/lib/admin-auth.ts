import { NextRequest, NextResponse } from 'next/server';
import { secretsEqual } from '@/lib/secrets';
import { logAuthDenied } from '@/lib/api-auth';

/** Shared ADMIN_SECRET gate for moderation endpoints (constant-time, fail-closed). */
export function checkAdminSecret(request: NextRequest, routeName: string): NextResponse | null {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    logAuthDenied(routeName, request, 'secret-unset');
    return NextResponse.json({ error: 'Admin authentication not configured.' }, { status: 401 });
  }
  const authHeader = request.headers.get('authorization');
  const secretHeader = request.headers.get('x-admin-secret');
  const ok =
    secretsEqual(authHeader, `Bearer ${adminSecret}`) || secretsEqual(secretHeader, adminSecret);
  if (!ok) {
    logAuthDenied(routeName, request, 'bad-secret');
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  return null;
}
