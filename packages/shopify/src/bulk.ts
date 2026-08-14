import type { ShopifyClient } from './client.js'

export type BulkStatus = 'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'CANCELING'
export type BulkOperation = Readonly<{ id: string; status: BulkStatus; url: string | null; errorCode: string | null }>
export type BulkDownload = Readonly<{ operation: BulkOperation; jsonl: string }>
export type BulkFetcher = (input: string, init?: RequestInit) => Promise<Response>
export type BulkSleep = (milliseconds: number) => Promise<void>

type GraphqlResponse = Readonly<{ data?: Readonly<Record<string, unknown>>; errors?: readonly Readonly<{ message: string }>[] }>

export class ShopifyBulkClient {
  private readonly shopify: ShopifyClient
  private readonly fetcher: BulkFetcher
  private readonly sleep: BulkSleep
  private readonly pollIntervalMs: number
  private readonly maxPolls: number

  public constructor(shopify: ShopifyClient, options: Readonly<{ fetcher?: BulkFetcher; sleep?: BulkSleep; pollIntervalMs?: number; maxPolls?: number }> = {}) {
    this.shopify = shopify
    this.fetcher = options.fetcher ?? fetch
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000
    this.maxPolls = options.maxPolls ?? 60
    if (this.pollIntervalMs < 0 || this.maxPolls < 1) throw new RangeError('Invalid bulk polling bounds')
  }

  public async runQuery(query: string): Promise<BulkDownload> {
    if (!query.trim()) throw new TypeError('Bulk GraphQL query cannot be empty')
    const started = await this.graphql<{ bulkOperationRunQuery?: Readonly<{ bulkOperation?: Readonly<{ id: string; status: BulkStatus }>; userErrors: readonly Readonly<{ message: string }>[] }> }>('mutation { bulkOperationRunQuery(query: ' + JSON.stringify(query) + ') { bulkOperation { id status } userErrors { message } } }')
    const startPayload = started.data?.bulkOperationRunQuery
    if (!startPayload || startPayload.userErrors.length > 0 || !startPayload.bulkOperation) throw new Error(startPayload?.userErrors[0]?.message ?? 'Shopify bulk operation did not start')
    let operation = await this.poll(startPayload.bulkOperation.id)
    if (operation.status !== 'COMPLETED' || !operation.url) throw new Error(operation.errorCode ? `Shopify bulk operation failed: ${operation.errorCode}` : `Shopify bulk operation ended with ${operation.status}`)
    const response = await this.fetcher(operation.url)
    if (!response.ok) throw new Error(`Shopify bulk download failed with ${response.status}`)
    const jsonl = await response.text()
    return { operation, jsonl }
  }

  private async poll(id: string): Promise<BulkOperation> {
    for (let attempt = 0; attempt < this.maxPolls; attempt += 1) {
      const response = await this.graphql<{ currentBulkOperation?: Readonly<{ id: string; status: BulkStatus; url: string | null; errorCode: string | null }> }>('query { currentBulkOperation { id status url errorCode } }')
      const current = response.data?.currentBulkOperation
      if (current && current.id === id && ['COMPLETED', 'FAILED', 'CANCELED', 'CANCELING'].includes(current.status)) return current
      await this.sleep(this.pollIntervalMs)
    }
    throw new Error('Shopify bulk operation polling timed out')
  }

  private async graphql<Value extends Readonly<Record<string, unknown>>>(query: string): Promise<GraphqlResponse & { data?: Value }> {
    const response = await this.shopify.request<GraphqlResponse>({ path: '/graphql.json', method: 'POST', body: JSON.stringify({ query }) })
    if (response.data.errors && response.data.errors.length > 0) throw new Error(response.data.errors[0]?.message ?? 'Shopify GraphQL error')
    return response.data as GraphqlResponse & { data?: Value }
  }
}
