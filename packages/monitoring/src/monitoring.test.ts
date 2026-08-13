import { describe, expect, it } from 'vitest'
import { Logger, createMemorySink } from '@profitpilot/logger'
import { LoggerErrorMonitor, MemoryErrorMonitor, NoopErrorMonitor, monitoringFromEnv } from './index.js'

describe('monitoring adapters', () => {
  it('stores error events in memory', () => {
    const monitor = new MemoryErrorMonitor()
    monitor.capture(new Error('boom'), { requestId: 'r1' })
    expect(monitor.events[0]?.error.message).toBe('boom')
  })
  it('does not throw in no-op mode', () => expect(() => new NoopErrorMonitor().capture(new Error('ignored'))).not.toThrow())
  it('logs errors through the logger adapter', () => {
    const memory = createMemorySink()
    new LoggerErrorMonitor(new Logger(memory.sink)).capture(new Error('boom'))
    expect(memory.records[0]?.message).toBe('boom')
  })
  it('selects no-op when Sentry is disabled', () => expect(monitoringFromEnv({}, new Logger())).toBeInstanceOf(NoopErrorMonitor))
  it('selects logger adapter when Sentry config is present', () => expect(monitoringFromEnv({ SENTRY_ENABLED: 'true', SENTRY_DSN: 'https://dsn' }, new Logger())).toBeInstanceOf(LoggerErrorMonitor))
})
