import { Logger } from '@profitpilot/logger'
import type { JsonObject } from '@profitpilot/logger'
import { SentryMonitor } from './sentry.js'

export type ErrorEvent = Readonly<{ error: Error; context: JsonObject; timestamp: string }>
export interface ErrorMonitor {
  capture(error: Error, context?: JsonObject): void
}

export class NoopErrorMonitor implements ErrorMonitor {
  public capture(_error: Error, _context: JsonObject = {}): void {
    return undefined
  }
}

export class MemoryErrorMonitor implements ErrorMonitor {
  public readonly events: ErrorEvent[] = []

  public capture(error: Error, context: JsonObject = {}): void {
    this.events.push({ error, context, timestamp: new Date().toISOString() })
  }
}

export class LoggerErrorMonitor implements ErrorMonitor {
  private readonly logger: Logger

  public constructor(logger: Logger) {
    this.logger = logger
  }

  public capture(error: Error, context: JsonObject = {}): void {
    this.logger.error(error.message, { ...context, errorName: error.name })
  }
}

export function monitoringFromEnv(env: Readonly<Record<string, string | undefined>>, logger: Logger): ErrorMonitor {
  const dsn = env.SENTRY_DSN?.trim()
  if (!dsn) return new NoopErrorMonitor()
  try { return new SentryMonitor({ dsn, release: env.RELEASE_VERSION?.trim() || env.RAILWAY_GIT_COMMIT_SHA?.trim() || 'development', environment: env.NODE_ENV?.trim() || 'development' }) } catch { return env.SENTRY_ENABLED === 'true' ? new LoggerErrorMonitor(logger) : new NoopErrorMonitor() }
}
