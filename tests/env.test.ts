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
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://user:pass@ep-test.neon.tech/neondb',
      CRON_SECRET: 'super-secure-cron-secret-123',
      PRUNE_DAYS: '60',
    });

    expect(res.valid).toBe(true);
    expect(res.env.PRUNE_DAYS).toBe(60);
    expect(res.env.CRON_SECRET).toBe('super-secure-cron-secret-123');
  });
});
