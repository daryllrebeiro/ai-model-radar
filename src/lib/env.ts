import { z } from 'zod';
import { logger } from './logger';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().optional(),
  CRON_SECRET: z.string().min(8).optional(),
  ADMIN_SECRET: z.string().min(8).optional(),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_POLL_INTERVAL_MINUTES: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 60)),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  HEARTBEAT_URL: z.string().url().optional(),
  STRIPE_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_DEVELOPER: z.string().optional(),
  STRIPE_PRICE_PRODUCTION: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  PRUNE_DAYS: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 30)),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  FEATURE_ENFORCEMENT: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  AUTH_SECRET: z.string().min(16).optional(),
  UNSUBSCRIBE_SECRET: z.string().min(16).optional(),
  OPENROUTER_API_URL: z.string().url().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Resolves the canonical public site URL from NEXT_PUBLIC_SITE_URL, falling back
 * to env.output value, then the historical production default. In production the
 * env schema requires NEXT_PUBLIC_SITE_URL, so the fallback only matters in dev.
 */
export function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    process.env.NEXT_PUBLIC_URL ||
    'https://ai-model-radar.com'
  );
}

let hasWarnedGithubToken = false;

/**
 * Validates and parses application environment variables
 */
export function validateEnv(processEnv: Record<string, any> = process.env): {
  valid: boolean;
  env: EnvConfig;
  errors?: string[];
} {
  const result = envSchema.safeParse(processEnv);

  if (!result.success) {
    const errorMessages = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    return {
      valid: false,
      env: processEnv as any,
      errors: errorMessages,
    };
  }

  const env = result.data;
  const errors: string[] = [];

  // Production-relevant secrets are validated loudly even though they are
  // schema-optional (so local/dev boot is frictionless).
  if (processEnv.NODE_ENV === 'production') {
    if (!processEnv.AUTH_SECRET || String(processEnv.AUTH_SECRET).length < 16) {
      errors.push(
        'AUTH_SECRET is required in production (>= 16 chars). Generate with: openssl rand -base64 32'
      );
    }
    if (!processEnv.DATABASE_URL) {
      errors.push('DATABASE_URL is required in production for durable storage.');
    }
    if (!processEnv.NEXT_PUBLIC_SITE_URL) {
      errors.push(
        'NEXT_PUBLIC_SITE_URL is required in production (used for RSS feeds, badges, canonical links).'
      );
    }
  }

  // Conditional validation when Stripe billing is enabled
  if (processEnv.STRIPE_ENABLED === 'true') {
    if (!processEnv.STRIPE_SECRET_KEY) {
      errors.push('STRIPE_SECRET_KEY is required when STRIPE_ENABLED=true');
    }
    if (!processEnv.STRIPE_WEBHOOK_SECRET) {
      errors.push('STRIPE_WEBHOOK_SECRET is required when STRIPE_ENABLED=true');
    }
  } else {
    // If billing is disabled, log debug note if Stripe keys exist
    if (processEnv.STRIPE_SECRET_KEY && processEnv.NODE_ENV !== 'production') {
      logger.debug('[Billing] STRIPE_SECRET_KEY is present but billing is disabled (STRIPE_ENABLED!=true).');
    }
  }

  // GitHub token advisory warning if unset
  if (!processEnv.GITHUB_TOKEN && !hasWarnedGithubToken && processEnv.NODE_ENV !== 'test') {
    hasWarnedGithubToken = true;
    logger.warn(
      '[github-labs] No GITHUB_TOKEN configured. Running unauthenticated (60 req/hr, shared across your hosting provider\'s egress IPs). This is fine at low polling volume but can cause intermittent rate-limit failures outside your control. Recommended: set GITHUB_TOKEN for 5,000 req/hr and a dedicated quota. See docs/GITHUB_INGESTION.md.'
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      env,
      errors,
    };
  }

  return {
    valid: true,
    env,
  };
}
