import { planFor, priceFor } from './plans.js'
import type { BillingInterval, PlanCode } from './plans.js'

export type ChargeStatus = 'pending' | 'accepted' | 'active' | 'declined' | 'cancelled' | 'expired'
export type RecurringCharge = Readonly<{ id: string; name: string; price: string; status: ChargeStatus; confirmationUrl: string | null; billingOn: string | null; trialDays: number; test: boolean; createdAt: string }>
export type BillingTransport = (url: string, init: RequestInit) => Promise<Response>
export type BillingClientConfig = Readonly<{ shop: string; accessToken: string; apiVersion?: string; testMode?: boolean; transport?: BillingTransport }>

export class ShopifyBillingError extends Error {
  public readonly status: number
  public constructor(status: number, message: string) { super(message); this.name = 'ShopifyBillingError'; this.status = status }
}

type ResolvedBillingConfig = Readonly<{ shop: string; accessToken: string; apiVersion: string; testMode: boolean; transport: BillingTransport }>

export class ShopifyBillingClient {
  private readonly config: ResolvedBillingConfig

  public constructor(config: BillingClientConfig) {
    this.config = { shop: config.shop, accessToken: config.accessToken, apiVersion: config.apiVersion ?? '2024-04', testMode: config.testMode ?? false, transport: config.transport ?? fetch }
    if (!this.config.shop.endsWith('.myshopify.com') || !this.config.accessToken.trim()) throw new TypeError('Shopify billing credentials are incomplete')
  }

  public async createRecurringCharge(plan: PlanCode, interval: BillingInterval, returnUrl: string, trialDays: number): Promise<RecurringCharge> {
    if (!returnUrl.startsWith('http')) throw new TypeError('Billing return URL must be absolute')
    const definition = planFor(plan)
    const response = await this.request('/recurring_application_charges.json', { method: 'POST', body: JSON.stringify({ recurring_application_charge: { name: `${definition.code} ${interval}`, price: String(priceFor(plan, interval)), return_url: returnUrl, trial_days: trialDays, test: this.config.testMode, capped_amount: undefined } }) })
    return chargeFromPayload(response, this.config.testMode)
  }

  public async getCharge(id: string): Promise<RecurringCharge> {
    return chargeFromPayload(await this.request(`/recurring_application_charges/${encodeURIComponent(id)}.json`), this.config.testMode)
  }

  public async verifyCharge(id: string, expected: Readonly<{ plan: PlanCode; interval: BillingInterval }>): Promise<RecurringCharge> {
    const charge = await this.getCharge(id)
    const definition = planFor(expected.plan)
    if (charge.name !== `${definition.code} ${expected.interval}` || Number(charge.price) !== priceFor(expected.plan, expected.interval) || (charge.status !== 'active' && charge.status !== 'accepted')) throw new ShopifyBillingError(409, 'Shopify charge verification failed')
    return charge
  }

  public async cancelCharge(id: string): Promise<RecurringCharge> {
    return chargeFromPayload(await this.request(`/recurring_application_charges/${encodeURIComponent(id)}.json`, { method: 'DELETE' }), this.config.testMode)
  }

  private async request(path: string, init: Readonly<RequestInit> = {}): Promise<unknown> {
    const response = await this.config.transport(`https://${this.config.shop}/admin/api/${this.config.apiVersion}${path}`, { ...init, headers: { accept: 'application/json', 'content-type': 'application/json', 'x-shopify-access-token': this.config.accessToken, ...(init.headers ?? {}) } })
    if (!response.ok) throw new ShopifyBillingError(response.status, `Shopify Billing API failed with ${response.status}`)
    return response.status === 204 ? {} : await response.json()
  }
}

function chargeFromPayload(payload: unknown, test: boolean): RecurringCharge {
  if (!isRecord(payload) || !isRecord(payload.recurring_application_charge) || typeof payload.recurring_application_charge.id !== 'number' && typeof payload.recurring_application_charge.id !== 'string') throw new ShopifyBillingError(502, 'Shopify Billing response missing charge')
  const charge = payload.recurring_application_charge
  return { id: String(charge.id), name: stringValue(charge.name), price: stringValue(charge.price), status: statusValue(charge.status), confirmationUrl: typeof charge.confirmation_url === 'string' ? charge.confirmation_url : null, billingOn: typeof charge.billing_on === 'string' ? charge.billing_on : null, trialDays: numberValue(charge.trial_days), test: typeof charge.test === 'boolean' ? charge.test : test, createdAt: stringValue(charge.created_at) }
}
function statusValue(value: unknown): ChargeStatus { return value === 'pending' || value === 'accepted' || value === 'active' || value === 'declined' || value === 'cancelled' || value === 'expired' ? value : 'pending' }
function stringValue(value: unknown): string { return typeof value === 'string' ? value : '' }
function numberValue(value: unknown): number { return typeof value === 'number' ? value : 0 }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
