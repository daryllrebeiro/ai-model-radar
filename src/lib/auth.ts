import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth.config';
import { createOrGetUser, UserRecord } from './db/queries';
import { verifyApiKey } from './api-keys';
import { logger } from './logger';

export interface AuthSession {
  user: UserRecord;
  authMethod: 'session' | 'api_key';
}

/**
 * Resolves the authenticated user from a Next.js request.
 * Priority: NextAuth session cookie > API key Bearer token.
 * X-User-Email header is NOT trusted — it was removed in P11.1.
 */
export async function getSessionUser(request: NextRequest): Promise<AuthSession | null> {
  // 1. NextAuth JWT session cookie (magic link sign-in)
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      const user = await createOrGetUser({ email: session.user.email });
      return { user, authMethod: 'session' };
    }
  } catch (err: any) {
    // AUTH_SECRET not configured or other non-fatal issue — fall through to API key check
    logger.debug(`getSessionUser: getServerSession fallback: ${err.message}`);
  }

  // 2. Bearer API key (machine-to-machine / programmatic access)
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
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
