import { NextRequest } from 'next/server';
import { getUserByEmail, createOrGetUser, UserRecord } from './db/queries';
import { verifyApiKey } from './api-keys';

export interface AuthSession {
  user: UserRecord;
  authMethod: 'session' | 'api_key';
}

/**
 * Extracts and resolves current authenticated user from Next.js request.
 * Supports Bearer token / header email / API key auth.
 */
export async function getSessionUser(request: NextRequest): Promise<AuthSession | null> {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  const userEmailHeader = request.headers.get('x-user-email') || request.headers.get('X-User-Email');

  // 1. Direct user session email header (from edge middleware / auth proxy)
  if (userEmailHeader) {
    const user = await createOrGetUser({ email: userEmailHeader });
    return { user, authMethod: 'session' };
  }

  // 2. Bearer API key or Token
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token.startsWith('amr_live_')) {
      const verification = await verifyApiKey(token);
      if (verification.valid && verification.record?.owner_email) {
        const user = await createOrGetUser({
          email: verification.record.owner_email,
          tier: verification.tier,
        });
        return { user, authMethod: 'api_key' };
      }
    }
  }

  return null;
}
