import { describe, it, expect, vi } from 'vitest';
import {
  toAppError,
  ValidationError,
  InternalError,
  ConflictError,
  RateLimitError,
} from '../src/lib/errors';
import { hashIp, StructuredLogger } from '../src/lib/logger';
import { safeRedirectUrl } from '../src/lib/env';

describe('Error taxonomy: no internal leakage + safe redirects + log redaction', () => {
  it('1. unknown errors map to a generic 500 with no message leak', () => {
    const err = Object.assign(
      new Error('connect ECONNREFUSED postgres://admin:s3cret@db:5432/radar relation "users" does not exist'),
      { code: 'ECONNREFUSED' }
    );
    const app = toAppError(err);
    expect(app.statusCode).toBe(500);
    expect(app.toJSON().error).toBe('Internal server error');
    expect(JSON.stringify(app.toJSON())).not.toContain('s3cret');
    expect(JSON.stringify(app.toJSON())).not.toContain('relation');
  });

  it('2. known shapes map to typed statuses without pg internals', () => {
    const unique = Object.assign(
      new Error('duplicate key value violates unique constraint "users_email_key"'),
      { code: '23505' }
    );
    expect(toAppError(unique)).toBeInstanceOf(ConflictError);

    const fk = Object.assign(
      new Error('insert violates foreign key "budget_rules_team_id_fkey"'),
      { code: '23503' }
    );
    const mapped = toAppError(fk);
    expect(mapped).toBeInstanceOf(ValidationError);
    expect(JSON.stringify(mapped.toJSON())).not.toContain('budget_rules_team_id_fkey');
  });

  it('3. AppError instances pass through untouched', () => {
    const rl = new RateLimitError('Slow down', 30);
    expect(toAppError(rl)).toBe(rl);
    expect(rl.toJSON()).toMatchObject({ retryAfter: 30 });
    expect(new InternalError().toJSON()).toMatchObject({ error: 'Internal server error' });
  });

  it('4. safeRedirectUrl allowlists same-origin only', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://ai-model-radar.com';
    expect(safeRedirectUrl('/alerts?upgrade=success')).toBe('https://ai-model-radar.com/alerts?upgrade=success');
    expect(safeRedirectUrl('https://ai-model-radar.com/a/b')).toContain('ai-model-radar.com');
    expect(safeRedirectUrl('https://evil.example/phish')).toBe('https://ai-model-radar.com/alerts');
    expect(safeRedirectUrl('//evil.example/x')).toBe('https://ai-model-radar.com/alerts');
    expect(safeRedirectUrl('javascript:alert(1)')).toBe('https://ai-model-radar.com/alerts');
    expect(safeRedirectUrl(null)).toBe('https://ai-model-radar.com/alerts');
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it('5. logger redacts secret-shaped keys and hashes IPs stably', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const log = new StructuredLogger({ service: 'test' });
      log.info('auth attempt', { stripeSignature: 'v1=abc', apiKey: 'sk_x', email: 'a@b.c' });
      const logged = info.mock.calls[0][0] as string;
      expect(logged).not.toContain('v1=abc');
      expect(logged).not.toContain('sk_x');
      expect(logged).toContain('[REDACTED]');
      expect(logged).toContain('a@b.c');
      expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'));
      expect(hashIp('1.2.3.4')).not.toContain('1.2.3.4');
    } finally {
      debug.mockRestore();
      info.mockRestore();
    }
  });
});
