import { AppError } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'

export type SmsConfig = Readonly<{ enabled: boolean; accountSid?: string; authToken?: string; fromNumber?: string }>
export type SmsSender = Readonly<{ send(to: string, body: string, plan: PlanTier): Promise<Readonly<{ messageId: string }>> }>
export class TwilioSmsSender implements SmsSender {
  private readonly config: SmsConfig
  private readonly fetcher: typeof fetch
  public constructor(config: SmsConfig, fetcher: typeof fetch = fetch) { this.config = config; this.fetcher = fetcher }
  public async send(to: string, body: string, plan: PlanTier): Promise<Readonly<{ messageId: string }>> {
    if (plan === 'trial' || plan === 'start') throw new AppError('FORBIDDEN', 'SMS requires a Growth or Commander plan', 403, { plan })
    if (!this.config.enabled) throw new AppError('DEPENDENCY_ERROR', 'SMS is disabled until Twilio is configured', 503)
    if (!this.config.accountSid || !this.config.authToken || !this.config.fromNumber) throw new AppError('DEPENDENCY_ERROR', 'Twilio configuration is incomplete', 503)
    const response = await this.fetcher(`https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ To: to, From: this.config.fromNumber, Body: body }).toString() })
    if (!response.ok) throw new AppError('DEPENDENCY_ERROR', `Twilio request failed with ${response.status}`, 503)
    const payload: unknown = await response.json(); if (!isRecord(payload) || typeof payload.sid !== 'string') throw new AppError('DEPENDENCY_ERROR', 'Twilio response missing message id', 503)
    return { messageId: payload.sid }
  }
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
