import type { Logger } from '@profitpilot/logger'
import type { StoreDirectory } from '@profitpilot/db'
import { ShopifyApiError } from '@profitpilot/shopify'
import type { OfflineTokenResult } from '@profitpilot/shopify'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { SyncModule, SyncRunResult } from '@profitpilot/sync'

export type SyncRunner = Readonly<{
  runModule(store: StoreId, module: SyncModule): Promise<SyncRunResult>
}>

export type RejectedTokenExchange = Readonly<{
  exchangeOfflineAccessToken(shop: string, idToken: string): Promise<OfflineTokenResult>
}>

/**
 * Retries one sync after rotating a missing/rejected Shopify access token.
 * The retry is deliberately bounded to one attempt to avoid request loops.
 */
export class TokenRefreshingSync {
  private readonly sync: SyncRunner
  private readonly directory: StoreDirectory
  private readonly tokenExchange: RejectedTokenExchange
  private readonly logger: Logger

  public constructor(sync: SyncRunner, directory: StoreDirectory, tokenExchange: RejectedTokenExchange, logger: Logger) {
    this.sync = sync
    this.directory = directory
    this.tokenExchange = tokenExchange
    this.logger = logger
  }

  public async runModule(store: StoreId, module: SyncModule, idToken?: string): Promise<SyncRunResult> {
    try {
      return await this.sync.runModule(store, module)
    } catch (error: unknown) {
      const reason = refreshReason(error)
      if (!reason) throw error
      if (!idToken?.trim()) throw reconnectRequired(store, reason, error)

      const connection = await this.directory.get(store)
      if (!connection) throw new AppError('NOT_FOUND', 'Shopify store is not registered', 404, { storeId: store })

      let result: OfflineTokenResult
      try {
        result = await this.tokenExchange.exchangeOfflineAccessToken(connection.shopDomain, idToken)
      } catch (exchangeError: unknown) {
        throw withCause(new AppError(
          'DEPENDENCY_ERROR',
          'Shopify access token refresh failed. Hard refresh the embedded app and retry sync.',
          502,
          { storeId: store, action: 'HARD_REFRESH' },
        ), exchangeError)
      }

      this.logger.info('Shopify offline access token refreshed for sync retry', {
        shopDomain: connection.shopDomain,
        storeId: store,
        module,
        reason,
        accessMode: 'offline',
        scopes: result.scopes.join(','),
      })

      try {
        return await this.sync.runModule(store, module)
      } catch (retryError: unknown) {
        if (refreshReason(retryError)) {
          throw withCause(new AppError(
            'DEPENDENCY_ERROR',
            'Shopify rejected the refreshed access token. Confirm the app is installed with the required scopes, then hard refresh and retry sync.',
            502,
            { storeId: store, action: 'VERIFY_INSTALL_AND_SCOPES' },
          ), retryError)
        }
        throw retryError
      }
    }
  }
}

function refreshReason(error: unknown): 'missing-token' | 'shopify-401' | null {
  if (error instanceof ShopifyApiError && error.status === 401) return 'shopify-401'
  if (error instanceof AppError && error.details.reason === 'SHOPIFY_TOKEN_MISSING') return 'missing-token'
  return null
}

function reconnectRequired(store: StoreId, reason: 'missing-token' | 'shopify-401', cause: unknown): AppError {
  const message = reason === 'missing-token'
    ? 'Shopify access token is missing. Hard refresh the embedded app to reconnect this store, then retry sync.'
    : 'Shopify rejected the stored access token. Hard refresh the embedded app to refresh access, then retry sync.'
  return withCause(new AppError('DEPENDENCY_ERROR', message, 503, { storeId: store, action: 'HARD_REFRESH' }), cause)
}

function withCause(error: AppError, cause: unknown): AppError {
  error.cause = cause
  return error
}
