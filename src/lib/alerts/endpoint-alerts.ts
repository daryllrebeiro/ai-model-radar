import { EndpointTelemetry } from '@/types/telemetry';
import {
  EndpointAlertRuleConfig,
  EndpointAlertResult,
  EndpointAlert,
} from '@/types/alerts';
import { evaluateEndpointHealth } from '../probe';

/**
 * "Degraded endpoint" alert rule (Pro, APT_PROBE): flags endpoints whose live
 * telemetry shows downtime, excessive P95 latency, or heavy rate-limiting.
 * Deterministic — pure function over telemetry records, ready for tests.
 */
export function evaluateEndpointAlertRules(
  telemetry: EndpointTelemetry[],
  config: EndpointAlertRuleConfig = {}
): EndpointAlertResult {
  const maxLatency = config.maxP95LatencyMs ?? 8000;
  const maxRlPct = config.maxRateLimitedPct ?? 0.5;
  const minSeverity = config.minSeverity ?? 'degraded';
  const watchFreeTier = config.watchFreeTier ?? true;

  const providerSet = config.providers ? new Set(config.providers.map((p) => p.toLowerCase())) : null;

  const alerts: EndpointAlert[] = [];

  for (const record of telemetry) {
    if (providerSet && !providerSet.has(record.provider.toLowerCase())) continue;

    const health = evaluateEndpointHealth(record, {
      maxP95LatencyMs: maxLatency,
      maxRateLimitedPct: maxRlPct,
    });

    if (health.status === 'healthy') continue;
    if (!watchFreeTier) {
      const freeTierOnly = health.reasons.some((r) => r.includes('Free tier')) && health.reasons.length === 1;
      if (freeTierOnly && health.status === 'down' && record.is_free) {
        continue;
      }
    }
    if (health.status === 'degraded' && minSeverity === 'down') continue;

    alerts.push({
      record,
      severity: health.status === 'down' ? 'down' : 'degraded',
      reasons: health.reasons,
    });
  }

  // Down beats degraded when ordering for paging purposes.
  alerts.sort((a, b) => {
    if (a.reasons.length !== 0 && b.reasons.length !== 0) {
      const rank = a.severity === b.severity ? 0 : a.severity === 'down' ? -1 : 1;
      if (rank !== 0) return rank;
    }
    return 0;
  });

  return { alerts, total: alerts.length };
}