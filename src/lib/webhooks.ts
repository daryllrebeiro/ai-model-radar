import crypto from 'crypto';
import { recordDigestDelivery, enqueueDlqDelivery, claimDlqDue, resolveDlqDelivery } from './db/queries';
import { assertPublicHttpUrl, fetchWithSsrfRedirects, SsrfBlockedError } from './ssrf-guard';
import { logger } from './logger';

export interface WebhookDeliveryOptions {
  secret?: string;
  ruleId?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch; // Injectable for unit testing
  /**
   * Park the payload in the dead-letter queue on terminal failure instead
   * of only audit-logging it. The DLQ row carries the inline attempt count
   * so redelivery backoff continues where inline retries left off.
   */
  enqueueDlq?: boolean;
  dlqMaxAttempts?: number;
}

export const WEBHOOK_SIGNATURE_TOLERANCE_SEC = 300;
export const WEBHOOK_SIGNATURE_MAX_TOLERANCE_SEC = 3600;

export interface WebhookDeliveryResult {
  success: boolean;
  httpStatus?: number;
  attempts: number;
  durationMs: number;
  error?: string;
  signature?: string;
  /** DLQ row id when the terminal failure was parked (enqueueDlq). */
  dlqId?: number;
}

/**
 * Computes HMAC-SHA256 signature for webhook payload verification
 */
export function computeHmacSignature(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Timestamp-bound signature base: `"<unix-seconds>.<payload>"`. Receivers
 * verify with verifyWebhookSignature, which additionally enforces a replay
 * window around the timestamp.
 */
export function computeTimestampedSignature(
  payload: string,
  secret: string,
  timestampSec: number
): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestampSec}.${payload}`);
  return `t=${timestampSec},v1=${hmac.digest('hex')}`;
}

export interface WebhookSignatureCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Verifies a timestamp-bound signature from X-Radar-Signature-T.
 * Format: "t=<unix-seconds>,v1=<hex>". Rejects unknown formats,
 * secret mismatches (constant-time), and timestamps outside
 * toleranceSec of now (replay protection).
 */
export function verifyWebhookSignature(
  payload: string,
  secret: string,
  signatureHeader: string,
  opts: { toleranceSec?: number; nowMs?: number } = {}
): WebhookSignatureCheck {
  const toleranceSec = Math.min(
    WEBHOOK_SIGNATURE_MAX_TOLERANCE_SEC,
    Math.max(1, Math.floor(opts.toleranceSec ?? WEBHOOK_SIGNATURE_TOLERANCE_SEC))
  );
  const nowMs = opts.nowMs ?? Date.now();
  const match = /^t=(\d+),v1=([0-9a-fA-F]+)$/.exec((signatureHeader || '').trim());
  if (!match) return { ok: false, reason: 'malformed signature header' };
  const timestampSec = Number(match[1]);
  if (!Number.isFinite(timestampSec)) return { ok: false, reason: 'malformed timestamp' };
  if (Math.abs(nowMs / 1000 - timestampSec) > toleranceSec) {
    return { ok: false, reason: 'timestamp outside tolerance (possible replay)' };
  }
  const expected = computeTimestampedSignature(payload, secret, timestampSec);
  const a = Buffer.from(match[0], 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  return { ok: true };
}

/**
 * Delivers webhook payload with timeout, HMAC signing, exponential backoff retries, and audit logging
 */
export async function deliverWebhookPayload(
  destinationUrl: string,
  payload: Record<string, any>,
  options: WebhookDeliveryOptions = {}
): Promise<WebhookDeliveryResult> {
  const {
    secret,
    ruleId,
    maxRetries = 3,
    baseDelayMs = 150,
    timeoutMs = 5000,
    fetchFn = fetch,
    enqueueDlq = false,
    dlqMaxAttempts = 5,
  } = options;

  const payloadString = JSON.stringify(payload);
  const deliveryId = `del-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const signature = secret ? computeHmacSignature(payloadString, secret) : undefined;
  // Timestamp-bound signature (replay-safe). The legacy payload-only
  // X-Radar-Signature is kept for existing receivers.
  const timestampSec = Math.floor(Date.now() / 1000);
  const signatureT = secret ? computeTimestampedSignature(payloadString, secret, timestampSec) : undefined;
  const startTime = Date.now();

  // SSRF guard: destinationUrl is user-controlled (alert rule / test form).
  // Reject loopback, private ranges, metadata endpoints, non-http(s) up front.
  try {
    assertPublicHttpUrl(destinationUrl);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      logger.warn('Webhook delivery blocked by SSRF guard:', { destinationUrl });
      return {
        success: false,
        httpStatus: undefined,
        attempts: 0,
        durationMs: Date.now() - startTime,
        error: 'Destination URL is not allowed (must be a public http(s) URL).',
        signature,
      };
    }
    throw err;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AI-Model-Radar/1.0 Webhook-Delivery',
    'X-Radar-Delivery-Id': deliveryId,
  };

  if (signature) {
    headers['X-Radar-Signature'] = signature;
  }
  if (signatureT) {
    headers['X-Radar-Timestamp'] = String(timestampSec);
    headers['X-Radar-Signature-T'] = signatureT;
  }

  let attempts = 0;
  let lastError: string | undefined;
  let lastStatus: number | undefined;

  while (attempts < maxRetries) {
    attempts++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Redirects are followed manually with per-hop SSRF re-validation
      // (fetchWithSsrfRedirects) so a benign URL can't 302 into metadata.
      const response = await fetchWithSsrfRedirects(fetchFn, destinationUrl, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      lastStatus = response.status;

      if (response.ok) {
        const durationMs = Date.now() - startTime;
        await recordDigestDelivery({
          rule_id: ruleId,
          destination_url: destinationUrl,
          payload_preview: payloadString.substring(0, 200),
          http_status: lastStatus,
          attempts,
          delivered_at: new Date().toISOString(),
          success: true,
        }).catch(() => {});

        return {
          success: true,
          httpStatus: lastStatus,
          attempts,
          durationMs,
          signature,
        };
      } else {
        lastError = `HTTP error ${response.status}: ${response.statusText}`;
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastError = err.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : err.message || String(err);
    }

    // Exponential backoff with jitter before next attempt
    if (attempts < maxRetries) {
      const jitter = Math.random() * 40;
      const delay = baseDelayMs * Math.pow(2, attempts - 1) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  const durationMs = Date.now() - startTime;

  // Record failed delivery in audit table
  await recordDigestDelivery({
    rule_id: ruleId,
    destination_url: destinationUrl,
    payload_preview: payloadString.substring(0, 200),
    http_status: lastStatus,
    attempts,
    delivered_at: new Date().toISOString(),
    success: false,
    error_message: lastError,
  }).catch(() => {});

  // Park in the DLQ when requested so the payload survives past the audit
  // log and can be redriven. Never fails the delivery result itself.
  let dlqId: number | undefined;
  if (enqueueDlq) {
    try {
      const row = await enqueueDlqDelivery({
        delivery_id: deliveryId,
        rule_id: ruleId,
        destination_url: destinationUrl,
        payload: payloadString,
        attempts,
        max_attempts: dlqMaxAttempts,
        last_error: lastError,
      });
      dlqId = typeof row.id === 'number' ? row.id : undefined;
    } catch (dlqErr) {
      logger.warn('Webhook DLQ enqueue failed:', {
        error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
      });
    }
  }

  logger.warn('Webhook delivery failed after retries:', {
    destinationUrl,
    attempts,
    lastStatus,
    error: lastError,
  });

  return {
    success: false,
    httpStatus: lastStatus,
    attempts,
    durationMs,
    error: lastError,
    signature,
    dlqId,
  };
}

export interface DlqProcessResult {
  claimed: number;
  delivered: number;
  requeued: number;
  dead: number;
}

/**
 * DLQ worker: claims due rows and redelivers each exactly once per claim
 * (claimDlqDue flips rows to 'retrying' atomically). A redelivery round
 * reuses the inline retry budget; success marks delivered, failure
 * requeues with backoff or parks as dead past max_attempts. Unsigned
 * redeliveries stay unsigned — secrets are never persisted in the DLQ.
 */
export async function processDlqBatch(
  limit = 10,
  opts: { fetchFn?: typeof fetch; maxRetries?: number; timeoutMs?: number } = {}
): Promise<DlqProcessResult> {
  const claimed = await claimDlqDue(limit);
  const result: DlqProcessResult = { claimed: claimed.length, delivered: 0, requeued: 0, dead: 0 };
  for (const row of claimed) {
    if (typeof row.id !== 'number') continue;
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      await resolveDlqDelivery(row.id, {
        delivered: false,
        last_error: 'Stored payload is not valid JSON; cannot redeliver',
        attempts: Number(row.max_attempts),
      });
      result.dead += 1;
      continue;
    }
    const attempt = await deliverWebhookPayload(row.destination_url, payload, {
      ruleId: row.rule_id ?? undefined,
      maxRetries: opts.maxRetries ?? 3,
      timeoutMs: opts.timeoutMs ?? 5000,
      fetchFn: opts.fetchFn,
      enqueueDlq: false,
    });
    if (attempt.success) {
      await resolveDlqDelivery(row.id, { delivered: true });
      result.delivered += 1;
    } else {
      const updated = await resolveDlqDelivery(row.id, {
        delivered: false,
        last_error: attempt.error,
      });
      if (updated?.status === 'dead') result.dead += 1;
      else result.requeued += 1;
    }
  }
  return result;
}
