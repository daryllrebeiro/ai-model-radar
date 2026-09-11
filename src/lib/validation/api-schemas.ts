import { z } from 'zod';

export const modelsQuerySchema = z.object({
  q: z.string().max(100).optional(),
  provider: z.string().max(50).optional(),
  free: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
  // R3/R4 attribute filters (sourced static datasets, applied post-query —
  // no DB column, no event-history write). Absent = no filtering.
  tool_calling: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
  vision: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
  commercial: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
  // S7 compliance filters (provider-level sourced data, applied post-query).
  hipaa_eligible: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
  eu_residency: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
  // S9 category switch (chat | embedding | all). Absent = all.
  category: z.enum(['chat', 'embedding', 'all']).optional().default('all'),
  sortBy: z.enum(['name', 'price', 'context', 'updated']).default('name'),
  limit: z
    .string()
    .optional()
    .default('50')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(100)),
  offset: z
    .string()
    .optional()
    .default('0')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(0)),
});

export const eventsQuerySchema = z.object({
  types: z.string().optional(),
  type: z.string().optional(),
  provider: z.string().max(50).optional(),
  free: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
  q: z.string().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z
    .string()
    .optional()
    .default('50')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(100)),
  offset: z
    .string()
    .optional()
    .default('0')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(0)),
});

export const benchmarksQuerySchema = z.object({
  provider: z.string().max(50).optional(),
});

// ─── Mutation bodies (POST/PATCH/DELETE payloads) ──────────────────────
// Unknown keys are stripped (zod default): callers may smuggle extra fields
// (e.g. body emails) without effect — identity always comes from the session.
// Validation runs AFTER auth in every route, so auth failures stay 401.

export const watchlistMutationSchema = z.object({
  modelId: z.string().trim().min(1).max(200),
  action: z.enum(['add', 'remove']).optional(),
});

export const teamCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const teamRenameSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

const memberIdentity = {
  email: z.string().trim().email().max(254).optional(),
  userId: z.union([z.string().trim().min(1).max(254), z.number().int().positive()]).optional(),
};

export const teamMemberAddSchema = z
  .object({
    ...memberIdentity,
    role: z.enum(['member', 'admin']).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.email && val.userId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'email or userId is required',
        path: ['email'],
      });
    }
  });

export const teamMemberRemoveSchema = z
  .object({ ...memberIdentity })
  .superRefine((val, ctx) => {
    if (!val.email && val.userId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'email or userId is required',
        path: ['email'],
      });
    }
  });

export const teamWatchlistAddSchema = z.object({
  modelId: z.string().trim().min(1).max(200),
  action: z.enum(['add', 'remove']).optional(),
});

// Mirrors BudgetRuleInput. name/scope fall back to the route's historical
// defaults ('Unnamed budget' / 'personal') so payloads that omit them keep
// their existing behavior; monthly_budget_usd is always required.
export const governanceRuleCreateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  scope: z.enum(['personal', 'team']).optional().default('personal'),
  team_id: z.coerce.number().int().positive().optional().nullable(),
  monthly_budget_usd: z.coerce.number().positive().max(1_000_000_000),
  alert_threshold_pct: z.coerce.number().min(0).max(1).optional(),
  approval_required: z.boolean().optional(),
  hard_cap: z.boolean().optional(),
  notify_email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().email().max(254).optional().nullable()
  ),
  active: z.boolean().optional(),
});

export const approvalCreateSchema = z.object({
  rule_id: z.coerce.number().int().positive(),
  team_id: z.coerce.number().int().positive().optional().nullable(),
  from_model_id: z.string().trim().min(1).max(200),
  to_model_id: z.string().trim().min(1).max(200),
  monthly_savings_usd: z.coerce.number().min(0).optional(),
  requested_by: z.string().trim().email().max(254).optional(),
  quorum_required: z.coerce.number().int().min(1).max(10).optional(),
});

export const approvalDecideSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
});

const alertRuleConfigSchema = z.object({
  minPriceDropPct: z.coerce.number().optional(),
  minAbsoluteDropUsd: z.coerce.number().optional(),
  maxContextWindowTokens: z.coerce.number().optional(),
  minContextWindowTokens: z.coerce.number().optional(),
  alertOnFreeTier: z.boolean().optional(),
  alertOnNewModels: z.boolean().optional(),
  alertOnContextExpansion: z.boolean().optional(),
  watchedProvidersOnly: z.boolean().optional(),
  selectedProviders: z.array(z.string().max(100)).max(50).optional(),
  digestFrequency: z.enum(['instant', 'daily', 'weekly']).optional(),
  notificationChannel: z.enum(['in_app', 'email', 'webhook']).optional(),
  webhookUrl: z.string().max(2000).optional(),
  mode: z.enum(['basic', 'advanced']).optional(),
  requireFamousFamilies: z.boolean().optional(),
  suppressProviders: z.array(z.string().max(100)).max(50).optional(),
  matchModelId: z.string().max(200).optional(),
});

// Mirrors the accepted POST /api/v1/alerts/evaluate fields:
// { config?, limit?, watchedModelIds? }. All optional; absent body → {}.
export const alertsEvaluateSchema = z.object({
  config: alertRuleConfigSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  watchedModelIds: z.array(z.string().max(200)).max(1000).optional(),
});

export const askSchema = z.object({
  question: z.string().trim().min(3).max(2000),
  model_ids: z.array(z.string().max(200)).max(50).optional(),
  profile: z
    .object({
      primary_model_id: z.string().trim().min(1).max(200).optional(),
      monthly_prompt_tokens: z.coerce.number().min(0).optional(),
      monthly_comp_tokens: z.coerce.number().min(0).optional(),
      cache_hit_ratio: z.coerce.number().optional(),
      batch_discount: z.coerce.number().optional(),
    })
    .optional(),
});

export const recommendProfileSchema = z.object({
  primary_model_id: z.string().trim().min(1).max(200),
  monthly_prompt_tokens: z.coerce.number().min(0).optional(),
  monthly_comp_tokens: z.coerce.number().min(0).optional(),
  cache_hit_ratio: z.coerce.number().optional(),
  batch_discount: z.coerce.number().optional(),
});

export const recommendSchema = z.object({
  profile: recommendProfileSchema.optional(),
});

export const checkoutSchema = z.object({
  tier: z.enum(['developer', 'production']),
  successUrl: z.string().max(2000).optional(),
  cancelUrl: z.string().max(2000).optional(),
});

export const portalSchema = z.object({
  returnUrl: z.string().max(2000).optional(),
});

// Shared with POST /api/alerts/test (kept behavior-identical to its former
// local definition).
export const testWebhookSchema = z.object({
  destinationUrl: z.string().url(),
  secret: z.string().optional(),
  event: z.record(z.any()).optional(),
});

// R5 usage import (CSV upload MVP). Caps mirror src/lib/usage-import.ts.
export const usageImportSchema = z.object({
  filename: z.string().trim().max(255).optional().default(''),
  csv: z.string().min(1).max(2 * 1024 * 1024),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

// R6 compound rule (fixed condition set — no expression language).
export const compoundConditionSchema = z.object({
  field: z.enum(['category', 'price_drop_pct', 'context_min', 'provider', 'event_type']),
  op: z.enum(['eq', 'gte', 'lte', 'contains']),
  value: z.union([z.string().max(200), z.number()]),
});

export const compoundRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  logic: z.enum(['and', 'or']).default('and'),
  conditions: z.array(compoundConditionSchema).min(1).max(10),
  channel: z.enum(['webhook', 'email']).default('webhook'),
  destination: z.string().trim().min(1).max(2000),
});

// R7 case study submission (explicit public-sharing consent required).
export const caseStudySchema = z.object({
  team_name: z.string().trim().max(120).optional().default(''),
  from_model_id: z.string().trim().min(1).max(200),
  to_model_id: z.string().trim().min(1).max(200),
  savings_usd_per_month: z.coerce.number().min(0).max(10_000_000),
  period_label: z.string().trim().max(60).optional().default(''),
  story: z.string().trim().max(5000).optional().default(''),
  usage_import_id: z.coerce.number().int().positive().optional().nullable(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Explicit public-sharing consent is required.' }) }),
});

// R10 routing request (pilot). routing_policy is REQUIRED for any model
// substitution — absent policy means "use my model verbatim or 400".
export const routingRequestSchema = z.object({
  model: z.string().trim().min(1).max(200).optional(),
  messages: z.array(z.object({ role: z.string().max(50), content: z.unknown() })).min(1).max(500),
  routing_policy: z.enum(['cheapest', 'benchmark', 'fallback_chain']).optional(),
  fallback_models: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  on_failure: z.enum(['fail_closed', 'fail_open_original']).optional().default('fail_closed'),
  stream: z.boolean().optional(),
}).passthrough();

// R8 export connector config (secret is write-only, never returned).
export const exportConnectorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['datadog', 'grafana', 'notion', 'airtable']),
  destination_url: z.string().trim().max(2000).optional().default(''),
  secret: z.string().max(2000).optional(),
});
