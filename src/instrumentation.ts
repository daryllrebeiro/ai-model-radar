import { validateEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

export async function register() {
  // Validate environment variables on server boot
  if (process.env.NEXT_RUNTIME === 'nodejs' || !process.env.NEXT_RUNTIME) {
    const envValidation = validateEnv();
    if (!envValidation.valid) {
      const errorSummary = (envValidation.errors || []).join('\n - ');
      logger.error(`CRITICAL: Environment validation failed on startup:\n - ${errorSummary}`);
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`CRITICAL: Production startup halted due to invalid environment variables:\n - ${errorSummary}`);
      }
    } else {
      logger.info('Environment variables validated successfully on startup.');
    }
  }
}
