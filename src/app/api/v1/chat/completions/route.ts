import { NextRequest, NextResponse } from 'next/server';
import {
  getModelCurrentList,
  getRecentEndpointTelemetry,
  getBudgetRulesForUser,
  getBudgetAlerts,
  getLatestSnapshotsMap,
  recordBudgetAlert,
  upsertShadowFinding,
  checkRoutingPilot,
} from '@/lib/db/queries';
import { forwardToUpstream, buildFailOpenBody, logRoutingAttempt } from '@/lib/routing/forward';
import { validatePublicApiRequest } from '@/lib/api-auth';
import { hasAccess, normalizeTier } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';
import { resolveRuleUsage, evaluateBudgetRule } from '@/lib/governance';
import { checkCircuitBreaker, msUntilMonthReset } from '@/lib/spend-breaker';
import { RAW_BENCHMARK_DATA } from '@/lib/benchmarks';
import {
  getDefaultPolicy,
  selectBestModel,
  selectBenchmarkModel,
  selectFallbackModel,
  type ModelCandidate,
} from '@/lib/router';
import { routingRequestSchema } from '@/lib/validation/api-schemas';

export const dynamic = 'force-dynamic';

/**
 * R10 — POST /api/v1/chat/completions (pilot-gated inference routing gateway).
 *
 * ADR-010 rules, enforced in code:
 *  - Deny-by-default: ROUTING_ENABLED + pilot allowlist + per-user opt-in.
 *  - No silent substitution: `model` without `routing_policy` is used verbatim;
 *    substitution needs an explicit per-request routing_policy.
 *  - Fail-closed default; fail_open_original is explicit and never substitutes.
 *  - One upstream attempt, never retried (double-bill risk). Every decision logged.
 */
export async function POST(request: NextRequest) {
  const t0 = Date.now();
  try {
    const auth = await validatePublicApiRequest(request);
    if (!auth.allowed && auth.errorResponse) {
      return auth.errorResponse;
    }

    // API keys speak the free/developer/production vocabulary — normalize
    // before hasAccess, which denies unrecognized values (see feature-flags).
    if (!hasAccess(normalizeTier(auth.tier), 'PUBLIC_API_READ')) {
      return NextResponse.json(
        { error: 'Access denied. Requires an API tier with public API access.' },
        { status: 403, headers: auth.rateLimitHeaders }
      );
    }

    // Pilot gate before any routing logic or spend checks.
    const pilot = await checkRoutingPilot(auth.ownerEmail);
    if (!pilot.ok) {
      const disabled = process.env.ROUTING_ENABLED !== 'true';
      return NextResponse.json(
        { error: disabled ? 'Routing gateway is disabled.' : 'Routing gateway is in closed pilot.' },
        { status: disabled ? 503 : 403, headers: auth.rateLimitHeaders }
      );
    }

    // Spend Circuit Breaker (unchanged): hard-cap rules block proxied calls.
    if (auth.ownerEmail) {
      const rules = await getBudgetRulesForUser(auth.ownerEmail);
      const hardCapRules = rules.filter((r) => r.active && r.hard_cap === true);
      if (hardCapRules.length > 0) {
        const snapshots = Array.from((await getLatestSnapshotsMap()).values());
        const evaluations = [];
        for (const rule of hardCapRules) {
          const usage = await resolveRuleUsage(rule);
          evaluations.push(evaluateBudgetRule(rule, usage, snapshots));
        }
        const breaker = checkCircuitBreaker(evaluations);
        if (breaker.tripped) {
          const ruleIds = hardCapRules
            .map((r) => r.id)
            .filter((id): id is number => typeof id === 'number');
          const recent = ruleIds.length > 0
            ? await getBudgetAlerts({ ruleIds, sinceHours: 24, limit: 50 })
            : [];
          for (const ev of breaker.trippedEvaluations) {
            if (!ev.new_alert || ev.rule.id === undefined) continue;
            const dup = recent.some(
              (a) =>
                a.rule_id === ev.rule.id &&
                a.alert_type === 'over_budget' &&
                a.model_family === ev.new_alert!.model_family
            );
            if (!dup) {
              await recordBudgetAlert({ ...ev.new_alert, rule_id: ev.rule.id });
            }
          }
          const retryAfterSec = Math.max(1, Math.ceil(msUntilMonthReset() / 1000));
          return NextResponse.json(
            {
              error: 'Spend limit reached. Proxied calls are blocked until the monthly budget resets.',
              tripped_rule_ids: breaker.trippedRuleIds,
            },
            {
              status: 429,
              headers: {
                ...auth.rateLimitHeaders,
                'Retry-After': String(retryAfterSec),
                'X-Spend-Breaker': 'tripped',
              },
            }
          );
        }
      }
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = routingRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request: messages must be a non-empty array (≤500).' },
        { status: 400, headers: auth.rateLimitHeaders }
      );
    }
    const body = parsed.data;
    const modelHint = body.model || '';

    if (body.stream) {
      return NextResponse.json(
        { error: 'Streaming responses are not supported on this endpoint yet' },
        { status: 400, headers: auth.rateLimitHeaders }
      );
    }

    const [{ models }, telemetry] = await Promise.all([
      getModelCurrentList({ limit: 500 }),
      getRecentEndpointTelemetry({ limit: 500 }),
    ]);
    const healthByModel = new Map<string, boolean>();
    for (const t of telemetry) {
      if (!healthByModel.has(t.model_id)) {
        healthByModel.set(t.model_id, t.online);
      }
    }
    const candidates: ModelCandidate[] = models.map((m) => ({
      model_id: m.model_id,
      provider: m.provider,
      name: m.name,
      price_prompt: m.price_prompt,
      price_completion: m.price_completion,
      context_length: m.context_length,
      is_free: m.is_free,
      provider_healthy: healthByModel.get(m.model_id) ?? true,
    }));

    // Selection. Explicit model wins verbatim (no substitution, policy ignored).
    // No model + no policy → 400: never apply default smart routing silently.
    let selectedModel: ModelCandidate | null = null;
    let policyUsed = 'explicit';
    if (modelHint) {
      const explicit = candidates.find(
        (m) => m.model_id === modelHint || m.name.toLowerCase() === modelHint.toLowerCase()
      );
      if (!explicit) {
        if (auth.ownerEmail) {
          try {
            await upsertShadowFinding({
              model_id: modelHint.slice(0, 500),
              scope: 'personal',
              owner_email: auth.ownerEmail,
              estimated_monthly_usd: 0,
              reason: 'Model requested via Radar Router but not tracked in the radar catalog.',
            });
          } catch (hookErr) {
            logger.warn('Shadow-AI router hook failed:', {
              error: hookErr instanceof Error ? hookErr.message : String(hookErr),
            });
          }
        }
        return NextResponse.json(
          { error: `Model '${modelHint}' not found or not available` },
          { status: 404, headers: auth.rateLimitHeaders }
        );
      }
      selectedModel = explicit;
    } else if (!body.routing_policy) {
      return NextResponse.json(
        { error: 'Invalid request: provide "model" or an explicit "routing_policy" (cheapest|benchmark|fallback_chain). No default routing is applied.' },
        { status: 400, headers: auth.rateLimitHeaders }
      );
    } else if (body.routing_policy === 'cheapest') {
      policyUsed = 'cheapest';
      selectedModel = selectBestModel(candidates, getDefaultPolicy(auth.tier));
    } else if (body.routing_policy === 'benchmark') {
      policyUsed = 'benchmark';
      const elo = new Map(
        RAW_BENCHMARK_DATA.filter((b) => b.arena_elo).map((b) => [b.model_id.toLowerCase(), b.arena_elo as number])
      );
      selectedModel = selectBenchmarkModel(candidates, getDefaultPolicy(auth.tier), elo);
    } else {
      policyUsed = 'fallback_chain';
      if (!body.fallback_models || body.fallback_models.length === 0) {
        return NextResponse.json(
          { error: 'Invalid request: fallback_chain requires "fallback_models".' },
          { status: 400, headers: auth.rateLimitHeaders }
        );
      }
      selectedModel = selectFallbackModel(candidates, body.fallback_models, true);
    }

    if (!selectedModel) {
      await logRoutingAttempt({
        ownerEmail: auth.ownerEmail, requested: modelHint || '(policy)', selected: '(none)', policy: policyUsed,
        upstreamStatus: null, latencyMs: Date.now() - t0, success: false, error: 'No suitable model matching policy constraints',
      });
      return NextResponse.json(
        { error: 'No suitable model available matching policy constraints' },
        { status: 503, headers: auth.rateLimitHeaders }
      );
    }

    const substituted = !modelHint || selectedModel.model_id !== modelHint;
    const upstreamBase = (process.env.ROUTING_UPSTREAM_BASE || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    const upstreamKey = process.env.ROUTING_UPSTREAM_KEY;
    if (!upstreamKey) {
      await logRoutingAttempt({
        ownerEmail: auth.ownerEmail, requested: modelHint || '(policy)', selected: selectedModel.model_id, policy: policyUsed,
        upstreamStatus: null, latencyMs: Date.now() - t0, success: false, error: 'No upstream configured',
      });
      return NextResponse.json(
        { error: 'Routing unavailable: no upstream provider is configured.' },
        { status: 503, headers: auth.rateLimitHeaders }
      );
    }

    // Single-attempt forward + explicit fail-open live in lib/routing/forward.ts.
    const { routing_policy, fallback_models, on_failure, ...passthrough } = body as Record<string, unknown>;
    void routing_policy; void fallback_models;
    const fwd = await forwardToUpstream({
      ownerEmail: auth.ownerEmail,
      upstreamBase,
      upstreamKey,
      body: passthrough,
      selectedModelId: selectedModel.model_id,
    });

    if (!fwd.ok) {
      const errText = fwd.error || 'Upstream provider failed.';
      if (on_failure === 'fail_open_original' && modelHint) {
        await logRoutingAttempt({
          ownerEmail: auth.ownerEmail, requested: modelHint, selected: modelHint, policy: `${policyUsed}+fail_open`,
          upstreamStatus: fwd.status, latencyMs: Date.now() - t0, success: false, error: errText,
        });
        return NextResponse.json(buildFailOpenBody(modelHint, errText), {
          headers: {
            ...auth.rateLimitHeaders,
            'X-Radar-Proxy-Fallback': '1',
            'X-Radar-Overhead-Ms': String(fwd.overheadMs),
          },
        });
      }
      await logRoutingAttempt({
        ownerEmail: auth.ownerEmail, requested: modelHint || '(policy)', selected: selectedModel.model_id, policy: policyUsed,
        upstreamStatus: fwd.status, latencyMs: Date.now() - t0, success: false, error: errText,
      });
      return NextResponse.json(
        { error: 'Upstream provider failed.', detail: errText, retry_direct_model: modelHint || undefined },
        {
          status: fwd.status === 429 ? 429 : 502,
          headers: { ...auth.rateLimitHeaders, 'X-Radar-Overhead-Ms': String(fwd.overheadMs) },
        }
      );
    }

    await logRoutingAttempt({
      ownerEmail: auth.ownerEmail, requested: modelHint || '(policy)', selected: selectedModel.model_id, policy: policyUsed,
      upstreamStatus: fwd.status, latencyMs: Date.now() - t0, success: true,
    });
    return NextResponse.json(fwd.payload, {
      headers: {
        ...auth.rateLimitHeaders,
        ...(substituted ? { 'X-Radar-Routed-Model': selectedModel.model_id } : {}),
        'X-Radar-Overhead-Ms': String(fwd.overheadMs),
      },
    });
  } catch (error: any) {
    logger.error('Chat completion error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
