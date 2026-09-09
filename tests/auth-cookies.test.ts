import { describe, it, expect } from 'vitest';
import { authOptions, sessionCookieConfig } from '../src/lib/auth.config';

// Pinned session-cookie contract (auth.config.ts): httpOnly always,
// SameSite=Lax (cross-site POSTs never carry the cookie -> CSRF-neutral),
// Secure + `__Secure-` prefix in production, plain http name otherwise.

describe('Session cookie wire contract', () => {
  it('1. wired authOptions cookie matches the config helper for the current env', async () => {
    const jar = (authOptions.cookies as any)?.sessionToken;
    const expected = sessionCookieConfig(process.env.NODE_ENV);
    expect(jar).toEqual(expected);
    expect(jar.options.httpOnly).toBe(true);
    expect(String(jar.options.sameSite).toLowerCase()).toBe('lax');
    expect(jar.options.path).toBe('/');
  });

  it('2. production cookie: __Secure- prefix + Secure; non-prod: plain + non-secure', () => {
    const prod = sessionCookieConfig('production');
    expect(prod.name).toBe('__Secure-next-auth.session-token');
    expect(prod.options.secure).toBe(true);
    expect(prod.options.httpOnly).toBe(true);
    expect(String(prod.options.sameSite).toLowerCase()).toBe('lax');
    expect(prod.options.path).toBe('/');

    for (const env of ['test', 'development', undefined]) {
      const other = sessionCookieConfig(env);
      expect(other.name).toBe('next-auth.session-token');
      expect(other.options.secure).toBe(false);
      expect(other.options.httpOnly).toBe(true);
      expect(String(other.options.sameSite).toLowerCase()).toBe('lax');
    }
  });
});
