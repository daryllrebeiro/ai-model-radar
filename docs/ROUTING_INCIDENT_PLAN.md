# Routing Gateway — Incident Response Plan (R10 pilot)

## Failure modes and defined behavior

| Failure | Behavior | Signal |
|---|---|---|
| Upstream 5xx / timeout / unreachable (`fail_closed`, default) | 502/503 + structured error + `Retry-After`; attempt logged `success=false` | `routing_attempts` row, `X-Radar-Routed-Model` absent |
| Upstream failure (`fail_open_original`, explicit opt-in) | 200 shape-compatible fallback naming the ORIGINAL model, `proxy_fallback:true`; NO substitution, NO fabricated completion | response field + header `X-Radar-Proxy-Fallback: 1` |
| No upstream key configured | 503 "no upstream configured" — fail-closed, explicit | static message, no attempt ambiguity |
| Policy matches nothing | 503 "no suitable model" (existing) | static message |
| Spend breaker tripped | 429 + `X-Spend-Breaker: tripped` (existing) | existing breaker path |
| Gateway itself degraded (route throwing) | 500 generic (error taxonomy, no leakage) | `captureException` server-side |

## Detection (pilot)

- `GET /api/v1/routing/stats` (pilot-gated): 24h/7d success rate, p50/p95
  added overhead, per-policy breakdown. Page the on-call when 1h success
  < 99% or p95 overhead > 250ms.
- Every proxied call carries `X-Radar-Routed-Model` (substituted) or
  `X-Radar-Proxy-Fallback: 1` (fail-open) so callers can alert on their side.

## Response

1. **Kill switch first:** unset `ROUTING_ENABLED` (or set `false`) — endpoint
   goes 503 immediately, no deploy needed. Pilot callers fail over to direct
   provider calls.
2. **Shrink the pilot:** remove the caller from `ROUTING_PILOT_ALLOWLIST`
   while diagnosing; per-user removal, no global outage needed.
3. **Diagnose from `routing_attempts`:** filter by `success=false`, group by
   `policy` / `upstream_status` / `error` — distinguishes upstream outage
   (their 5xx) from selection bugs (our 503-no-match) from auth/config.
4. **No silent retries against billing:** the gateway never retries a
   non-idempotent upstream POST on timeout (a retry could double-bill).
   One attempt, logged; the caller retries.

## Recovery bar (before re-adding pilot users)

- 7 consecutive pilot days ≥99% successful-routing rate AND p95 added
  overhead < 250ms, per `routing/stats`.
- Any fail-open incident gets a written note in this file before re-enable.
