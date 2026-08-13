import { Logger } from '@profitpilot/logger'
import type { JsonObject } from '@profitpilot/logger'

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
  return env.SENTRY_ENABLED === 'true' && env.SENTRY_DSN?.trim() ? new LoggerErrorMonitor(logger) : new NoopErrorMonitor()
}
