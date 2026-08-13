export type ShopifyTransport = (url: string, init: RequestInit) => Promise<Response>
export type ShopifyRequest = Readonly<{ method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; body?: string }>
export type ShopifyResponse<Value> = Readonly<{ data: Value; status: number; requestId: string | null; headers: Readonly<Record<string, string>> }>

export class ShopifyApiError extends Error {
  public readonly status: number
  public readonly retryAfterMs: number | null

  public constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message)
    this.name = 'ShopifyApiError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

export class ShopifyClient {
  private readonly shop: string
  private readonly accessToken: string
  private readonly apiVersion: string
  private readonly transport: ShopifyTransport

  public constructor(shop: string, accessToken: string, transport: ShopifyTransport = fetch, apiVersion = '2024-04') {
    if (!shop.endsWith('.myshopify.com')) throw new TypeError('Shopify client requires a validated shop domain')
    if (!accessToken.trim()) throw new TypeError('Shopify access token cannot be empty')
    this.shop = shop
    this.accessToken = accessToken
    this.apiVersion = apiVersion
    this.transport = transport
  }

  public async request<Value>(request: ShopifyRequest): Promise<ShopifyResponse<Value>> {
    const init: RequestInit = {
      method: request.method ?? 'GET',
      headers: { 'x-shopify-access-token': this.accessToken, accept: 'application/json', 'content-type': 'application/json' },
    }
    if (request.body !== undefined) {
      init.body = request.body
    }
    const response = await this.transport(`https://${this.shop}/admin/api/${this.apiVersion}${request.path}`, init)
    const requestId = response.headers.get('x-request-id')
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => { responseHeaders[key] = value })
    if (!response.ok) {
      const retryHeader = response.headers.get('retry-after')
      const retryAfterMs = retryHeader === null ? null : Number(retryHeader) * 1000
      throw new ShopifyApiError(response.status, `Shopify API request failed with ${response.status}`, Number.isFinite(retryAfterMs) ? retryAfterMs : null)
    }
    return { data: (await response.json()) as Value, status: response.status, requestId, headers: responseHeaders }
  }
}
