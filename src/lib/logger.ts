export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  runId?: string;
  source?: string;
  modelId?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
}

/**
 * Keys whose values must never reach logs (secrets, tokens, signatures).
 * Matched case-insensitively against context key names.
 */
const REDACTED_KEY_RE = /(password|passwd|secret|token|api[-_]?key|signature|authorization|bearer|private[-_]?key|webhook[-_]?secret)/i;
const REDACTED = '[REDACTED]';

function redactValue(key: string, value: unknown): unknown {
  if (REDACTED_KEY_RE.test(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactValue(key, v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(k, v);
    }
    return out;
  }
  return value;
}

function redactContext(context?: LogContext): LogContext | undefined {
  if (!context) return undefined;
  return redactValue('', context) as LogContext;
}

/**
 * One-way hash for logging client identifiers (IPs) without storing PII.
 * Lets auth-failure audit trails correlate attackers without retaining IPs.
 */
export function hashIp(ip: string): string {
  // FNV-1a 32-bit: dependency-free, stable within a deployment for correlation.
  let h = 0x811c9dc5;
  for (let i = 0; i < ip.length; i++) {
    h ^= ip.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `ip_${(h >>> 0).toString(16)}`;
}

/**
 * One-way hash for logging email identifiers without storing PII.
 * Use in log messages instead of interpolating raw emails.
 */
export function hashEmail(email: string): string {
  const normalized = String(email || '').trim().toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `email_${(h >>> 0).toString(16)}`;
}

/**
 * Structured JSON logger with correlation IDs for end-to-end ingestion tracing.
 * Context is scrubbed for secret-shaped keys before serialization.
 */
export class StructuredLogger {
  private baseContext: LogContext;

  constructor(baseContext: LogContext = {}) {
    this.baseContext = (redactValue('', baseContext) as LogContext) || {};
  }

  public child(context: LogContext): StructuredLogger {
    return new StructuredLogger({ ...this.baseContext, ...(redactValue('', context) as LogContext) });
  }

  private log(level: LogLevel, message: string, context?: LogContext) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.baseContext, ...redactContext(context) },
    };

    const formatted = JSON.stringify(entry);

    switch (level) {
      case 'debug':
        if (process.env.NODE_ENV !== 'production' || process.env.DEBUG) {
          console.debug(formatted);
        }
        break;
      case 'info':
        console.info(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }
  }

  public debug(message: string, context?: LogContext) {
    this.log('debug', message, context);
  }

  public info(message: string, context?: LogContext) {
    this.log('info', message, context);
  }

  public warn(message: string, context?: LogContext) {
    this.log('warn', message, context);
  }

  public error(message: string, context?: LogContext) {
    this.log('error', message, context);
  }
}

export const logger = new StructuredLogger({ service: 'ai-model-radar' });
