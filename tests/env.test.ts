import { describe, it, expect } from 'vitest';
import { validateEnv } from '../src/lib/env';

describe('Phase P4: Environment Schema Validation', () => {
  it('1. Validates clean environment with default values', () => {
    const res = validateEnv({
      NODE_ENV: 'test',
    });

    expect(res.valid).toBe(true);
    expect(res.env.NODE_ENV).toBe('test');
    expect(res.env.PRUNE_DAYS).toBe(30);
  });

  it('2. Rejects invalid URLs or malformed values', () => {
    const res = validateEnv({
      DATABASE_URL: 'not-a-valid-url',
      UPSTASH_REDIS_REST_URL: 'invalid-redis-url',
    });

    expect(res.valid).toBe(false);
    expect(res.errors?.length).toBeGreaterThanOrEqual(1);
  });

  it('3. Successfully parses optional production configs', () => {
    const res = validateEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/neondb',
      CRON_SECRET: 'super-secure-cron-secret-123',
      PRUNE_DAYS: '60',
      AUTH_SECRET: 'super-secret-32-char-minimum-length-secret',
      UNSUBSCRIBE_SECRET: 'unsubscribe-secret-32-char-min',
    });

    expect(res.valid).toBe(true);
    expect(res.env.PRUNE_DAYS).toBe(60);
    expect(res.env.CRON_SECRET).toBe('super-secure-cron-secret-123');
  });

  it('4. Requires AUTH_SECRET, DATABASE_URL and NEXT_PUBLIC_SITE_URL in production', () => {
    const res = validateEnv({
      NODE_ENV: 'production',
    });

    expect(res.valid).toBe(false);
    expect(res.errors).toBeDefined();
    expect(res.errors?.some((e) => e.includes('AUTH_SECRET'))).toBe(true);
    expect(res.errors?.some((e) => e.includes('DATABASE_URL'))).toBe(true);
    expect(res.errors?.some((e) => e.includes('NEXT_PUBLIC_SITE_URL'))).toBe(true);
  });

  it('5. Parses string booleans and site URL gateways', () => {
    const res = validateEnv({
      NODE_ENV: 'production',
      AUTH_SECRET: 'super-secret-32-char-minimum-length-secret',
      DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/neondb',
      NEXT_PUBLIC_SITE_URL: 'https://ai-model-radar.com',
      FEATURE_ENFORCEMENT: 'true',
      UNSUBSCRIBE_SECRET: 'unsubscribe-secret-32-char-min',
      OPENROUTER_API_URL: 'https://openrouter.ai/api/v1/models',
    });

    expect(res.valid).toBe(true);
    expect(res.env.FEATURE_ENFORCEMENT).toBe(true);
    expect(res.env.NEXT_PUBLIC_SITE_URL).toBe('https://ai-model-radar.com');
  });

  it('6. Rejects malformed site or OpenRouter URLs', () => {
    const res = validateEnv({
      NEXT_PUBLIC_SITE_URL: 'not-a-url',
      OPENROUTER_API_URL: 'nope',
    });

    expect(res.valid).toBe(false);
    expect(res.errors?.length).toBeGreaterThanOrEqual(1);
  });
});
