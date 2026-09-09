import { z } from 'zod';

export const modelsQuerySchema = z.object({
  q: z.string().max(100).optional(),
  provider: z.string().max(50).optional(),
  free: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
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
