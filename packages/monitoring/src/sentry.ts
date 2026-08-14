import { randomUUID } from 'node:crypto'
import type { JsonObject } from '@profitpilot/logger'
import type { ErrorMonitor } from './monitor.js'

export type SentryConfig = Readonly<{ dsn: string; release: string; environment: string; fetcher?: (input: string, init: RequestInit) => Promise<Response> }>
export type PerformanceSpan = Readonly<{ name: string; op: string; startedAt: number; finish: (status?: string) => Promise<void> }>

export class SentryMonitor implements ErrorMonitor {
  private readonly config: Readonly<{ dsn: string; release: string; environment: string; fetcher: (input: string, init: RequestInit) => Promise<Response> }>
  public constructor(config: SentryConfig) { const parsed = parseDsn(config.dsn); if (!parsed) throw new TypeError('Sentry DSN is invalid'); this.config = { ...config, fetcher: config.fetcher ?? fetch } }
  public capture(error: Error, context: JsonObject = {}): void { void this.send({ exception: { values: [{ type: error.name, value: error.message, stacktrace: error.stack ? { frames: [] } : undefined }] }, fingerprint: [error.name, error.message], tags: { release: this.config.release, environment: this.config.environment }, extra: context }) }
  public captureStore(error: Error, storeId: string, context: JsonObject = {}): void { this.capture(error, { ...context, storeId }) }
  public startSpan(name: string, op = 'http.server'): PerformanceSpan { const startedAt = Date.now(); return { name, op, startedAt, finish: async (status = 'ok') => { await this.send({ transaction: name, start_timestamp: startedAt / 1000, timestamp: Date.now() / 1000, contexts: { trace: { op, status } }, tags: { release: this.config.release, environment: this.config.environment } }) } } }
  private async send(payload: Readonly<Record<string, unknown>>): Promise<void> { const target = parseDsn(this.config.dsn); if (!target) return; const eventId = randomUUID().replaceAll('-', ''); const envelope = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event', length: JSON.stringify({ event_id: eventId, ...payload }).length })}\n${JSON.stringify({ event_id: eventId, ...payload })}\n`; try { await this.config.fetcher(`${target.origin}/api/${target.projectId}/envelope/?sentry_version=7&sentry_key=${encodeURIComponent(target.publicKey)}`, { method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope' }, body: envelope }) } catch { return }
  }
}

export function sentryFromEnv(env: Readonly<Record<string, string | undefined>>): ErrorMonitor { const dsn = env.SENTRY_DSN?.trim(); return dsn ? new SentryMonitor({ dsn, release: env.RELEASE_VERSION?.trim() || env.RAILWAY_GIT_COMMIT_SHA?.trim() || 'development', environment: env.NODE_ENV?.trim() || 'development' }) : { capture: () => undefined } }
function parseDsn(value: string): Readonly<{ origin: string; publicKey: string; projectId: string }> | null { try { const url = new URL(value); const parts = url.pathname.split('/').filter(Boolean); const projectId = parts.at(-1); if (!projectId || !url.username) return null; return { origin: url.origin, publicKey: decodeURIComponent(url.username), projectId } } catch { return null } }
