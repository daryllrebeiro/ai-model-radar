import { NextResponse } from 'next/server';
import { captureException } from './errors';
import { toAppError, AppError } from './errors';

/**
 * Global API error handler. Logs full error detail server-side and returns
 * a typed JSON response with the correct HTTP status code based on error type.
 * Never leaks internal error details to the client.
 */
export function handleApiError(
  error: unknown,
  context?: string
): NextResponse {
  const appErr = toAppError(error);
  // Log the ORIGINAL error server-side (message, stack, pg codes) before
  // mapping to the sanitized client response.
  captureException(error, { route: context, code: appErr.code });

  return NextResponse.json(appErr.toJSON(), { status: appErr.statusCode });
}

/**
 * Helper to throw a typed AppError from a route. Use with `try/catch` +
 * `handleApiError` for consistent error responses.
 */
export function throwAppError(error: AppError): never {
  throw error;
}
