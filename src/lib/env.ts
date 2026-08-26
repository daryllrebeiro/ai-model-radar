import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().optional(),
  CRON_SECRET: z.string().min(8).optional(),
  ADMIN_SECRET: z.string().min(8).optional(),
  GITHUB_TOKEN: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  HEARTBEAT_URL: z.string().url().optional(),
  PRUNE_DAYS: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 30)),
});

export type EnvConfig = z.infer<typeof envSchema>;

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

  return {
    valid: true,
    env: result.data,
  };
}
