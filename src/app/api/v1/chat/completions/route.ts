import { NextRequest, NextResponse } from 'next/server';
import {
  getModelCurrentList,
  getRecentEndpointTelemetry,
  getBudgetRulesForUser,
  getBudgetAlerts,
  getLatestSnapshotsMap,
  recordBudgetAlert,
} from '@/lib/db/queries';
import { validatePublicApiRequest } from '@/lib/api-auth';
import { hasAccess } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';
import { resolveRuleUsage, evaluateBudgetRule } from '@/lib/governance';
import { checkCircuitBreaker, msUntilMonthReset } from '@/lib/spend-breaker';
import {
  getDefaultPolicy,
  selectBestModel,
  type ModelCandidate,
} from '@/lib/router';

export const dynamic = 'force-dynamic';

interface ChatCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  top_p?: number;
  n?: number;
  stop?: string | string[];
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  stream?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await validatePublicApiRequest(request);
    if (!auth.allowed && auth.errorResponse) {
      return auth.errorResponse;
    }

    // Routing requires at least public API access.
    if (!hasAccess(auth.tier, 'PUBLIC_API_READ')) {
      return NextResponse.json(
        { error: 'Access denied. Requires an API tier with public API access.' },
        { status: 403, headers: auth.rateLimitHeaders }
      );
    }

    // Spend Circuit Breaker: block proxied calls when a hard-cap budget
    // rule for the caller's scope is over 100% projected spend. Skipped
    // entirely when the caller has no hard-cap rules (zero extra queries).
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

    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request: messages must be a non-empty array' },
        { status: 400, headers: auth.rateLimitHeaders }
      );
    }

    const requestBody = body as ChatCompletionRequest;
    const modelHint = typeof requestBody.model === 'string' ? requestBody.model.trim() : '';

    if (requestBody.stream) {
      return NextResponse.json(
        { error: 'Streaming responses are not supported on this endpoint yet' },
        { status: 400, headers: auth.rateLimitHeaders }
      );
    }

    // Get current catalog + latest probe telemetry in parallel. Health is
    // derived per model from the newest telemetry record: explicit
    // online=false excludes the model under require_healthy; models with no
    // telemetry are allowed but rank below known-healthy ones.
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

    // An explicit model request bypasses policy routing but must exist.
    let selectedModel: ModelCandidate | null = null;
    if (modelHint) {
      const explicit = candidates.find(
        (m) => m.model_id === modelHint || m.name.toLowerCase() === modelHint.toLowerCase()
      );
      if (!explicit) {
        return NextResponse.json(
          { error: `Model '${modelHint}' not found or not available` },
          { status: 404, headers: auth.rateLimitHeaders }
        );
      }
      selectedModel = explicit;
    } else {
      selectedModel = selectBestModel(candidates, getDefaultPolicy(auth.tier));
    }

    if (!selectedModel) {
      return NextResponse.json(
        { error: 'No suitable model available matching policy constraints' },
        { status: 503, headers: auth.rateLimitHeaders }
      );
    }

    // TODO: proxy the messages to the selected model's provider endpoint.
    // For now, return the routing decision in OpenAI chat.completion shape.
    return NextResponse.json(
      {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: selectedModel.model_id,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Model routing not yet implemented - this is the router stub.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        routing: {
          selected_model: selectedModel.model_id,
          selected_provider: selectedModel.provider,
          policy_tier: auth.tier,
        },
      },
      { headers: auth.rateLimitHeaders }
    );
  } catch (error: any) {
    logger.error('Chat completion error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
