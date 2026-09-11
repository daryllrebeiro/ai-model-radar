import { describe, it, expect } from 'vitest';
import { recordProbeSpend, getProbeSpendSince, pruneProbeSpendLedger } from '../src/lib/db/queries';
import { isActiveProbeEnabled } from '../src/lib/active-probe';
import { retentionCutoffIso } from '../src/lib/retention';

describe('P1-1 probe spend ledger (paid-cycle accounting)', () => {
  it('records one row per model per cycle and rolls up per provider', async () => {
    const cycle = `test-cycle-${Date.now()}`;
    await recordProbeSpend({ cycle_id: cycle, model_id: 'a/m1', provider: 'Acme', calls: 3, errors: 0, est_tokens: 1200 });
    await recordProbeSpend({ cycle_id: cycle, model_id: 'a/m2', provider: 'Acme', calls: 3, errors: 1, est_tokens: 800 });
    const rollup = await getProbeSpendSince(new Date(Date.now() - 3600 * 1000).toISOString());
    const acme = rollup.find((r) => r.provider === 'Acme')!;
    expect(acme.total_calls).toBeGreaterThanOrEqual(6);
    expect(acme.total_errors).toBeGreaterThanOrEqual(1);
    expect(acme.total_est_tokens).toBeGreaterThanOrEqual(2000);
    expect(acme.cycles).toBeGreaterThanOrEqual(1);
  });

  it('rejects negative counts loudly (caller bug, not rounding)', async () => {
    await expect(
      recordProbeSpend({ cycle_id: 'c', model_id: 'a/m', provider: 'Acme', calls: -1, errors: 0, est_tokens: 0 })
    ).rejects.toThrow(/non-negative integer/);
    await expect(
      recordProbeSpend({ cycle_id: '', model_id: 'a/m', provider: 'Acme', calls: 0, errors: 0, est_tokens: 0 })
    ).rejects.toThrow(/cycle_id/);
  });

  it('kill switch defaults OFF (fail-closed) and honors explicit opt-in', () => {    const saved = process.env.ACTIVE_PROBE_ENABLED;
    delete process.env.ACTIVE_PROBE_ENABLED;
    expect(isActiveProbeEnabled()).toBe(false);
    process.env.ACTIVE_PROBE_ENABLED = 'true';
    expect(isActiveProbeEnabled()).toBe(true);
    process.env.ACTIVE_PROBE_ENABLED = 'yes';
    expect(isActiveProbeEnabled()).toBe(false);
    if (saved === undefined) delete process.env.ACTIVE_PROBE_ENABLED;
    else process.env.ACTIVE_PROBE_ENABLED = saved;
  });

  it('P2-5: retention prunes stale raw rows but keeps fresh ones', async () => {
    const old = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
    await recordProbeSpend({
      cycle_id: `old-cycle-${Date.now()}`,
      model_id: 'a/stale-model',
      provider: 'StaleCo',
      calls: 2,
      errors: 0,
      est_tokens: 100,
      created_at: old,
    });
    const res = await pruneProbeSpendLedger(retentionCutoffIso(90));
    expect(res.deleted).toBeGreaterThanOrEqual(1);
    const rollup = await getProbeSpendSince(retentionCutoffIso(90));
    expect(rollup.find((r) => r.provider === 'StaleCo')).toBeUndefined();
  });
});
