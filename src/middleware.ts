import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(_req) {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized({ req, token }) {
        const path = req.nextUrl.pathname;

        // Admin routes: allow if session exists OR x-admin-secret header matches
        if (path.startsWith('/api/admin')) {
          const adminSecret = req.headers.get('x-admin-secret');
          if (adminSecret && adminSecret === process.env.ADMIN_SECRET) {
            return true;
          }
          return !!token;
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
