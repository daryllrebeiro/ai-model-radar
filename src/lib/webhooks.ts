import crypto from 'crypto';
import { recordDigestDelivery } from './db/queries';
import { logger } from './logger';

export interface WebhookDeliveryOptions {
  secret?: string;
  ruleId?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch; // Injectable for unit testing
}

export interface WebhookDeliveryResult {
  success: boolean;
  httpStatus?: number;
  attempts: number;
  durationMs: number;
  error?: string;
  signature?: string;
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
  } = options;

  const payloadString = JSON.stringify(payload);
  const deliveryId = `del-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const signature = secret ? computeHmacSignature(payloadString, secret) : undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AI-Model-Radar/1.0 Webhook-Delivery',
    'X-Radar-Delivery-Id': deliveryId,
  };

  if (signature) {
    headers['X-Radar-Signature'] = signature;
  }

  let attempts = 0;
  let lastError: string | undefined;
  let lastStatus: number | undefined;
  const startTime = Date.now();

  while (attempts < maxRetries) {
    attempts++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(destinationUrl, {
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
  };
}
