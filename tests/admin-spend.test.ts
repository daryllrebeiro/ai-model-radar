import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as spendGET } from '../src/app/api/admin/spend/route';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('admin spend dashboard (gated operational readout)', () => {
  it('fail-closed without ADMIN_SECRET (401, no data)', async () => {
    delete process.env.ADMIN_SECRET;
    const res = await spendGET(new NextRequest('http://localhost/api/admin/spend'));
    expect(res.status).toBe(401);
  });

  it('wrong secret → 401 with audit trail', async () => {
    process.env.ADMIN_SECRET = 'test-admin-spend-secret';
    const res = await spendGET(
      new NextRequest('http://localhost/api/admin/spend', { headers: { Authorization: 'Bearer wrong' } })
    );
    expect(res.status).toBe(401);
  });

  it('correct secret → spend + metrics + maturity + queue in one body', async () => {
    process.env.ADMIN_SECRET = 'test-admin-spend-secret';
    const res = await spendGET(
      new NextRequest('http://localhost/api/admin/spend', { headers: { Authorization: 'Bearer test-admin-spend-secret' } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe('v1');
    expect(typeof body.probe_enabled).toBe('boolean');
    expect(Array.isArray(body.spend.last_24h)).toBe(true);
    expect(typeof body.metrics_30d).toBe('object');
    expect(typeof body.deprecation_maturity.total_pairs).toBe('number');
    expect(typeof body.drift_queue.pending).toBe('number');
  });
});
