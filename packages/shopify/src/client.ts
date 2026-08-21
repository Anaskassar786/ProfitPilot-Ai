export type ShopifyTransport = (url: string, init: RequestInit) => Promise<Response>
export type ShopifyRequest = Readonly<{ method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; body?: string }>
export type ShopifyResponse<Value> = Readonly<{ data: Value; status: number; requestId: string | null; headers: Readonly<Record<string, string>> }>
export type ShopifyClientLogger = Readonly<{
  info(message: string, context?: Readonly<Record<string, unknown>>): void
  warn(message: string, context?: Readonly<Record<string, unknown>>): void
  error(message: string, context?: Readonly<Record<string, unknown>>): void
}>

export class ShopifyApiError extends Error {
  public readonly status: number
  public readonly retryAfterMs: number | null

  public constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message)
    this.name = 'ShopifyApiError'
    this.status = status
    this.retryAfterMs = retryAfterMs
    Object.setPrototypeOf(this, ShopifyApiError.prototype)
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

  public constructor(shop: string, accessToken: string, transport: ShopifyTransport = fetch, apiVersion = '2026-07', logger: ShopifyClientLogger | null = null) {
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

    this.logger?.info('Shopify Admin API outbound request', {
      shopDomain: this.shop,
      method,
      endpoint: request.path,
      apiVersion: this.apiVersion,
      tokenPresent,
      tokenMasked,
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
      })
      const retryHeader = response.headers.get('retry-after')
      const retryAfterMs = retryHeader === null ? null : Number(retryHeader) * 1000
      throw new ShopifyApiError(response.status, `Shopify API request failed with ${response.status}`, Number.isFinite(retryAfterMs) ? retryAfterMs : null)
    }

    this.logger?.info('Shopify Admin API request succeeded', {
      shopDomain: this.shop,
      method,
      endpoint: request.path,
      status: response.status,
      durationMs,
      requestId: requestId ?? '',
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
