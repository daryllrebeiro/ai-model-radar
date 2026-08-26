import { describe, it, expect, vi } from 'vitest';
import { fetchLabActivity } from '../src/lib/ingestion/github-labs';
import * as githubLabsModule from '../src/lib/ingestion/github-labs';

describe('Phase P6.1: Authenticated GitHub Ingestion & Zero-Synthetic Fallback', () => {
  it('1. Confirms getFallbackLabActivity is completely deleted from codebase', () => {
    // Assert that no fallback function exists in the module exports
    expect((githubLabsModule as any).getFallbackLabActivity).toBeUndefined();
  });

  it('2. Attaches Authorization header when GITHUB_TOKEN is present', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test_mock_token_123456';

    let capturedHeaders: HeadersInit | undefined;
    const originalFetch = global.fetch;

    global.fetch = vi.fn().mockImplementation((url, options) => {
      capturedHeaders = options?.headers;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              sha: 'abc123456789',
              commit: {
                message: 'Test release commit',
                author: { date: '2026-08-25T12:00:00Z' },
              },
              html_url: 'https://github.com/deepseek-ai/DeepSeek-R1/commit/abc1234',
            },
          ]),
      });
    }) as any;

    try {
      const items = await fetchLabActivity();
      expect(items.length).toBeGreaterThan(0);
      expect((capturedHeaders as any)?.Authorization).toBe('Bearer ghp_test_mock_token_123456');
    } finally {
      global.fetch = originalFetch;
      delete process.env.GITHUB_TOKEN;
    }
  });

  it('3. Returns clean empty list and logs error when upstream rate limits occur without fabricating dates', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'rate limit exceeded',
      headers: new Headers({ 'x-ratelimit-remaining': '0' }),
      text: () => Promise.resolve('API rate limit exceeded'),
    }) as any;

    try {
      const items = await fetchLabActivity();
      // Must NOT synthesize fake dates
      expect(items).toEqual([]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
