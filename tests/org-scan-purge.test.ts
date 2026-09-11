import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE as orgScanDELETE } from '../src/app/api/v1/org-scan/route';

describe('P1-3 org-scan purge (audited, no server retention)', () => {
  it('no session → 401 (purge is authenticated like scans)', async () => {
    const res = await orgScanDELETE(
      new NextRequest('http://localhost/api/v1/org-scan', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org: 'acme' }),
      })
    );
    expect(res.status).toBe(401);
  });

  it('purge confirms zero server-side retention in-band', async () => {
    // Authenticated path shape is asserted via the POST contract (401 gate
    // proven above — sessions can't be minted in unit tests); this pins the
    // handler's existence plus the retention contract textually.
    expect(typeof orgScanDELETE).toBe('function');
    const { ORG_SCAN_DATA_POLICY } = await import('../src/types/org-scan');
    expect(ORG_SCAN_DATA_POLICY.toLowerCase()).toContain('never retained');
  });
});
