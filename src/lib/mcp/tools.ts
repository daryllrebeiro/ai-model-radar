import { computeArbitrageOpportunities } from '../arbitrage';
import {
  getEvents,
  getLatestSnapshotsMap,
  getMarketStats,
  getModelCurrentList,
  getModelDetail,
} from '../db/queries';
import { detectMarketSignals } from '../signals';
import { getPriceDropForecasts } from '../forecast';
import { buildRecommendations, UsageProfileInput } from '../recommendation';
import { getRecentEndpointTelemetry } from '../db/queries';
import { evaluateEndpointHealth } from '../probe';
import {
  getBudgetRulesForUser,
  getAllBudgetRules,
  getMigrationApprovals,
} from '../db/queries';
import {
  resolveRuleUsage,
  evaluateBudgetRule,
  detectShadowAI,
  switchRequiresApproval,
} from '../governance';
import type { UsageByModel } from '@/types/governance';
import type { EventFilterParams } from '@/types/events';
import type { MarketSignal } from '@/types/signals';
import { answerQuestion, validateAnswer } from '../ask-answer';

export interface McpToolResult {
  data: unknown;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

export interface ListModelsOptions {
  provider?: string;
  isFree?: boolean;
  search?: string;
  limit?: number;
}

export async function mcpListModels(opts: ListModelsOptions = {}): Promise<McpToolResult> {
  const { provider, isFree, search, limit } = opts;
  const list = await getModelCurrentList({
    provider,
    isFree,
    search,
    sortBy: 'updated',
    sortOrder: 'desc',
    limit: clampLimit(limit, 50, 500),
  });
  return {
    data: {
      total: list.total,
      models: list.models.map((m) => ({
        model_id: m.model_id,
        name: m.name,
        provider: m.provider,
        price_prompt_per_1m: m.price_prompt === null ? null : m.price_prompt * 1_000_000,
        price_completion_per_1m: m.price_completion === null ? null : m.price_completion * 1_000_000,
        context_length: m.context_length,
        is_free: m.is_free,
        modality: m.modality,
        last_polled_at: m.polled_at,
      })),
    },
  };
}

export async function mcpGetModel(modelId: string, historyLimit?: number): Promise<McpToolResult> {
  const detail = await getModelDetail(modelId);
  if (!detail || !detail.current) {
    return { data: { found: false, model_id: modelId } };
  }
  const snapshots = detail.snapshots.slice(-clampLimit(historyLimit, 50, 500));
  return {
    data: {
      found: true,
      model_id: modelId,
      current: {
        name: detail.current.name,
        provider: detail.current.provider,
        price_prompt_per_1m: detail.current.price_prompt === null ? null : detail.current.price_prompt * 1_000_000,
        price_completion_per_1m: detail.current.price_completion === null ? null : detail.current.price_completion * 1_000_000,
        context_length: detail.current.context_length,
        is_free: detail.current.is_free,
        modality: detail.current.modality,
        last_polled_at: detail.current.polled_at,
      },
      snapshot_count: snapshots.length,
      recent_events: detail.events.slice(0, 50),
    },
  };
}

export async function mcpPriceHistory(modelId: string, limit?: number): Promise<McpToolResult> {
  const detail = await getModelDetail(modelId);
  if (!detail) {
    return { data: { found: false, model_id: modelId } };
  }
  const points = detail.snapshots.slice(-clampLimit(limit, 100, 1000));
  return {
    data: {
      model_id: modelId,
      name: detail.current?.name ?? modelId,
      points: points.map((s) => ({
        polled_at: s.polled_at,
        price_prompt_per_1m: s.price_prompt === null ? null : s.price_prompt * 1_000_000,
        price_completion_per_1m: s.price_completion === null ? null : s.price_completion * 1_000_000,
        context_length: s.context_length,
        is_free: s.is_free,
      })),
    },
  };
}

export interface RecentEventsOptions {
  eventTypes?: string[];
  provider?: string;
  search?: string;
  limit?: number;
}

export async function mcpRecentEvents(opts: RecentEventsOptions = {}): Promise<McpToolResult> {
  const { eventTypes, provider, search, limit } = opts;
  const res = await getEvents({
    eventTypes: eventTypes as EventFilterParams['eventTypes'],
    provider,
    search,
    limit: clampLimit(limit, 50, 500),
  });
  return { data: { total: res.total, hasMore: res.hasMore, events: res.events } };
}

export async function mcpSignals(limit?: number, severity?: 'high' | 'medium' | 'info'): Promise<McpToolResult> {
  const [snapshotsMap, eventsRes] = await Promise.all([
    getLatestSnapshotsMap(),
    getEvents({ limit: 500 }),
  ]);

  const snapshots = Array.from(snapshotsMap.values());
  const allSignals = detectMarketSignals(snapshots, eventsRes.events);
  const filtered = severity
    ? allSignals.filter((s) => s.severity === severity)
    : allSignals;
  const sorted = [...filtered].sort((a, b) => (b.strength || 0) - (a.strength || 0));

  return {
    data: {
      generated_at: new Date().toISOString(),
      summary: {
        total: allSignals.length,
        high: allSignals.filter((s) => s.severity === 'high').length,
        medium: allSignals.filter((s) => s.severity === 'medium').length,
        info: allSignals.filter((s) => s.severity === 'info').length,
        eol: allSignals.filter((s) => s.signal_type === 'MODEL_EOL').length,
      },
      signals: sorted.slice(0, clampLimit(limit, 20, 100)),
    },
  };
}

export async function mcpEolModels(limit?: number): Promise<McpToolResult> {
  const result = await mcpSignals(undefined);
  const signals = result.data as { signals: MarketSignal[] };
  return {
    data: {
      generated_at: new Date().toISOString(),
      eol_models: signals.signals.filter((s) => s.signal_type === 'MODEL_EOL').slice(0, clampLimit(limit, 50, 100)),
    },
  };
}

export async function mcpArbitrage(limit?: number): Promise<McpToolResult> {
  const snapshotsMap = await getLatestSnapshotsMap();
  const clusters = computeArbitrageOpportunities(Array.from(snapshotsMap.values()));
  return {
    data: {
      generated_at: new Date().toISOString(),
      cluster_count: clusters.length,
      clusters: clusters.slice(0, clampLimit(limit, 25, 200)),
    },
  };
}

export async function mcpMarketStats(): Promise<McpToolResult> {
  return { data: await getMarketStats() };
}

export interface ForecastOptions {
  limit?: number;
  minProbability?: number;
}

export async function mcpForecast(opts: ForecastOptions = {}): Promise<McpToolResult> {
  const [snapshotsMap, eventsRes] = await Promise.all([
    getLatestSnapshotsMap(),
    getEvents({ limit: 500 }),
  ]);

  const forecasts = getPriceDropForecasts(Array.from(snapshotsMap.values()), eventsRes.events, {
    minProbability: opts.minProbability ?? 0.35,
    maxForecasts: clampLimit(opts.limit, 15, 50),
  });

  return {
    data: {
      generated_at: new Date().toISOString(),
      summary: {
        total: forecasts.length,
        high_confidence: forecasts.filter((f) => f.confidence === 'high').length,
      },
      forecasts,
    },
  };
}

export interface MigrationRecommendationOptions {
  primaryModelId: string;
  monthlyPromptTokens: number;
  monthlyCompTokens: number;
  cacheHitRatio?: number;
  batchDiscount?: number;
}

export async function mcpMigrationRecommendation(opts: MigrationRecommendationOptions): Promise<McpToolResult> {
  const [snapshotsMap, eventsRes] = await Promise.all([
    getLatestSnapshotsMap(),
    getEvents({ limit: 500 }),
  ]);
  const snapshots = Array.from(snapshotsMap.values());
  const signals = detectMarketSignals(snapshots, eventsRes.events)
    .filter((s) => s.signal_type === 'MODEL_EOL' || s.signal_type === 'PRICE_DROP_EXPECTED');

  const profile: UsageProfileInput = {
    primary_model_id: opts.primaryModelId,
    monthly_prompt_tokens: Math.floor(opts.monthlyPromptTokens || 0),
    monthly_comp_tokens: Math.floor(opts.monthlyCompTokens || 0),
    cache_hit_ratio: opts.cacheHitRatio,
    batch_discount: opts.batchDiscount,
  };

  return {
    data: buildRecommendations({ profile, snapshots, signals }),
  };
}

export interface EndpointTelemetryOptions {
  modelId?: string;
  provider?: string;
  limit?: number;
  degradedOnly?: boolean;
}

export async function mcpEndpointTelemetry(opts: EndpointTelemetryOptions = {}): Promise<McpToolResult> {
  const telemetry = await getRecentEndpointTelemetry({
    modelId: opts.modelId,
    provider: opts.provider,
    limit: clampLimit(opts.limit, 50, 200),
  });

  const withHealth = telemetry.map((record) => ({
    ...record,
    health: evaluateEndpointHealth(record),
  }));

  const filtered = opts.degradedOnly
    ? withHealth.filter((r) => r.health.status !== 'healthy')
    : withHealth;

  return {
    data: {
      generated_at: new Date().toISOString(),
      summary: {
        total: withHealth.length,
        healthy: withHealth.filter((r) => r.health.status === 'healthy').length,
        degraded: withHealth.filter((r) => r.health.status === 'degraded').length,
        down: withHealth.filter((r) => r.health.status === 'down').length,
      },
      telemetry: filtered,
    },
  };
}

export interface AskRadarOptions {
  question: string;
  model_ids?: string[];
  primary_model_id?: string;
  monthly_prompt_tokens?: number;
  monthly_comp_tokens?: number;
  cache_hit_ratio?: number;
  batch_discount?: number;
}

/**
 * "Ask the Radar": conversational Q&A over snapshots, events, signals,
 * forecasts and probe telemetry. Deterministic retrieval; answers carry
 * citations that resolve back to the radar dataset the UI shows.
 */
export async function mcpAskRadar(opts: AskRadarOptions): Promise<McpToolResult> {
  const question = opts.question || 'What changed in the market recently?';

  const [snapshotsMap, eventsRes, telemetryRes] = await Promise.all([
    getLatestSnapshotsMap(),
    getEvents({ limit: 500 }),
    getRecentEndpointTelemetry({ limit: 500 }),
  ]);

  const snapshots = Array.from(snapshotsMap.values());
  const forecasts = getPriceDropForecasts(snapshots, eventsRes.events, {
    minProbability: 0.35,
    maxForecasts: 15,
  });
  const signals = detectMarketSignals(snapshots, eventsRes.events);

  const hasProfile =
    typeof opts.primary_model_id === 'string' &&
    opts.primary_model_id.length > 0 &&
    ((opts.monthly_prompt_tokens || 0) > 0 || (opts.monthly_comp_tokens || 0) > 0);

  const answer = await answerQuestion({
    question,
    context: {
      snapshots,
      events: eventsRes.events,
      signals,
      forecasts,
      telemetry: telemetryRes && telemetryRes.length > 0 ? telemetryRes : undefined,
    },
    profile: hasProfile
      ? {
          primary_model_id: opts.primary_model_id,
          monthly_prompt_tokens: opts.monthly_prompt_tokens,
          monthly_comp_tokens: opts.monthly_comp_tokens,
        }
      : undefined,
  });

  return {
    data: {
      question: answer.question,
      intent: answer.intent,
      answer: answer.answer,
      citations: answer.citations,
      profile_required: answer.profile_required,
      citations_validated: validateAnswer(answer, {
        snapshots,
        events: eventsRes.events,
        signals,
        forecasts,
        telemetry: telemetryRes && telemetryRes.length > 0 ? telemetryRes : undefined,
      }).length === 0,
    },
  };
}

export interface GovernanceStatusOptions {
  email?: string;
  limit?: number;
}

/**
 * Budget governance status: per-rule spend projections, shadow-AI findings and
 * the pending migration approval workflow. With no email, all rules are scanned.
 */
export async function mcpGovernanceStatus(opts: GovernanceStatusOptions = {}): Promise<McpToolResult> {
  const rules = opts.email
    ? await getBudgetRulesForUser(opts.email)
    : await getAllBudgetRules();

  const snapshots = Array.from((await getLatestSnapshotsMap()).values());
  const ruleIds = rules.filter((r) => r.id !== undefined).map((r) => r.id) as number[];

  const resolvedUsage = await Promise.all(rules.map((rule) => resolveRuleUsage(rule)));
  const evaluations = rules.map((rule, i) =>
    evaluateBudgetRule(rule, resolvedUsage[i] || [], snapshots)
  );

  const combos = new Map<string, UsageByModel>();
  for (const list of resolvedUsage) {
    for (const u of list) {
      const existing = combos.get(u.model_id);
      if (existing) {
        existing.monthly_prompt_tokens += u.monthly_prompt_tokens;
        existing.monthly_comp_tokens += u.monthly_comp_tokens;
      } else {
        combos.set(u.model_id, { ...u });
      }
    }
  }
  const shadowAI = detectShadowAI(Array.from(combos.values()), snapshots);

  const pending = ruleIds.length > 0
    ? await getMigrationApprovals({ ruleIds, status: 'pending', limit: 50 })
    : [];

  const gate = switchRequiresApproval(evaluations);

  return {
    data: {
      generated_at: new Date().toISOString(),
      total_budget_usd: Math.round(evaluations.filter((e) => e.rule.active).reduce((s, e) => s + e.rule.monthly_budget_usd, 0) * 100) / 100,
      projected_monthly_usd: Math.round(evaluations.reduce((s, e) => s + e.projected_monthly_usd, 0) * 100) / 100,
      approval_required_now: gate ? gate.rule.id : null,
      rules: evaluations.map((e) => ({
        rule_id: e.rule.id,
        name: e.rule.name,
        scope: e.rule.scope,
        monthly_budget_usd: e.rule.monthly_budget_usd,
        projected_monthly_usd: e.projected_monthly_usd,
        pct_used: e.pct_used,
        status: e.status,
        family_breakdown: e.family_breakdown.slice(0, clampLimit(opts.limit, 10, 50)),
      })),
      shadow_ai: shadowAI.slice(0, clampLimit(opts.limit, 20, 100)),
      pending_approvals: pending,
    },
  };
}