import { NextRequest, NextResponse } from 'next/server';
import {
  createOrGetUser,
  getUserByEmail,
  getAllUsers,
  setUserActive,
} from '@/lib/db/queries';
import { handleApiError } from '@/lib/api-error-handler';
import { LIST_SCHEMA, checkScimAuth, scimError, scimUser } from '@/lib/scim-helpers';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_COUNT = 100;

function extractEmail(body: any): string | null {
  if (typeof body?.userName === 'string' && EMAIL_RE.test(body.userName.trim())) {
    return body.userName.trim().toLowerCase();
  }
  const emails = Array.isArray(body?.emails) ? body.emails : [];
  const primary = emails.find((e: any) => e?.primary) || emails[0];
  if (primary && typeof primary.value === 'string' && EMAIL_RE.test(primary.value.trim())) {
    return primary.value.trim().toLowerCase();
  }
  return null;
}

/** null = no filter given; undefined = unsupported filter expression. */
function parseUserNameFilter(filter: string | null): string | null | undefined {
  if (!filter) return null;
  // Only the exact-match form IdPs use for lookups: userName eq "a@b.c".
  const m = /^\s*userName\s+eq\s+"([^"]+)"\s*$/i.exec(filter);
  return m ? m[1].trim().toLowerCase() : undefined;
}

/**
 * GET /api/scim/v2/Users?filter=userName eq "a@b.c"&startIndex=1&count=20
 * SCIM 2.0 list (Okta/Entra provisioning). Token: SCIM_TOKEN.
 */
export async function GET(request: NextRequest) {
  try {
    if (!checkScimAuth(request)) {
      return scimError(401, 'Unauthorized', 'invalidCredentials');
    }
    const params = new URL(request.url).searchParams;
    const filterRaw = params.get('filter');
    let users = await getAllUsers(5000);

    if (filterRaw) {
      const wanted = parseUserNameFilter(filterRaw);
      if (wanted === undefined) {
        return scimError(400, 'Only userName eq "email" filters are supported', 'invalidFilter');
      }
      if (wanted !== null) {
        users = users.filter((u) => u.email.toLowerCase() === wanted);
      }
    }

    const startIndex = Math.max(1, Number(params.get('startIndex') || '1') || 1);
    const count = Math.min(MAX_COUNT, Math.max(1, Number(params.get('count') || '20') || 20));
    const page = users.slice(startIndex - 1, startIndex - 1 + count);

    return NextResponse.json({
      schemas: [LIST_SCHEMA],
      totalResults: users.length,
      startIndex,
      itemsPerPage: page.length,
      Resources: page.map((u) => scimUser(u as any)),
    });
  } catch (err: any) {
    return handleApiError(err, 'scim/v2/Users GET');
  }
}

/**
 * POST /api/scim/v2/Users — provision. { userName, emails?, active? }.
 * Existing email => 409 (SCIM servers then PUT/PATCH the id they discover
 * via the filter query). active:false provisions deprovisioned directly.
 */
export async function POST(request: NextRequest) {
  try {
    if (!checkScimAuth(request)) {
      return scimError(401, 'Unauthorized', 'invalidCredentials');
    }
    const body = await request.json().catch(() => null);
    const email = extractEmail(body);
    if (!email) {
      return scimError(400, 'userName (email) is required', 'invalidValue');
    }
    const existing = await getUserByEmail(email);
    if (existing) {
      return scimError(409, 'User already exists', 'uniqueness');
    }
    const active = body?.active === undefined ? true : body.active === true;
    const created = await createOrGetUser({ email });
    if (!active) {
      await setUserActive(email, false);
    }
    const row = (await getUserByEmail(email)) || created;
    return NextResponse.json(scimUser(row as any), {
      status: 201,
      headers: { Location: `/api/scim/v2/Users/${row.id}` },
    });
  } catch (err: any) {
    return handleApiError(err, 'scim/v2/Users POST');
  }
}
