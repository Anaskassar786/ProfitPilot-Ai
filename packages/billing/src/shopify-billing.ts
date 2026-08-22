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
 * the development store after PR #14.
 */
export type BillingTestMode = boolean | 'auto'

export type BillingLogger = Readonly<{
  info(message: string, context?: Readonly<Record<string, unknown>>): void
  warn(message: string, context?: Readonly<Record<string, unknown>>): void
  error(message: string, context?: Readonly<Record<string, unknown>>): void
}>

export type BillingClientConfig = Readonly<{ shop: string; accessToken: string; apiVersion?: string; testMode?: BillingTestMode; transport?: BillingTransport; logger?: BillingLogger | null }>

/** Shop plans that cannot be billed for real money. */
export const NON_BILLABLE_SHOPIFY_PLANS: readonly string[] = ['affiliate', 'partner_test', 'plus_partner_sandbox', 'staff', 'staff_business', 'dev_preview', 'development', 'trial', 'frozen', 'cancelled', 'paused']

export const APP_SUBSCRIPTION_CREATE_MUTATION = `mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean, $trialDays: Int) {
  appSubscriptionCreate(name: $name, lineItems: $lineItems, returnUrl: $returnUrl, test: $test, trialDays: $trialDays) {
    userErrors { field message }
    confirmationUrl
    appSubscription { id status name createdAt currentPeriodEnd trialDays test lineItems { plan { pricingDetails { ... on AppRecurringPricing { price { amount } interval } } } } }
  }
}`

export const APP_SUBSCRIPTION_CANCEL_MUTATION = `mutation AppSubscriptionCancel($id: ID!) {
  appSubscriptionCancel(id: $id) {
    userErrors { field message }
    appSubscription { id status name createdAt currentPeriodEnd trialDays test }
  }
}`

export const APP_SUBSCRIPTION_QUERY = `query AppSubscription($id: ID!) {
  node(id: $id) {
    ... on AppSubscription {
      id status name createdAt currentPeriodEnd trialDays test
      lineItems { plan { pricingDetails { ... on AppRecurringPricing { price { amount } interval } } } }
    }
  }
}`

/** Admin GraphQL shop probe — replaces legacy REST `/shop.json` plan lookups. */
export const SHOP_PROBE_QUERY = `query ShopProbe {
  shop {
    name
    myshopifyDomain
    plan {
      displayName
      partnerDevelopment
      shopifyPlus
    }
  }
}`

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

type ResolvedBillingConfig = Readonly<{ shop: string; accessToken: string; apiVersion: string; testMode: BillingTestMode; transport: BillingTransport; logger: BillingLogger | null }>

export class ShopifyBillingClient {
  private readonly config: ResolvedBillingConfig
  private resolvedTestMode: boolean | null

  public constructor(config: BillingClientConfig) {
    this.config = { shop: config.shop, accessToken: config.accessToken, apiVersion: config.apiVersion ?? '2026-07', testMode: config.testMode ?? 'auto', transport: config.transport ?? fetch, logger: config.logger ?? null }
    if (!this.config.shop.endsWith('.myshopify.com') || !this.config.accessToken.trim()) throw new TypeError('Shopify billing credentials are incomplete')
    this.resolvedTestMode = typeof this.config.testMode === 'boolean' ? this.config.testMode : null
  }

  public async createRecurringCharge(plan: PlanCode, interval: BillingInterval, returnUrl: string, trialDays: number): Promise<RecurringCharge> {
    if (!returnUrl.startsWith('http')) throw new TypeError('Billing return URL must be absolute')
    const definition = planFor(plan)
    const price = priceFor(plan, interval)
    if (price <= 0) throw new ShopifyBillingError(422, `Shopify Billing rejected the ${definition.code} plan: price must be greater than zero`, { price: ['must be greater than zero'] })
    const test = await this.testCharge()
    const name = `${definition.code} ${interval}`
    const variables: Record<string, unknown> = {
      name,
      returnUrl,
      test,
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price: { amount: price, currencyCode: 'USD' },
            interval: interval === 'ANNUAL' ? 'ANNUAL' : 'EVERY_30_DAYS',
          },
        },
      }],
    }
    if (Number.isFinite(trialDays) && trialDays > 0) variables.trialDays = Math.floor(trialDays)

    this.config.logger?.info('Shopify Billing API charge request', {
      shop: this.config.shop,
      endpoint: '/graphql.json',
      mutation: 'appSubscriptionCreate',
      plan,
      interval,
      price: price.toFixed(2),
      test,
      trialDays,
      tokenMasked: maskToken(this.config.accessToken),
    })

    const payload = await this.graphql(APP_SUBSCRIPTION_CREATE_MUTATION, variables)
    return chargeFromGraphqlCreate(payload, name, price.toFixed(2), test)
  }

  public async getCharge(id: string): Promise<RecurringCharge> {
    const gid = toAppSubscriptionGid(id)
    try {
      const payload = await this.graphql(APP_SUBSCRIPTION_QUERY, { id: gid })
      return chargeFromGraphqlNode(payload, this.resolvedTestMode ?? false)
    } catch (error: unknown) {
      if (error instanceof ShopifyBillingError && (error.status === 404 || error.message.includes('missing'))) {
        return chargeFromPayload(await this.request(`/recurring_application_charges/${encodeURIComponent(numericChargeId(id))}.json`), this.resolvedTestMode ?? false)
      }
      try {
        return chargeFromPayload(await this.request(`/recurring_application_charges/${encodeURIComponent(numericChargeId(id))}.json`), this.resolvedTestMode ?? false)
      } catch {
        throw error
      }
    }
  }

  public async verifyCharge(id: string, expected?: Readonly<{ plan: PlanCode; interval: BillingInterval }>): Promise<RecurringCharge> {
    const charge = await this.getCharge(id)
    if (charge.status !== 'active' && charge.status !== 'accepted') throw new ShopifyBillingError(409, 'Shopify charge verification failed')
    if (expected) {
      const definition = planFor(expected.plan)
      const expectedName = `${definition.code} ${expected.interval}`
      const expectedPrice = priceFor(expected.plan, expected.interval)
      if (charge.name && charge.name !== expectedName) throw new ShopifyBillingError(409, 'Shopify charge verification failed')
      if (charge.price && Number(charge.price) !== expectedPrice && Number(charge.price) !== 0) throw new ShopifyBillingError(409, 'Shopify charge verification failed')
    }
    return charge
  }

  public async cancelCharge(id: string): Promise<RecurringCharge> {
    const payload = await this.graphql(APP_SUBSCRIPTION_CANCEL_MUTATION, { id: toAppSubscriptionGid(id) })
    return chargeFromGraphqlCancel(payload, this.resolvedTestMode ?? false)
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
    const payload = await this.graphql(SHOP_PROBE_QUERY, {})
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload
    if (!isRecord(data) || !isRecord(data.shop)) return true
    const plan = isRecord(data.shop.plan) ? data.shop.plan : null
    if (plan?.partnerDevelopment === true) return true
    const displayName = typeof plan?.displayName === 'string' ? plan.displayName : ''
    const slug = shopifyPlanSlugFromDisplayName(displayName)
    return slug === '' || NON_BILLABLE_SHOPIFY_PLANS.includes(slug)
  }

  private async graphql(query: string, variables: Readonly<Record<string, unknown>>): Promise<unknown> {
    return this.request('/graphql.json', { method: 'POST', body: JSON.stringify({ query, variables }) })
  }

  private async request(path: string, init: Readonly<RequestInit> = {}): Promise<unknown> {
    const method = (init.method ?? 'GET').toUpperCase()
    const fullUrl = `https://${this.config.shop}/admin/api/${this.config.apiVersion}${path}`
    const tokenMasked = maskToken(this.config.accessToken)

    this.config.logger?.info('Shopify Billing API outbound request', {
      shop: this.config.shop,
      method,
      endpoint: path,
      tokenMasked,
    })

    const startedAt = Date.now()
    let response: Response
    try {
      response = await this.config.transport(fullUrl, { ...init, headers: { accept: 'application/json', 'content-type': 'application/json', 'x-shopify-access-token': this.config.accessToken, ...(init.headers ?? {}) } })
    } catch (transportError: unknown) {
      this.config.logger?.error('Shopify Billing API network failure', {
        shop: this.config.shop,
        method,
        endpoint: path,
        durationMs: Date.now() - startedAt,
        error: transportError instanceof Error ? transportError.message : String(transportError),
      })
      throw transportError
    }

    const durationMs = Date.now() - startedAt
    if (!response.ok) {
      this.config.logger?.error('Shopify Billing API request failed', {
        shop: this.config.shop,
        method,
        endpoint: path,
        status: response.status,
        durationMs,
        tokenMasked,
      })
      throw await billingErrorFrom(response, path)
    }

    this.config.logger?.info('Shopify Billing API request succeeded', {
      shop: this.config.shop,
      method,
      endpoint: path,
      status: response.status,
      durationMs,
    })

    const json = response.status === 204 ? {} : await response.json()
    if (path === '/graphql.json') assertGraphqlOk(json, path)
    return json
  }
}

export function toAppSubscriptionGid(id: string): string {
  const trimmed = id.trim()
  if (trimmed.startsWith('gid://')) return trimmed
  return `gid://shopify/AppSubscription/${trimmed}`
}

export function numericChargeId(id: string): string {
  const trimmed = id.trim()
  const match = trimmed.match(/AppSubscription\/(\d+)/)
  if (match) return match[1]!
  return trimmed
}

function maskToken(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return '[empty]'
  if (trimmed.length < 10) return '[masked]'
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

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

function assertGraphqlOk(payload: unknown, path: string): void {
  if (!isRecord(payload)) throw new ShopifyBillingError(502, 'Shopify Billing response missing charge')
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const messages = payload.errors.map((item) => isRecord(item) && typeof item.message === 'string' ? item.message : 'GraphQL error')
    throw new ShopifyBillingError(422, `Shopify Billing API failed with 422 on ${path} — ${messages.join('; ')}`, { graphql: messages }, JSON.stringify(payload).slice(0, 500))
  }
}

function userErrorsFrom(value: unknown): Readonly<Record<string, readonly string[]>> {
  if (!Array.isArray(value)) return {}
  const result: Record<string, string[]> = {}
  for (const item of value) {
    if (!isRecord(item) || typeof item.message !== 'string') continue
    const field = Array.isArray(item.field) ? item.field.map(String).join('.') : typeof item.field === 'string' ? item.field : 'base'
    result[field] = [...(result[field] ?? []), item.message]
  }
  return result
}

function chargeFromGraphqlCreate(payload: unknown, fallbackName: string, fallbackPrice: string, test: boolean): RecurringCharge {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload
  if (!isRecord(data) || !isRecord(data.appSubscriptionCreate)) throw new ShopifyBillingError(502, 'Shopify Billing response missing charge')
  const created = data.appSubscriptionCreate
  const errors = userErrorsFrom(created.userErrors)
  if (Object.keys(errors).length > 0) {
    const summary = Object.entries(errors).map(([field, messages]) => `${field}: ${messages.join(', ')}`).join('; ')
    throw new ShopifyBillingError(422, `Shopify Billing API failed with 422 on /graphql.json — ${summary}`, errors, JSON.stringify(payload).slice(0, 500))
  }
  if (!isRecord(created.appSubscription) || typeof created.appSubscription.id !== 'string') throw new ShopifyBillingError(502, 'Shopify Billing response missing charge')
  return mapAppSubscription(created.appSubscription, typeof created.confirmationUrl === 'string' ? created.confirmationUrl : null, fallbackName, fallbackPrice, test)
}

function chargeFromGraphqlNode(payload: unknown, test: boolean): RecurringCharge {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload
  if (!isRecord(data) || !isRecord(data.node) || typeof data.node.id !== 'string') throw new ShopifyBillingError(502, 'Shopify Billing response missing charge')
  return mapAppSubscription(data.node, null, '', '', test)
}

function chargeFromGraphqlCancel(payload: unknown, test: boolean): RecurringCharge {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload
  if (!isRecord(data) || !isRecord(data.appSubscriptionCancel)) throw new ShopifyBillingError(502, 'Shopify Billing response missing charge')
  const cancelled = data.appSubscriptionCancel
  const errors = userErrorsFrom(cancelled.userErrors)
  if (Object.keys(errors).length > 0) {
    const summary = Object.entries(errors).map(([field, messages]) => `${field}: ${messages.join(', ')}`).join('; ')
    throw new ShopifyBillingError(422, `Shopify Billing API failed with 422 on /graphql.json — ${summary}`, errors, JSON.stringify(payload).slice(0, 500))
  }
  if (!isRecord(cancelled.appSubscription) || typeof cancelled.appSubscription.id !== 'string') throw new ShopifyBillingError(502, 'Shopify Billing response missing charge')
  return mapAppSubscription(cancelled.appSubscription, null, '', '', test)
}

function mapAppSubscription(subscription: Readonly<Record<string, unknown>>, confirmationUrl: string | null, fallbackName: string, fallbackPrice: string, test: boolean): RecurringCharge {
  const price = recurringPrice(subscription) || fallbackPrice
  return {
    id: String(subscription.id),
    name: stringValue(subscription.name) || fallbackName,
    price,
    status: statusValue(subscription.status),
    confirmationUrl,
    billingOn: typeof subscription.currentPeriodEnd === 'string' ? subscription.currentPeriodEnd : null,
    trialDays: numberValue(subscription.trialDays),
    test: typeof subscription.test === 'boolean' ? subscription.test : test,
    createdAt: stringValue(subscription.createdAt),
  }
}

function recurringPrice(subscription: Readonly<Record<string, unknown>>): string {
  const items = Array.isArray(subscription.lineItems) ? subscription.lineItems : []
  for (const item of items) {
    if (!isRecord(item) || !isRecord(item.plan) || !isRecord(item.plan.pricingDetails)) continue
    const amount = isRecord(item.plan.pricingDetails.price) ? item.plan.pricingDetails.price.amount : null
    if (typeof amount === 'number') return amount.toFixed(2)
    if (typeof amount === 'string') return Number(amount).toFixed(2)
  }
  return ''
}

function chargeFromPayload(payload: unknown, test: boolean): RecurringCharge {
  if (!isRecord(payload) || !isRecord(payload.recurring_application_charge) || typeof payload.recurring_application_charge.id !== 'number' && typeof payload.recurring_application_charge.id !== 'string') throw new ShopifyBillingError(502, 'Shopify Billing response missing charge')
  const charge = payload.recurring_application_charge
  return { id: String(charge.id), name: stringValue(charge.name), price: stringValue(charge.price), status: statusValue(charge.status), confirmationUrl: typeof charge.confirmation_url === 'string' ? charge.confirmation_url : null, billingOn: typeof charge.billing_on === 'string' ? charge.billing_on : null, trialDays: numberValue(charge.trial_days), test: typeof charge.test === 'boolean' ? charge.test : test, createdAt: stringValue(charge.created_at) }
}
function statusValue(value: unknown): ChargeStatus {
  const normalized = typeof value === 'string' ? value.toLowerCase() : ''
  return normalized === 'pending' || normalized === 'accepted' || normalized === 'active' || normalized === 'declined' || normalized === 'cancelled' || normalized === 'expired' ? normalized : 'pending'
}
function stringValue(value: unknown): string { return typeof value === 'string' ? value : '' }
function numberValue(value: unknown): number { return typeof value === 'number' ? value : 0 }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

/** Maps GraphQL `shop.plan.displayName` onto the REST-era plan slugs consumers already check. */
export function shopifyPlanSlugFromDisplayName(displayName: string): string {
  const slug = displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const aliases: Readonly<Record<string, string>> = {
    developer_preview: 'development',
    partner_test: 'partner_test',
    shopify_plus_partner_sandbox: 'plus_partner_sandbox',
    plus_partner_sandbox: 'plus_partner_sandbox',
    staff_business: 'staff_business',
    staff: 'staff',
    trial: 'trial',
    development: 'development',
    affiliate: 'affiliate',
    frozen: 'frozen',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    paused: 'paused',
    pause_and_build: 'paused',
    dev_preview: 'dev_preview',
    plus: 'shopify_plus',
    shopify_plus: 'shopify_plus',
  }
  return aliases[slug] ?? slug
}
