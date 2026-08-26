import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchLabActivity,
  getGitHubRateLimitStatus,
  getGitHubPollIntervalMinutes,
} from '../src/lib/ingestion/github-labs';
import * as githubLabsModule from '../src/lib/ingestion/github-labs';
import { getLatestIngestionRuns } from '../src/lib/db/queries';

describe('GitHub Ingestion: Optional Auth, Rate Limits & Zero-Synthetic Fallbacks', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. Confirms getFallbackLabActivity is completely deleted from codebase', () => {
    expect((githubLabsModule as any).getFallbackLabActivity).toBeUndefined();
  });

  it('2. Attaches Authorization header when GITHUB_TOKEN is present', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test_mock_token_123456';

    let capturedHeaders: HeadersInit | undefined;
    global.fetch = vi.fn().mockImplementation((url, options) => {
      capturedHeaders = options?.headers;
      return Promise.resolve({
        ok: true,
        headers: new Headers({
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-limit': '5000',
        }),
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

    const items = await fetchLabActivity();
    expect(items.length).toBeGreaterThan(0);
    expect((capturedHeaders as any)?.Authorization).toBe('Bearer ghp_test_mock_token_123456');

    const rateLimit = getGitHubRateLimitStatus();
    expect(rateLimit.isAuthenticated).toBe(true);
    expect(rateLimit.rateLimitRemaining).toBe(4999);
  });

  it('3. Does NOT attach Authorization header when running unauthenticated (no token)', async () => {
    delete process.env.GITHUB_TOKEN;

    let capturedHeaders: HeadersInit | undefined;
    global.fetch = vi.fn().mockImplementation((url, options) => {
      capturedHeaders = options?.headers;
      return Promise.resolve({
        ok: true,
        headers: new Headers({
          'x-ratelimit-remaining': '58',
          'x-ratelimit-limit': '60',
        }),
        json: () =>
          Promise.resolve([
            {
              sha: 'def987654321',
              commit: {
                message: 'Unauthenticated commit',
                author: { date: '2026-08-25T14:00:00Z' },
              },
              html_url: 'https://github.com/deepseek-ai/DeepSeek-R1/commit/def9876',
            },
          ]),
      });
    }) as any;

    const items = await fetchLabActivity();
    expect(items.length).toBeGreaterThan(0);
    expect((capturedHeaders as any)?.Authorization).toBeUndefined();

    const rateLimit = getGitHubRateLimitStatus();
    expect(rateLimit.isAuthenticated).toBe(false);
    expect(rateLimit.rateLimitRemaining).toBe(58);
  });

  it('4. Returns clean empty list and logs error when upstream rate limits occur without fabricating dates', async () => {
    delete process.env.GITHUB_TOKEN;

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'rate limit exceeded',
      headers: new Headers({
        'x-ratelimit-remaining': '0',
        'retry-after': '3600',
      }),
      text: () => Promise.resolve('API rate limit exceeded'),
    }) as any;

    const items = await fetchLabActivity();
    // Must NOT synthesize fake dates
    expect(items).toEqual([]);

    // Check that failure was recorded in ingestion_runs
    const runs = await getLatestIngestionRuns(5);
    const githubRun = runs.find((r) => r.source === 'github');
    expect(githubRun).toBeDefined();
    expect(githubRun?.status).toBe('failed');
    expect(githubRun?.error_detail).toContain('GitHub API 403');
    expect(githubRun?.error_detail).toContain('retry-after: 3600');
  });

  it('5. Configurable polling interval defaults to 60 minutes and respects env var', () => {
    delete process.env.GITHUB_POLL_INTERVAL_MINUTES;
    expect(getGitHubPollIntervalMinutes()).toBe(60);

    process.env.GITHUB_POLL_INTERVAL_MINUTES = '30';
    expect(getGitHubPollIntervalMinutes()).toBe(30);

    process.env.GITHUB_POLL_INTERVAL_MINUTES = 'invalid';
    expect(getGitHubPollIntervalMinutes()).toBe(60);
  });
});
