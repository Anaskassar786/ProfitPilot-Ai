import { describe, expect, it, vi } from 'vitest'
import { InMemoryStoreDirectory } from '@profitpilot/db'
import { Logger, createMemorySink } from '@profitpilot/logger'
import { ShopifyApiError } from '@profitpilot/shopify'
import { AppError } from '@profitpilot/types'
import type { SyncRunResult } from '@profitpilot/sync'
import { TokenRefreshingSync } from './token-refresh-sync.js'

const SHOP = 'commander-pilot.myshopify.com'

async function fixture() {
  const directory = new InMemoryStoreDirectory()
  const tenant = await directory.upsertByShopDomain(SHOP)
  const result: SyncRunResult = { storeId: tenant.storeId, module: 'products', pages: 1, records: 2, cursor: null, resumedFrom: null }
  const sink = createMemorySink()
  return { directory, tenant, result, logger: new Logger(sink.sink), sink }
}

describe('sync token refresh retry', () => {
  it('exchanges the session token and retries once after a Shopify 401', async () => {
    const { directory, tenant, result, logger, sink } = await fixture()
    const runModule = vi.fn()
      .mockRejectedValueOnce(new ShopifyApiError(401, 'Shopify API request failed with 401'))
      .mockResolvedValueOnce(result)
    const exchangeOfflineAccessToken = vi.fn(async () => ({ shop: SHOP, scopes: ['read_products'], source: 'exchanged' as const }))
    const sync = new TokenRefreshingSync({ runModule }, directory, { exchangeOfflineAccessToken }, logger)

    await expect(sync.runModule(tenant.storeId, 'products', 'fresh-id-token')).resolves.toEqual(result)
    expect(runModule).toHaveBeenCalledTimes(2)
    expect(exchangeOfflineAccessToken).toHaveBeenCalledWith(SHOP, 'fresh-id-token')
    expect(sink.records.some((record) => record.message === 'Shopify offline access token refreshed for sync retry' && record.context.reason === 'shopify-401')).toBe(true)
  })

  it('recovers a missing vault token with the same bounded exchange path', async () => {
    const { directory, tenant, result, logger } = await fixture()
    const missing = new AppError('DEPENDENCY_ERROR', 'missing', 503, { reason: 'SHOPIFY_TOKEN_MISSING' })
    const runModule = vi.fn().mockRejectedValueOnce(missing).mockResolvedValueOnce(result)
    const exchangeOfflineAccessToken = vi.fn(async () => ({ shop: SHOP, scopes: [], source: 'exchanged' as const }))
    const sync = new TokenRefreshingSync({ runModule }, directory, { exchangeOfflineAccessToken }, logger)
    await expect(sync.runModule(tenant.storeId, 'products', 'fresh-id-token')).resolves.toEqual(result)
    expect(exchangeOfflineAccessToken).toHaveBeenCalledTimes(1)
  })

  it('returns an actionable error instead of a generic 500 when no id_token is available', async () => {
    const { directory, tenant, logger } = await fixture()
    const runModule = vi.fn(async () => { throw new AppError('DEPENDENCY_ERROR', 'missing', 503, { reason: 'SHOPIFY_TOKEN_MISSING' }) })
    const exchangeOfflineAccessToken = vi.fn()
    const sync = new TokenRefreshingSync({ runModule }, directory, { exchangeOfflineAccessToken }, logger)
    const failure = await sync.runModule(tenant.storeId, 'products').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AppError)
    expect((failure as AppError).status).toBe(503)
    expect((failure as AppError).message).toContain('Hard refresh')
    expect((failure as AppError).details.action).toBe('HARD_REFRESH')
    expect(exchangeOfflineAccessToken).not.toHaveBeenCalled()
  })

  it('maps token exchange failure to an exposed reconnect message', async () => {
    const { directory, tenant, logger } = await fixture()
    const runModule = vi.fn(async () => { throw new ShopifyApiError(401, 'rejected') })
    const sync = new TokenRefreshingSync({ runModule }, directory, { exchangeOfflineAccessToken: async () => { throw new Error('HTTP 400') } }, logger)
    const failure = await sync.runModule(tenant.storeId, 'products', 'expired-id-token').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AppError)
    expect((failure as AppError).status).toBe(502)
    expect((failure as AppError).message).toContain('Hard refresh')
    expect((failure as AppError).expose).toBe(true)
  })

  it('never loops when Shopify rejects the refreshed token', async () => {
    const { directory, tenant, logger } = await fixture()
    const runModule = vi.fn(async () => { throw new ShopifyApiError(401, 'rejected') })
    const exchangeOfflineAccessToken = vi.fn(async () => ({ shop: SHOP, scopes: [], source: 'exchanged' as const }))
    const sync = new TokenRefreshingSync({ runModule }, directory, { exchangeOfflineAccessToken }, logger)
    const failure = await sync.runModule(tenant.storeId, 'products', 'fresh-id-token').catch((error: unknown) => error)
    expect(runModule).toHaveBeenCalledTimes(2)
    expect(exchangeOfflineAccessToken).toHaveBeenCalledTimes(1)
    expect((failure as AppError).message).toContain('required scopes')
  })

  it('does not retry unrelated Shopify failures', async () => {
    const { directory, tenant, logger } = await fixture()
    const unavailable = new ShopifyApiError(500, 'unavailable')
    const runModule = vi.fn(async () => { throw unavailable })
    const exchangeOfflineAccessToken = vi.fn()
    const sync = new TokenRefreshingSync({ runModule }, directory, { exchangeOfflineAccessToken }, logger)
    await expect(sync.runModule(tenant.storeId, 'products', 'id-token')).rejects.toBe(unavailable)
    expect(runModule).toHaveBeenCalledTimes(1)
    expect(exchangeOfflineAccessToken).not.toHaveBeenCalled()
  })
})
