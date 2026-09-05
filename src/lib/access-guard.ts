import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSessionUser, AuthSession } from './auth';
import { authOptions } from './auth.config';
import { hasAccess, AccessTier, FeatureKey, FEATURES } from './feature-flags';

/**
 * Set FEATURE_ENFORCEMENT=true to enable tier-based access control.
 * Until Stripe billing is live, enforcement stays off so all tiers are
 * accessible — the guard still requires an authenticated session and is
 * fully tested so flipping the flag activates gating everywhere at once.
 */
function isFeatureEnforcementEnabled(): boolean {
  return process.env.FEATURE_ENFORCEMENT === 'true';
}

/**
 * Resolves the effective tier for UI feature gating on server-rendered pages.
 * While enforcement is off, every feature is granted; when enforcement is on,
 * the signed-in user's tier (default free) is honored.
 */
export async function getPageFeatureTier(): Promise<AccessTier> {
  let baseTier: AccessTier = 'free';
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      baseTier = ((session.user as any).tier || 'free') as AccessTier;
    }
  } catch {
    // no session context — treat as free
  }
  return isFeatureEnforcementEnabled() ? baseTier : 'enterprise';
}

export interface AccessGuardResult {
  session: AuthSession;
  error?: NextResponse;
}

/**
 * Server-side guard: verifies the request has a valid session AND the
 * user's tier grants access to the requested feature.
 *
 * Usage in route handlers:
 *   const { session, error } = await requireFeature(request, 'COST_OPTIMIZER');
 *   if (error) return error;
 *   // session.user is guaranteed to exist with valid tier
 */
export async function requireFeature(
  request: NextRequest,
  feature: FeatureKey
): Promise<AccessGuardResult> {
  const session = await getSessionUser(request);

  if (!session) {
    return {
      session: null as any,
      error: NextResponse.json(
        { error: 'Authentication required', feature: FEATURES[feature].key, upgrade: '/pricing' },
        { status: 401 }
      ),
    };
  }

  if (isFeatureEnforcementEnabled()) {
    const userTier = (session.user.tier || 'free') as AccessTier;

    if (!hasAccess(userTier, feature)) {
      return {
        session,
        error: NextResponse.json(
          {
            error: 'Upgrade required',
            feature: FEATURES[feature].key,
            requiredTier: FEATURES[feature].minTier,
            currentTier: userTier,
            upgrade: '/pricing',
          },
          { status: 403 }
        ),
      };
    }
  }

  return { session, error: undefined };
}
