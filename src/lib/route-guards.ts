import { NextRequest, NextResponse } from 'next/server';
import { validatePublicApiRequest, assertPayloadSize } from './api-auth';

/**
 * P1-5 — shared public-route guards. Every public read/compute route opens
 * with the same two lines (throttle, then optional pre-parse size cap) so
 * the seventh route can't drift: wrong order or a missing guard is a
 * one-line diff, not a rediscovered audit finding (H1/H2).
 *
 * Order is load-bearing: auth/rate-limit BEFORE body parsing (an
 * unauthenticated caller must never trigger expensive parse work), and the
 * size cap BEFORE request.json() (Next.js parses synchronously).
 */
export function withPublicGuards<Args extends unknown[]>(
  handler: (request: NextRequest, ...args: Args) => Promise<NextResponse> | NextResponse,
  opts: { maxBytes?: number } = {}
): (request: NextRequest, ...args: Args) => Promise<NextResponse> {
  return async (request: NextRequest, ...args: Args) => {
    const auth = await validatePublicApiRequest(request);
    if (!auth.allowed && auth.errorResponse) {
      return auth.errorResponse;
    }
    if (opts.maxBytes !== undefined) {
      const tooLarge = assertPayloadSize(request, opts.maxBytes);
      if (tooLarge) return tooLarge as NextResponse;
    }
    return handler(request, ...args);
  };
}
