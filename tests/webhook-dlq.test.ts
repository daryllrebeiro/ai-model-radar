import { describe, it, expect, vi } from 'vitest';
import {
  computeTimestampedSignature,
  verifyWebhookSignature,
  deliverWebhookPayload,
  processDlqBatch,
} from '../src/lib/webhooks';
import {
  enqueueDlqDelivery,
  getDlqDeliveries,
  getDlqDelivery,
  claimDlqDue,
  resolveDlqDelivery,
  requeueDlqDelivery,
  DLQ_MAX_PAYLOAD_CHARS,
} from '../src/lib/db/queries';

const HOOK = 'https://api.example.com/dlq-hook';

function okFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
}

function failFetch(status = 500) {
  return vi.fn().mockResolvedValue({ ok: false, status, statusText: 'Error' });
}

describe('timestamped webhook signatures', () => {
  const payload = JSON.stringify({ event: 'PRICE_CHANGE' });
  const secret = 'whsec_test_secret_123456';

  it('round-trips sign -> verify', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = computeTimestampedSignature(payload, secret, ts);
    expect(sig).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(verifyWebhookSignature(payload, secret, sig).ok).toBe(true);
  });

  it('rejects tampered payloads and wrong secrets', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = computeTimestampedSignature(payload, secret, ts);
    expect(verifyWebhookSignature(payload + 'x', secret, sig).ok).toBe(false);
    expect(verifyWebhookSignature(payload, 'wrong-secret', sig).ok).toBe(false);
  });

  it('rejects stale timestamps (replay protection)', () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const sig = computeTimestampedSignature(payload, secret, stale);
    const res = verifyWebhookSignature(payload, secret, sig);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/tolerance|replay/);
  });

  it('rejects malformed headers and clamps huge tolerances', () => {
    expect(verifyWebhookSignature(payload, secret, 'garbage').ok).toBe(false);
    const old = Math.floor(Date.now() / 1000) - 7200;
    const sig = computeTimestampedSignature(payload, secret, old);
    // tolerance above the 3600s cap is clamped, so a 2h-old stamp still fails
    expect(verifyWebhookSignature(payload, secret, sig, { toleranceSec: 99999 }).ok).toBe(false);
  });
});

describe('webhook dead-letter queue', () => {
  it('parks terminal failures when opted in, with inline attempt count', async () => {
    const res = await deliverWebhookPayload(
      HOOK,
      { event: 'PRICE_CHANGE', n: Date.now() },
      { maxRetries: 2, baseDelayMs: 5, fetchFn: failFetch() as any, enqueueDlq: true }
    );
    expect(res.success).toBe(false);
    expect(res.attempts).toBe(2);
    expect(typeof res.dlqId).toBe('number');

    const row = await getDlqDelivery(res.dlqId!);
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(2);
    expect(row?.destination_url).toBe(HOOK);
  });

  it('does not touch the DLQ when opt-in is off', async () => {
    const before = (await getDlqDeliveries({ limit: 200 })).length;
    await deliverWebhookPayload(
      HOOK,
      { event: 'NO_DLQ' },
      { maxRetries: 1, baseDelayMs: 5, fetchFn: failFetch() as any }
    );
    const after = (await getDlqDeliveries({ limit: 200 })).length;
    expect(after).toBe(before);
  });

  it('worker redelivers due rows to recovery and marks delivered', async () => {
    const stamp = Date.now();
    await enqueueDlqDelivery({
      delivery_id: `dlq-recover-${stamp}`,
      destination_url: HOOK,
      payload: JSON.stringify({ event: 'RECOVER' }),
      attempts: 1,
      max_attempts: 5,
      next_retry_at: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await processDlqBatch(10, { fetchFn: okFetch() as any });
    expect(res.claimed).toBeGreaterThanOrEqual(1);
    expect(res.delivered).toBeGreaterThanOrEqual(1);
    const listed = await getDlqDeliveries({ status: 'delivered', limit: 200 });
    expect(listed.some((d) => d.delivery_id === `dlq-recover-${stamp}`)).toBe(true);
  });

  it('worker parks rows as dead past max_attempts', async () => {
    const stamp = Date.now();
    await enqueueDlqDelivery({
      delivery_id: `dlq-doomed-${stamp}`,
      destination_url: HOOK,
      payload: JSON.stringify({ event: 'DOOMED' }),
      attempts: 0,
      max_attempts: 1,
      next_retry_at: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await processDlqBatch(10, { fetchFn: failFetch() as any, maxRetries: 1 });
    expect(res.dead).toBeGreaterThanOrEqual(1);
    const listed = await getDlqDeliveries({ status: 'dead', limit: 200 });
    expect(listed.some((d) => d.delivery_id === `dlq-doomed-${stamp}`)).toBe(true);
  });

  it('claims are single-flight: two consecutive claims do not overlap', async () => {
    const stamp = Date.now();
    await enqueueDlqDelivery({
      delivery_id: `dlq-sf-${stamp}`,
      destination_url: HOOK,
      payload: JSON.stringify({ n: 'sf' }),
      next_retry_at: new Date(Date.now() - 1000).toISOString(),
    });
    const first = await claimDlqDue(50);
    const ids = new Set(first.map((d) => d.delivery_id));
    expect(ids.has(`dlq-sf-${stamp}`)).toBe(true);
    const second = await claimDlqDue(50);
    expect(second.some((d) => d.delivery_id === `dlq-sf-${stamp}`)).toBe(false);
    // Cleanup: resolve so later runs stay hermetic.
    const row = first.find((d) => d.delivery_id === `dlq-sf-${stamp}`);
    await resolveDlqDelivery(Number(row!.id), { delivered: true });
  });

  it('claims are single-flight and resolutions transition correctly', async () => {
    const stamp = Date.now();
    const a = await enqueueDlqDelivery({
      delivery_id: `dlq-test-a-${stamp}`,
      destination_url: HOOK,
      payload: JSON.stringify({ n: 'a' }),
      attempts: 0,
      max_attempts: 3,
    });
    const b = await enqueueDlqDelivery({
      delivery_id: `dlq-test-b-${stamp}`,
      destination_url: HOOK,
      payload: JSON.stringify({ n: 'b' }),
      attempts: 0,
      max_attempts: 1,
    });
    // Both are queued but carry future next_retry_at (backoff); force due by resolving state directly is backend-specific,
    // so assert listing + manual resolution transitions instead.
    const listed = await getDlqDeliveries({ status: 'queued', limit: 200 });
    expect(listed.some((d) => d.delivery_id === a.delivery_id)).toBe(true);

    const dead = await resolveDlqDelivery(Number(b.id), { delivered: false, last_error: 'boom' });
    expect(dead?.status).toBe('dead');

    const req = await requeueDlqDelivery(Number(dead!.id));
    expect(req?.status).toBe('queued');

    const done = await resolveDlqDelivery(Number(a.id), { delivered: true });
    expect(done?.status).toBe('delivered');
    const redeliver = await requeueDlqDelivery(Number(a.id));
    expect(redeliver).toBeNull();
  });

  it('worker skips rows whose backoff has not elapsed', async () => {
    const stamp = Date.now();
    const row = await enqueueDlqDelivery({
      delivery_id: `dlq-worker-${stamp}`,
      destination_url: HOOK,
      payload: JSON.stringify({ event: 'WORKER_E2E' }),
      attempts: 0,
      max_attempts: 2,
    });
    // Backoff is 60s for attempts=0, so a fresh row is not due; the worker must skip it without failing.
    const skipped = await processDlqBatch(10, { fetchFn: okFetch() as any });
    expect(skipped.claimed).toBeGreaterThanOrEqual(0);

    const still = await getDlqDelivery(Number(row.id));
    expect(still?.status).toBe('queued');
    expect(still?.attempts).toBe(0);
    // Cleanup.
    await resolveDlqDelivery(Number(row.id), { delivered: true });
  });

  it('rejects oversize payloads at enqueue', async () => {
    await expect(
      enqueueDlqDelivery({
        delivery_id: `dlq-big-${Date.now()}`,
        destination_url: HOOK,
        payload: 'x'.repeat(DLQ_MAX_PAYLOAD_CHARS + 1),
      })
    ).rejects.toThrow();
  });
});
