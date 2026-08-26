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
 * Structured JSON logger with correlation IDs for end-to-end ingestion tracing
 */
export class StructuredLogger {
  private baseContext: LogContext;

  constructor(baseContext: LogContext = {}) {
    this.baseContext = baseContext;
  }

  public child(context: LogContext): StructuredLogger {
    return new StructuredLogger({ ...this.baseContext, ...context });
  }

  private log(level: LogLevel, message: string, context?: LogContext) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.baseContext, ...context },
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
