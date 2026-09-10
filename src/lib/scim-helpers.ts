import { NextRequest, NextResponse } from 'next/server';
import { secretsEqual } from './secrets';

/**
 * SCIM 2.0 shared helpers (factored out of the route files).
 *
 * Next.js route-type generation requires route.ts modules to export ONLY
 * HTTP handlers + route config — extra exports (checkScimAuth, scimError,
 * scimUser) break `next build` with an OmitWithTag constraint error.
 */
export const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';

/** Bearer SCIM_TOKEN check. Unconfigured token => everything 401 (no config oracle). */
export function checkScimAuth(request: NextRequest): boolean {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return secretsEqual(token, process.env.SCIM_TOKEN || '');
}

export function scimError(status: number, detail: string, scimType = 'invalidValue') {
  return NextResponse.json(
    { schemas: [ERROR_SCHEMA], status: String(status), scimType, detail },
    { status }
  );
}

export function scimUser(row: {
  id: number;
  email: string;
  deprovisioned?: boolean;
  name?: string | null;
}): Record<string, unknown> {
  const active = row.deprovisioned !== true;
  return {
    schemas: [USER_SCHEMA],
    id: String(row.id),
    userName: row.email,
    active,
    emails: [{ value: row.email, primary: true }],
    displayName: row.name || row.email,
    meta: { resourceType: 'User' },
  };
}
