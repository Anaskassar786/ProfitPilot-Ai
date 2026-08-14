import type { ErrorMonitor } from './monitor.js'

export type ProductAnalytics = Readonly<{ capture(event: string, properties: Readonly<Record<string, string | number | boolean | null>>): void; identify(distinctId: string, properties?: Readonly<Record<string, string | number | boolean | null>>): void }>
export type PosthogConfig = Readonly<{ apiKey: string; host: string; fetcher?: (input: string, init: RequestInit) => Promise<Response> }>

export class NoopProductAnalytics implements ProductAnalytics { public capture(_event: string, _properties: Readonly<Record<string, string | number | boolean | null>>): void { return undefined } public identify(_distinctId: string, _properties: Readonly<Record<string, string | number | boolean | null>> = {}): void { return undefined } }
export class PosthogAnalytics implements ProductAnalytics {
  private readonly config: Readonly<{ apiKey: string; host: string; fetcher: (input: string, init: RequestInit) => Promise<Response> }>
  public constructor(config: PosthogConfig) { if (!config.apiKey.trim() || !config.host.startsWith('http')) throw new TypeError('PostHog configuration is incomplete'); this.config = { ...config, host: config.host.replace(/\/$/, ''), fetcher: config.fetcher ?? fetch } }
  public capture(event: string, properties: Readonly<Record<string, string | number | boolean | null>>): void { void this.send({ event, properties: { ...properties, token: this.config.apiKey }, api_key: this.config.apiKey }) }
  public identify(distinctId: string, properties: Readonly<Record<string, string | number | boolean | null>> = {}): void { void this.send({ event: '$identify', distinct_id: distinctId, properties: { ...properties, token: this.config.apiKey }, api_key: this.config.apiKey }) }
  private async send(payload: Readonly<Record<string, unknown>>): Promise<void> { try { await this.config.fetcher(`${this.config.host}/capture/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }) } catch { return } }
}

export function posthogFromEnv(env: Readonly<Record<string, string | undefined>>): ProductAnalytics { const apiKey = env.POSTHOG_API_KEY?.trim(); return apiKey ? new PosthogAnalytics({ apiKey, host: env.POSTHOG_HOST?.trim() || 'https://app.posthog.com' }) : new NoopProductAnalytics() }
export function productAnalyticsErrorMonitor(analytics: ProductAnalytics): ErrorMonitor { return { capture: (error, context = {}) => analytics.capture('api_error', { error: error.name, message: error.message, ...context }) } }
