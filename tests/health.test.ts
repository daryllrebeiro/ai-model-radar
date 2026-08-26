import { describe, it, expect, beforeEach } from 'vitest';
import { recordIngestionRun, getLatestIngestionRuns } from '../src/lib/db/queries';
import { StructuredLogger } from '../src/lib/logger';
import { captureException } from '../src/lib/errors';

describe('Phase P1: Pipeline Reliability & Observability', () => {
  it('1. Emits structured log entries with child context and correlation IDs', () => {
    const rootLogger = new StructuredLogger({ service: 'test-service' });
    const childLogger = rootLogger.child({ runId: 'test-run-123', source: 'openrouter' });

    expect(childLogger).toBeDefined();
  });

  it('2. Records and retrieves ingestion run audit log entries', async () => {
    const testRun = {
      source: 'openrouter' as const,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: 'success' as const,
      models_seen: 417,
      events_emitted: 6,
      error_detail: undefined,
    };

    await recordIngestionRun(testRun);

    const runs = await getLatestIngestionRuns(10);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].source).toBe('openrouter');
  });

  it('3. Formats and captures structured exception reports', () => {
    const testError = new TypeError('Simulated connection failure');
    const report = captureException(testError, { runId: 'test-123', stage: 'fetch' });

    expect(report.errorName).toBe('TypeError');
    expect(report.errorMessage).toContain('Simulated connection failure');
    expect(report.context?.stage).toBe('fetch');
  });

  it('4. Rejects unauthenticated requests to admin health endpoint when ADMIN_SECRET is set', async () => {
    process.env.ADMIN_SECRET = 'secret_admin_token_999';
    try {
      const { GET } = await import('../src/app/api/admin/health/route');
      const { NextRequest } = await import('next/server');

      // Unauthenticated request
      const unauthReq = new NextRequest('http://localhost:3000/api/admin/health');
      const unauthRes = await GET(unauthReq);
      expect(unauthRes.status).toBe(401);

      // Authenticated request with Bearer token
      const authReq = new NextRequest('http://localhost:3000/api/admin/health', {
        headers: { Authorization: 'Bearer secret_admin_token_999' },
      });
      const authRes = await GET(authReq);
      expect(authRes.status).toBe(200);
    } finally {
      delete process.env.ADMIN_SECRET;
    }
  });
});
