import { NextRequest, NextResponse } from 'next/server';
import { getUserById, setUserActive } from '@/lib/db/queries';
import { handleApiError } from '@/lib/api-error-handler';
import { checkScimAuth, scimError, scimUser } from '../route';

export const dynamic = 'force-dynamic';

function idParam(params: { id: string | string[] }): number {
  const raw = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

/** GET /api/scim/v2/Users/:id — fetch one. Unknown ids are 404. */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string | string[] } }
) {
  try {
    if (!checkScimAuth(request)) {
      return scimError(401, 'Unauthorized', 'invalidCredentials');
    }
    const id = idParam(params);
    if (!Number.isFinite(id)) return scimError(400, 'Invalid id', 'invalidValue');
    const user = await getUserById(id);
    if (!user) return scimError(404, 'User not found', 'invalidValue');
    return NextResponse.json(scimUser(user as any));
  } catch (err: any) {
    return handleApiError(err, 'scim/v2/Users/:id GET');
  }
}

type PatchOperation = { op: string; path?: string; value?: unknown };

function applyActivePatch(body: any): boolean | undefined | 'invalid' {
  const operations: unknown = body?.Operations;
  if (!Array.isArray(operations) || operations.length === 0) return 'invalid';
  let active: boolean | undefined;
  for (const raw of operations) {
    const o = raw as PatchOperation;
    if (typeof o?.op !== 'string') return 'invalid';
    const op = o.op.toLowerCase();
    if (op === 'replace') {
      const path = (o.path || '').toLowerCase();
      if (path === 'active') {
        if (typeof o.value !== 'boolean') return 'invalid';
        active = o.value;
      } else if (path === '' || path === 'username') {
        // userName renames are ignored (email is the immutable key).
        continue;
      } else {
        return 'invalid';
      }
    } else if (op === 'add' || op === 'remove') {
      return 'invalid';
    } else {
      return 'invalid';
    }
  }
  return active;
}

/**
 * PATCH /api/scim/v2/Users/:id — flip active only:
 * { "Operations": [{ "op": "replace", "path": "active", "value": false }] }.
 * Deactivation revokes API keys and blocks sign-in; reactivation clears the flag.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string | string[] } }
) {
  try {
    if (!checkScimAuth(request)) {
      return scimError(401, 'Unauthorized', 'invalidCredentials');
    }
    const id = idParam(params);
    if (!Number.isFinite(id)) return scimError(400, 'Invalid id', 'invalidValue');
    const user = await getUserById(id);
    if (!user) return scimError(404, 'User not found', 'invalidValue');

    const body = await request.json().catch(() => null);
    const active = applyActivePatch(body);
    if (active === 'invalid') {
      return scimError(400, 'Only replace/active operations are supported', 'invalidValue');
    }
    if (active === undefined) {
      return NextResponse.json(scimUser(user as any));
    }
    const { user: updated } = await setUserActive(user.email, active);
    return NextResponse.json(scimUser((updated || user) as any));
  } catch (err: any) {
    return handleApiError(err, 'scim/v2/Users/:id PATCH');
  }
}

/**
 * PUT /api/scim/v2/Users/:id — full replace (active honored, userName must
 * match the existing email). DELETE — deactivate (SCIM delete semantics:
 * resources are disabled, never hard-deleted, preserving audit history).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string | string[] } }
) {
  try {
    if (!checkScimAuth(request)) {
      return scimError(401, 'Unauthorized', 'invalidCredentials');
    }
    const id = idParam(params);
    if (!Number.isFinite(id)) return scimError(400, 'Invalid id', 'invalidValue');
    const user = await getUserById(id);
    if (!user) return scimError(404, 'User not found', 'invalidValue');

    const body = await request.json().catch(() => null);
    const userName = typeof body?.userName === 'string' ? body.userName.trim().toLowerCase() : null;
    if (userName && userName !== user.email.toLowerCase()) {
      return scimError(400, 'userName is immutable', 'mutability');
    }
    const active = body?.active === undefined ? user.deprovisioned !== true : body.active === true;
    const { user: updated } = await setUserActive(user.email, active);
    return NextResponse.json(scimUser((updated || user) as any));
  } catch (err: any) {
    return handleApiError(err, 'scim/v2/Users/:id PUT');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string | string[] } }
) {
  try {
    if (!checkScimAuth(request)) {
      return scimError(401, 'Unauthorized', 'invalidCredentials');
    }
    const id = idParam(params);
    if (!Number.isFinite(id)) return scimError(400, 'Invalid id', 'invalidValue');
    const user = await getUserById(id);
    if (!user) return scimError(404, 'User not found', 'invalidValue');
    await setUserActive(user.email, false);
    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    return handleApiError(err, 'scim/v2/Users/:id DELETE');
  }
}
