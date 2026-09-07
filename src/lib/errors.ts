/**
 * Typed error hierarchy for consistent API error responses.
 * Each error maps to a specific HTTP status code and can carry
 * structured context for debugging and client handling.
 */

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string; // machine-readable error code
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.context && { context: this.context }),
    };
  }
}

// 400 - Bad Request / Validation
export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

// 401 - Unauthorized
export class AuthError extends AppError {
  readonly statusCode = 401;
  readonly code = 'UNAUTHORIZED';
  constructor(message: string = 'Authentication required', context?: Record<string, unknown>) {
    super(message, context);
  }
}

// 403 - Forbidden
export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';
  constructor(message: string = 'Access denied', context?: Record<string, unknown>) {
    super(message, context);
  }
}

// 404 - Not Found
export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor(message: string = 'Resource not found', context?: Record<string, unknown>) {
    super(message, context);
  }
}

// 409 - Conflict
export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
  constructor(message: string = 'Resource conflict', context?: Record<string, unknown>) {
    super(message, context);
  }
}

// 422 - Unprocessable Entity (semantic validation)
export class UnprocessableError extends AppError {
  readonly statusCode = 422;
  readonly code = 'UNPROCESSABLE';
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}

// 429 - Too Many Requests
export class RateLimitError extends AppError {
  readonly statusCode = 429;
  readonly code = 'RATE_LIMITED';
  readonly retryAfter?: number;
  constructor(message: string = 'Too many requests', retryAfter?: number, context?: Record<string, unknown>) {
    super(message, context);
    this.retryAfter = retryAfter;
  }
  override toJSON() {
    return { ...super.toJSON(), ...(this.retryAfter && { retryAfter: this.retryAfter }) };
  }
}

// 500 - Internal Server Error
export class InternalError extends AppError {
  readonly statusCode = 500;
  readonly code = 'INTERNAL_ERROR';
  constructor(message: string = 'Internal server error', context?: Record<string, unknown>) {
    super(message, context);
  }
}

// 503 - Service Unavailable
export class ServiceUnavailableError extends AppError {
  readonly statusCode = 503;
  readonly code = 'SERVICE_UNAVAILABLE';
  constructor(message: string = 'Service temporarily unavailable', context?: Record<string, unknown>) {
    super(message, context);
  }
}

/**
 * Maps any error to an AppError. Unknown errors become InternalError.
 * Preserves AppError instances, wraps others.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    // Zod validation errors
    if (err.name === 'ZodError') {
      const zodErr = err as any;
      return new ValidationError('Invalid request payload', { issues: zodErr.issues });
    }
    // Postgres unique violation
    if ('code' in err && (err as any).code === '23505') {
      return new ConflictError('Resource already exists');
    }
    // Postgres FK violation
    if ('code' in err && (err as any).code === '23503') {
      return new ValidationError('Referenced resource does not exist');
    }
    // Unknown errors: generic client message only. The original message,
    // name, and stack stay server-side via captureException — never ship
    // raw err.message (Postgres/connection internals) to the client.
    return new InternalError();
  }
  return new InternalError();
}

/**
 * Express/Next.js compatible handler that returns a typed JSON response
 * with the correct status code based on the error type.
 */
export function handleAppError(err: unknown): { status: number; body: any } {
  const appErr = toAppError(err);
  return {
    status: appErr.statusCode,
    body: appErr.toJSON(),
  };
}

/**
 * Captures an exception for logging/monitoring. Returns a structured
 * report that can be sent to an error tracking service.
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): { errorName: string; errorMessage: string; stack?: string; context?: Record<string, unknown> } {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack,
      context,
    };
  }
  return {
    errorName: 'UnknownError',
    errorMessage: String(error),
    context,
  };
}