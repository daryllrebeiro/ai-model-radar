import { describe, it, expect, afterEach } from 'vitest';
import {
  routingRetentionDays,
  usageRetentionDays,
  retentionCutoffIso,
} from '../src/lib/retention';
import {
  recordRoutingAttempt,
  createUsageImport,
  pruneRoutingAttempts,
  pruneUsageImports,
  listUsageImports,
} from '../src/lib/db/queries';
import { createOrGetUser } from '../src/lib/db/queries';
import { uniqueEmail } from './helpers';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('retention windows (pure policy)', () => {
  it('defaults and clamps: routing 30d (min 1), usage 365d (min 30)', () => {
    delete process.env.RETENTION_ROUTING_DAYS;
    delete process.env.RETENTION_USAGE_DAYS;
    expect(routingRetentionDays()).toBe(30);
    expect(usageRetentionDays()).toBe(365);
    process.env.RETENTION_ROUTING_DAYS = '0';
    expect(routingRetentionDays()).toBe(1);
    process.env.RETENTION_USAGE_DAYS = '5';
    expect(usageRetentionDays()).toBe(30);
    process.env.RETENTION_ROUTING_DAYS = 'abc';
    expect(routingRetentionDays()).toBe(30);
    expect(retentionCutoffIso(30, Date.UTC(2026, 0, 31))).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('retention enforcement (live, both backends)', () => {
  it('future cutoff deletes everything; ancient cutoff deletes nothing (routing)', async () => {
    await recordRoutingAttempt({
      key_prefix: null, owner_email_hash: null,
      requested_model: 'a/x', selected_model: 'a/x', policy: 'explicit',
      upstream_status: null, latency_ms: 5, success: true,
    });
    const none = await pruneRoutingAttempts(retentionCutoffIso(3650));
    expect(none.deleted).toBe(0);
    expect(none.capped).toBe(false);
    const all = await pruneRoutingAttempts(new Date(Date.now() + 86400000).toISOString());
    expect(all.deleted).toBeGreaterThanOrEqual(1);
    expect(all.capped).toBe(false);
  });

  it('usage imports prune past-window rows only, finish with zero remaining', async () => {
    const email = uniqueEmail('retention');
    const user = await createOrGetUser({ email });
    const rec = await createUsageImport({
      userId: user.id, ownerEmail: email, filename: 'r.csv',
      rows: [{ model_id: 'a/x', prompt_tokens: 1, completion_tokens: 1, cost_usd: 0.01 }],
      totalSpendUsd: 0.01,
    });
    const kept = await pruneUsageImports(retentionCutoffIso(365));
    expect(kept.deleted).toBe(0);
    const gone = await pruneUsageImports(new Date(Date.now() + 86400000).toISOString());
    expect(gone.deleted).toBeGreaterThanOrEqual(1);
    expect((await listUsageImports(user.id)).some((r) => r.id === rec.id)).toBe(false);
  });
});
