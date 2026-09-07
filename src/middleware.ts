import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { secretsEqual } from './lib/secrets';

export default withAuth(
  function middleware(_req) {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized({ req, token }) {
        const path = req.nextUrl.pathname;

        // Admin API routes: secret header only (same two headers the handler
        // accepts: x-admin-secret or Authorization: Bearer). A bare session
        // must NOT pass the edge — session-only callers get their 401/403
        // from the handler, which re-checks ADMIN_SECRET anyway.
        if (path.startsWith('/api/admin')) {
          const adminSecret = req.headers.get('x-admin-secret');
          const authHeader = req.headers.get('authorization');
          // Constant-time compare: plain === leaks prefix-match timing.
          return (
            (!!adminSecret && secretsEqual(adminSecret, process.env.ADMIN_SECRET)) ||
            (!!authHeader && secretsEqual(authHeader, `Bearer ${process.env.ADMIN_SECRET}`))
          );
        }

        // All other protected routes: require session
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: [
    '/api/user/:path*',
    '/api/watchlists/:path*',
    '/api/billing/:path*',
    '/api/admin/:path*',
    '/admin/:path*',
  ],
};
