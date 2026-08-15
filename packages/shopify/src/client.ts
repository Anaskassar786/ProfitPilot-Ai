export type ShopifyTransport = (url: string, init: RequestInit) => Promise<Response>
export type ShopifyRequest = Readonly<{ method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; body?: string }>
export type ShopifyResponse<Value> = Readonly<{ data: Value; status: number; requestId: string | null; headers: Readonly<Record<string, string>> }>
export type ShopifyClientLogger = Readonly<{
  info(message: string, context?: Readonly<Record<string, unknown>>): void
  warn(message: string, context?: Readonly<Record<string, unknown>>): void
  error(message: string, context?: Readonly<Record<string, unknown>>): void
}>

/**
 * Known Shopify REST Admin API scopes required by each endpoint prefix.
 * Used to provide actionable 403 diagnostics when a stored access token
 * lacks the permission for a requested resource.
 */
const ENDPOINT_SCOPES: Readonly<Record<string, string>> = {
  '/products': 'read_products',
  '/orders': 'read_orders',
  '/customers': 'read_customers',
  '/inventory_levels': 'read_inventory',
  '/checkouts': 'read_checkouts',
  '/collections': 'read_collections',
  '/price_rules': 'read_price_rules',
  '/transactions': 'read_orders',
  '/discounts': 'read_discounts',
  '/locations': 'read_locations',
}

/** Returns the OAuth scope likely required for a given Admin API path, or null. */
export function scopeForEndpoint(path: string): string | null {
  const sorted = Object.keys(ENDPOINT_SCOPES).sort((a, b) => b.length - a.length)
  for (const prefix of sorted) {
    if (path.startsWith(prefix)) return (ENDPOINT_SCOPES as Record<string, string>)[prefix] ?? null
  }
  return null
}

export class ShopifyApiError extends Error {
  public readonly status: number
  public readonly retryAfterMs: number | null
  /** The Admin API path that was being called when this error was raised. */
  public readonly path: string | null

  public constructor(status: number, message: string, retryAfterMs: number | null = null, path: string | null = null) {
    super(message)
    this.name = 'ShopifyApiError'
    this.status = status
    this.retryAfterMs = retryAfterMs
    this.path = path
    Object.setPrototypeOf(this, ShopifyApiError.prototype)
  }

  /**
   * Returns an actionable error message for 403 Forbidden responses.
   * Shopify returns 403 when the access token is valid (not 401) but lacks
   * the required OAuth scope for the requested endpoint.
   */
  public scopeMessage(): string | null {
    if (this.status !== 403 || !this.path) return null
    const scope = scopeForEndpoint(this.path)
    if (scope) {
      return `Missing scope: "${scope}" for endpoint "${this.path}". Please add "${scope}" to SHOPIFY_SCOPES, update the app's scopes in the Partner Dashboard, then reinstall the app.`
    }
    return `Shopify returned 403 Forbidden for "${this.path}". The access token is valid but lacks a required OAuth scope. Check the SHOPIFY_SCOPES env var and the app's scope configuration in the Partner Dashboard.`
  }
}

export function isShopifyApiError(error: unknown): error is ShopifyApiError {
  if (error instanceof ShopifyApiError) return true
  if (typeof error === 'object' && error !== null) {
    const record = error as { name?: unknown; status?: unknown }
    return record.name === 'ShopifyApiError' && typeof record.status === 'number'
  }
  return false
}

export function isShopifyAuthError(error: unknown): boolean {
  if (isShopifyApiError(error) && error.status === 401) return true
  if (typeof error === 'object' && error !== null) {
    const record = error as { name?: unknown; status?: unknown }
    if (record.status === 401 && (record.name === 'ShopifyApiError' || error instanceof Error)) return true
    if (record.status === 401) return true
  }
  return false
}

export class ShopifyClient {
  private readonly shop: string
  private readonly accessToken: string
  private readonly apiVersion: string
  private readonly transport: ShopifyTransport
  private readonly logger: ShopifyClientLogger | null

  public constructor(shop: string, accessToken: string, transport: ShopifyTransport = fetch, apiVersion = '2025-10', logger: ShopifyClientLogger | null = null) {
    if (!shop.endsWith('.myshopify.com')) throw new TypeError('Shopify client requires a validated shop domain')
    if (!accessToken.trim()) throw new TypeError('Shopify access token cannot be empty')
    this.shop = shop
    this.accessToken = accessToken
    this.apiVersion = apiVersion
    this.transport = transport
    this.logger = logger
  }

  public async request<Value>(request: ShopifyRequest): Promise<ShopifyResponse<Value>> {
    const method = request.method ?? 'GET'
    const fullUrl = `https://${this.shop}/admin/api/${this.apiVersion}${request.path}`
    const tokenMasked = maskToken(this.accessToken)
    const tokenPresent = Boolean(this.accessToken && this.accessToken.trim().length > 0)
    const requiredScope = scopeForEndpoint(request.path)

    this.logger?.info('Shopify Admin API outbound request', {
      shopDomain: this.shop,
      method,
      endpoint: request.path,
      apiVersion: this.apiVersion,
      tokenPresent,
      tokenMasked,
      requiredScope: requiredScope ?? 'unknown',
    })

    const init: RequestInit = {
      method,
      headers: { 'x-shopify-access-token': this.accessToken, accept: 'application/json', 'content-type': 'application/json' },
    }
    if (request.body !== undefined) {
      init.body = request.body
    }

    const startedAt = Date.now()
    let response: Response
    try {
      response = await this.transport(fullUrl, init)
    } catch (transportError: unknown) {
      this.logger?.error('Shopify Admin API network failure', {
        shopDomain: this.shop,
        method,
        endpoint: request.path,
        durationMs: Date.now() - startedAt,
        tokenPresent,
        tokenMasked,
        error: transportError instanceof Error ? transportError.message : String(transportError),
      })
      throw transportError
    }

    const durationMs = Date.now() - startedAt
    const requestId = response.headers.get('x-request-id')
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => { responseHeaders[key] = value })

    if (!response.ok) {
      this.logger?.error('Shopify Admin API request failed', {
        shopDomain: this.shop,
        method,
        endpoint: request.path,
        status: response.status,
        durationMs,
        requestId: requestId ?? '',
        tokenPresent,
        tokenMasked,
        requiredScope: requiredScope ?? 'unknown',
      })
      const retryHeader = response.headers.get('retry-after')
      const retryAfterMs = retryHeader === null ? null : Number(retryHeader) * 1000
      // Build an actionable message for 403: the token is valid but lacks scope.
      const scopeHint = response.status === 403 && requiredScope
        ? ` (requires scope "${requiredScope}")`
        : ''
      throw new ShopifyApiError(
        response.status,
        `Shopify API request failed with ${response.status}${scopeHint}`,
        Number.isFinite(retryAfterMs) ? retryAfterMs : null,
        request.path,
      )
    }

    this.logger?.info('Shopify Admin API request succeeded', {
      shopDomain: this.shop,
      method,
      endpoint: request.path,
      status: response.status,
      durationMs,
      requestId: requestId ?? '',
      requiredScope: requiredScope ?? 'unknown',
    })

    return { data: (await response.json()) as Value, status: response.status, requestId, headers: responseHeaders }
  }
}

function maskToken(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return '[empty]'
  if (trimmed.length < 10) return '[masked]'
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}