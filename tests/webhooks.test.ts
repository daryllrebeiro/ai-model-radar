import { describe, it, expect, vi } from 'vitest';
import { computeHmacSignature, deliverWebhookPayload } from '../src/lib/webhooks';
import { getRecentDigestDeliveries } from '../src/lib/db/queries';

describe('Phase P5: Hardened Webhook Delivery Engine', () => {
  it('1. Computes deterministic HMAC-SHA256 payload signature', () => {
    const payload = JSON.stringify({ event: 'PRICE_CHANGE', model: 'gpt-4o' });
    const secret = 'whsec_test_secret_123456';

    const sig1 = computeHmacSignature(payload, secret);
    const sig2 = computeHmacSignature(payload, secret);

    expect(sig1).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(sig1).toBe(sig2);
  });

  it('2. Delivers webhook on first attempt when endpoint responds 200 OK', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });

    const result = await deliverWebhookPayload(
      'https://api.example.com/webhook',
      { event: 'TEST' },
      {
        secret: 'whsec_key',
        maxRetries: 3,
        fetchFn: mockFetch as any,
      }
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.httpStatus).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('3. Recovers on retry when endpoint encounters transient 500 error then succeeds', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
      });
    });

    const result = await deliverWebhookPayload(
      'https://api.example.com/retry-test',
      { event: 'PRICE_CHANGE' },
      {
        maxRetries: 3,
        baseDelayMs: 10,
        fetchFn: mockFetch as any,
      }
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.httpStatus).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('4. Records delivery audit logs in digest_deliveries table', async () => {
    const deliveries = await getRecentDigestDeliveries(10);
    expect(deliveries.length).toBeGreaterThanOrEqual(1);
    expect(deliveries[0].destination_url).toBeDefined();
  });
});
