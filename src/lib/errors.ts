import { logger } from './logger';

export interface ErrorReport {
  timestamp: string;
  errorName: string;
  errorMessage: string;
  stack?: string;
  context?: Record<string, any>;
}

/**
 * Centralized error tracking and reporting utility (Sentry-ready)
 */
export function captureException(
  error: unknown,
  context?: Record<string, any>
): ErrorReport {
  const err = error instanceof Error ? error : new Error(String(error));

  const report: ErrorReport = {
    timestamp: new Date().toISOString(),
    errorName: err.name || 'Error',
    errorMessage: err.message || 'Unknown error',
    stack: err.stack,
    context,
  };

  logger.error(`Exception captured: ${report.errorMessage}`, {
    errorName: report.errorName,
    stack: report.stack,
    ...context,
  });

  return report;
}
