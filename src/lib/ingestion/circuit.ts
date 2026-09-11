/**
 * P3 per-source circuit breaker (multi-source consensus prerequisite).
 * One slow/dead source must stall neither the poll nor its siblings:
 * after `maxFailures` consecutive failures a source opens for `cooldownMs`
 * and fetches are skipped until the half-open probe succeeds.
 * In-memory by design (per-instance); durable failure history already
 * lives in ingestion_runs for ops review.
 */
import { logger } from '../logger';

export type BreakerState = 'closed' | 'open' | 'half-open';

interface BreakerEntry {
  failures: number;
  openedAt: number | null;
  lastError: string | null;
}

const breakers = new Map<string, BreakerEntry>();

export const SOURCE_BREAKER_MAX_FAILURES = 3;
export const SOURCE_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

function entry(source: string): BreakerEntry {
  let e = breakers.get(source);
  if (!e) {
    e = { failures: 0, openedAt: null, lastError: null };
    breakers.set(source, e);
  }
  return e;
}

/** True when the source may be fetched (closed, or cooldown elapsed → half-open). */
export function isSourceAvailable(source: string, nowMs = Date.now(), cooldownMs = SOURCE_BREAKER_COOLDOWN_MS): boolean {
  const e = breakers.get(source);
  if (!e || e.openedAt === null) return true;
  if (nowMs - e.openedAt >= cooldownMs) return true;
  return false;
}

export function recordSourceSuccess(source: string): void {
  const e = entry(source);
  e.failures = 0;
  e.openedAt = null;
  e.lastError = null;
}

export function recordSourceFailure(source: string, error: string, nowMs = Date.now()): BreakerState {
  const e = entry(source);
  e.failures++;
  e.lastError = String(error).slice(0, 500);
  if (e.failures >= SOURCE_BREAKER_MAX_FAILURES && e.openedAt === null) {
    e.openedAt = nowMs;
    logger.warn('Ingestion source breaker opened:', { source, failures: e.failures });
    return 'open';
  }
  return e.openedAt === null ? 'closed' : 'open';
}

export function breakerState(source: string, nowMs = Date.now(), cooldownMs = SOURCE_BREAKER_COOLDOWN_MS): BreakerState {
  const e = breakers.get(source);
  if (!e || e.openedAt === null) return 'closed';
  return nowMs - e.openedAt >= cooldownMs ? 'half-open' : 'open';
}

/** Test/ops reset. Never called by production paths. */
export function resetSourceBreakers(): void {
  breakers.clear();
}
