import type { NextAuthOptions } from 'next-auth';
import type { SessionStrategy } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import { createOrGetUser, getUserByEmail } from './db/queries';
import { logger } from './logger';

export const authOptions: NextAuthOptions = {
  providers: [
    EmailProvider({
      server: false as any,
      from: process.env.AUTH_EMAIL_FROM || 'AI Model Radar <auth@ai-model-radar.com>',
      maxAge: 10 * 60,
      sendVerificationRequest: async ({ identifier, url }) => {
        const resendApiKey = process.env.RESEND_API_KEY;
        if (!resendApiKey || !resendApiKey.startsWith('re_')) {
          logger.info(`[Auth Dev Mode] Magic link for ${identifier}: ${url}`);
          return;
        }

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.AUTH_EMAIL_FROM || 'AI Model Radar <auth@ai-model-radar.com>',
            to: [identifier],
            subject: 'Sign in to AI Model Radar',
            html: `
              <!DOCTYPE html>
              <html>
              <head><meta charset="utf-8"></head>
              <body style="font-family: -apple-system, sans-serif; background: #0B0F17; color: #E5E7EB; padding: 40px;">
                <div style="max-width: 480px; margin: 0 auto; background: #111827; border: 1px solid #1F2937; border-radius: 12px; padding: 32px;">
                  <h2 style="color: #38BDF8; margin: 0 0 16px 0;">⚡ AI Model Radar</h2>
                  <p style="color: #9CA3AF; margin: 0 0 24px 0;">Click below to sign in. This link expires in 10 minutes.</p>
                  <a href="${url}" style="display: inline-block; background: #2563EB; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Sign In</a>
                  <p style="color: #6B7280; margin: 24px 0 0 0; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
                </div>
              </body>
              </html>
            `,
          }),
        });

        if (!res.ok) {
          const errorBody = await res.text();
          throw new Error(`Failed to send magic link email: Resend HTTP ${res.status}: ${errorBody}`);
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt' as SessionStrategy,
    maxAge: 30 * 24 * 60 * 60,
  },
  pages: {
    signIn: '/auth/signin',
    verifyRequest: '/auth/verify-request',
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'email' && user.email) {
        try {
          const dbUser = await createOrGetUser({ email: user.email });
          (user as any).id = String(dbUser.id);
        } catch (err: any) {
          logger.error(`Auth signIn callback failed for ${user.email}: ${err.message}`);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.email = user.email;
      }
      if (token.email) {
        try {
          const dbUser = await getUserByEmail(token.email as string);
          if (dbUser) {
            token.id = String(dbUser.id);
            token.role = dbUser.role;
            token.tier = dbUser.tier;
          }
        } catch {
          // silently fail — token still valid from previous hydration
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id as string;
        (session.user as any).role = token.role as string;
        (session.user as any).tier = token.tier as string;
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
};
