import { NextResponse } from 'next/server';
import { captureException } from './errors';

/**
 * Global API error handler. Logs full error detail server-side and returns
 * a safe, generic message to the client. Never leaks internal error details.
 */
export function handleApiError(
  error: unknown,
  context?: string
): NextResponse {
  captureException(error, { route: context });

  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  );
}
