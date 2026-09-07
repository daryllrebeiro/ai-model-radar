import { describe, it, expect, vi } from 'vitest';
import { assertPublicHttpUrl, fetchWithSsrfRedirects, SsrfBlockedError } from '../src/lib/ssrf-guard';
import { deliverWebhookPayload } from '../src/lib/webhooks';

describe('SSRF guard (webhook dispatch + endpoint probes)', () => {
  it('1. allows public https URLs', () => {
    expect(assertPublicHttpUrl('https://api.example.com/hook').hostname).toBe('api.example.com');
    expect(assertPublicHttpUrl('http://example.com:8080/x').protocol).toBe('http:');
  });

  it('2. blocks loopback, private ranges, metadata, and non-http schemes', () => {
    const blocked = [
      'http://localhost/hook',
      'http://127.0.0.1:3000/x',
      'http://10.0.0.5/',
      'http://172.16.4.9/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'file:///etc/passwd',
      'ftp://example.com/x',
      'http://user:pass@example.com/',
      'not-a-url',
      'http://metadata.google.internal/',
    ];
    for (const u of blocked) {
      expect(() => assertPublicHttpUrl(u), u).toThrow(SsrfBlockedError);
    }
  });

  it('3. webhook dispatch refuses SSRF targets without network access', async () => {
    const fetchFn = vi.fn();
    const res = await deliverWebhookPayload(
      'http://169.254.169.254/latest/meta-data/iam',
      { event_type: 'PRICE_CHANGE' },
      { fetchFn: fetchFn as unknown as typeof fetch, maxRetries: 1 }
    );
    expect(res.success).toBe(false);
    expect(res.attempts).toBe(0);
    expect(res.error).toMatch(/not allowed/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('4. webhook dispatch still delivers to public URLs', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    const res = await deliverWebhookPayload(
      'https://api.example.com/hook',
      { event_type: 'PRICE_CHANGE' },
      { fetchFn: fetchFn as unknown as typeof fetch, maxRetries: 1 }
    );
    expect(res.success).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('5. blocks IPv6-mapped private addresses (dotted and hex forms)', () => {
    const blocked = [
      'http://[::ffff:10.0.0.1]/',
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
      'http://[::ffff:7f00:1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fc00::1]/',
      'http://[fe80::1]/',
    ];
    for (const u of blocked) {
      expect(() => assertPublicHttpUrl(u), u).toThrow(SsrfBlockedError);
    }
    // Public IPv6 still passes
    expect(assertPublicHttpUrl('http://[2606:4700:4700::1111]/').hostname).toContain('2606');
  });

  it('6. redirect to an internal target is refused without fetching it', async () => {
    const internalFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    const redirectFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === 'https://api.example.com/r') {
        return { ok: false, status: 302, statusText: 'Found', headers: { get: (h: string) => (h === 'location' ? 'http://169.254.169.254/x' : null) } };
      }
      internalFetch(url);
      return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null } };
    });
    await expect(
      fetchWithSsrfRedirects(redirectFetch as unknown as typeof fetch, 'https://api.example.com/r', { method: 'POST' })
    ).rejects.toThrow(SsrfBlockedError);
    expect(internalFetch).not.toHaveBeenCalled();
  });

  it('7. redirect chains over the hop limit are refused', async () => {
    const fetchFn = vi.fn().mockImplementation(async (url: string) => ({
      ok: false,
      status: 302,
      statusText: 'Found',
      headers: { get: (h: string) => (h === 'location' ? `${url}/hop` : null) },
    }));
    await expect(
      fetchWithSsrfRedirects(fetchFn as unknown as typeof fetch, 'https://api.example.com/a', {}, 2)
    ).rejects.toThrow(SsrfBlockedError);
  });
});
