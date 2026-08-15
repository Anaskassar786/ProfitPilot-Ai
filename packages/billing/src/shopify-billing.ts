import { planFor, priceFor } from './plans.js'
import type { BillingInterval, PlanCode } from './plans.js'

export type ChargeStatus = 'pending' | 'accepted' | 'active' | 'declined' | 'cancelled' | 'expired'
export type RecurringCharge = Readonly<{ id: string; name: string; price: string; status: ChargeStatus; confirmationUrl: string | null; billingOn: string | null; trialDays: number; test: boolean; createdAt: string }>
export type BillingTransport = (url: string, init: RequestInit) => Promise<Response>

/**
 * `true`/`false` force the charge's `test` flag. `'auto'` (the default) asks
 * Shopify what kind of shop this is and enables test charges for development,
 * partner test, staff-business, and plus-partner-sandbox shops.
 *
 * Shopify rejects a live (`test: false`) recurring charge on a development
 * store with `422 Unprocessable Entity` — that is exactly the failure seen on
 * commander-pilot.myshopify.com after PR #14.
 */
export type BillingTestMode = boolean | 'auto'

export type BillingClientConfig = Readonly<{ shop: string; accessToken: string; apiVersion?: string; testMode?: BillingTestMode; transport?: BillingTransport }>

/** Shop plans that cannot be billed for real money. */
export const NON_BILLABLE_SHOPIFY_PLANS: readonly string[] = ['affiliate', 'partner_test', 'plus_partner_sandbox', 'staff', 'staff_business', 'dev_preview', 'development', 'trial', 'frozen', 'cancelled', 'paused']

export class ShopifyBillingError extends Error {
  public readonly status: number
  /** Field-level validation errors Shopify returned with a 422, if any. */
  public readonly validationErrors: Readonly<Record<string, readonly string[]>>
  /** Redacted, condensed upstream response body for logs. */
  public readonly upstreamBody: string

  public constructor(status: number, message: string, validationErrors: Readonly<Record<string, readonly string[]>> = {}, upstreamBody = '') {
    super(message)
    this.name = 'ShopifyBillingError'
    this.status = status
    this.validationErrors = validationErrors
    this.upstreamBody = upstreamBody
  }
}

type ResolvedBillingConfig = Readonly<{ shop: string; accessToken: string; apiVersion: string; testMode: BillingTestMode; transport: BillingTransport }>

export class ShopifyBillingClient {
  private readonly config: ResolvedBillingConfig
  private resolvedTestMode: boolean | null

  public constructor(config: BillingClientConfig) {
    this.config = { shop: config.shop, accessToken: config.accessToken, apiVersion: config.apiVersion ?? '2025-10', testMode: config.testMode ?? 'auto', transport: config.transport ?? fetch }
    if (!this.config.shop.endsWith('.myshopify.com') || !this.config.accessToken.trim()) throw new TypeError('Shopify billing credentials are incomplete')
    this.resolvedTestMode = typeof this.config.testMode === 'boolean' ? this.config.testMode : null
  }

  public async createRecurringCharge(plan: PlanCode, interval: BillingInterval, returnUrl: string, trialDays: number): Promise<RecurringCharge> {
    if (!returnUrl.startsWith('http')) throw new TypeError('Billing return URL must be absolute')
    const definition = planFor(plan)
    const price = priceFor(plan, interval)
    // Shopify validates each field server side and answers 422 with the exact
    // reasons. Guard the two it rejects most often before spending a call.
    if (price <= 0) throw new ShopifyBillingError(422, `Shopify Billing rejected the ${definition.code} plan: price must be greater than zero`, { price: ['must be greater than zero'] })
    const test = await this.testCharge()
    const charge: Record<string, unknown> = {
      name: `${definition.code} ${interval}`,
      price: price.toFixed(2),
      return_url: returnUrl,
      test,
    }
    // trial_days must be a non-negative integer; omit it rather than send 0.
    if (Number.isFinite(trialDays) && trialDays > 0) charge.trial_days = Math.floor(trialDays)
    const response = await this.request('/recurring_application_charges.json', { method: 'POST', body: JSON.stringify({ recurring_application_charge: charge }) })
    return chargeFromPayload(response, test)
  }

  public async getCharge(id: string): Promise<RecurringCharge> {
    // Reads must not trigger a shop lookup; `test` is only a display fallback.
    return chargeFromPayload(await this.request(`/recurring_application_charges/${encodeURIComponent(id)}.json`), this.resolvedTestMode ?? false)
  }

  public async verifyCharge(id: string, expected: Readonly<{ plan: PlanCode; interval: BillingInterval }>): Promise<RecurringCharge> {
    const charge = await this.getCharge(id)
    const definition = planFor(expected.plan)
    if (charge.name !== `${definition.code} ${expected.interval}` || Number(charge.price) !== priceFor(expected.plan, expected.interval) || (charge.status !== 'active' && charge.status !== 'accepted')) throw new ShopifyBillingError(409, 'Shopify charge verification failed')
    return charge
  }

  public async cancelCharge(id: string): Promise<RecurringCharge> {
    return chargeFromPayload(await this.request(`/recurring_application_charges/${encodeURIComponent(id)}.json`, { method: 'DELETE' }), this.resolvedTestMode ?? false)
  }

  /**
   * Whether this charge must be created as a test charge. Resolved once per
   * client: development/partner-test shops can never be charged for real, and
   * asking for a live charge there is answered with 422.
   */
  public async testCharge(): Promise<boolean> {
    if (this.resolvedTestMode !== null) return this.resolvedTestMode
    const resolved = await this.shopIsNonBillable().catch(() => true)
    this.resolvedTestMode = resolved
    return resolved
  }

  private async shopIsNonBillable(): Promise<boolean> {
    const payload = await this.request('/shop.json?fields=plan_name,plan_display_name')
    if (!isRecord(payload) || !isRecord(payload.shop)) return true
    const planName = typeof payload.shop.plan_name === 'string' ? payload.shop.plan_name.toLowerCase() : ''
    return planName === '' || NON_BILLABLE_SHOPIFY_PLANS.includes(planName)
  }

  private async request(path: string, init: Readonly<RequestInit> = {}): Promise<unknown> {
    const response = await this.config.transport(`https://${this.config.shop}/admin/api/${this.config.apiVersion}${path}`, { ...init, headers: { accept: 'application/json', 'content-type': 'application/json', 'x-shopify-access-token': this.config.accessToken, ...(init.headers ?? {}) } })
    if (!response.ok) throw await billingErrorFrom(response, path)
    return response.status === 204 ? {} : await response.json()
  }
}

/**
 * Turns a failed Shopify Billing response into an error that carries the real
 * reason. Shopify answers 422 with `{"errors":{"price":["must be greater than
 * zero"]}}`; logging only the status made the failure unactionable.
 */
async function billingErrorFrom(response: Response, path: string): Promise<ShopifyBillingError> {
  const raw = await response.text().catch(() => '')
  const condensed = raw.replace(/\s+/g, ' ').slice(0, 500)
  const validation = parseValidationErrors(raw)
  const summary = Object.entries(validation).map(([field, messages]) => `${field}: ${messages.join(', ')}`).join('; ')
  const detail = summary || condensed
  return new ShopifyBillingError(response.status, `Shopify Billing API failed with ${response.status} on ${path}${detail ? ` — ${detail}` : ''}`, validation, condensed)
}

function parseValidationErrors(raw: string): Readonly<Record<string, readonly string[]>> {
  if (!raw.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!isRecord(parsed)) return {}
  const errors = parsed.errors
  if (typeof errors === 'string') return { base: [errors] }
  if (!isRecord(errors)) return {}
  const result: Record<string, readonly string[]> = {}
  for (const [field, value] of Object.entries(errors)) {
    if (typeof value === 'string') result[field] = [value]
    else if (Array.isArray(value)) result[field] = value.filter((item): item is string => typeof item === 'string')
  }
  return result
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
