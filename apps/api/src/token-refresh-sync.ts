import type { Logger } from '@profitpilot/logger'
import type { StoreDirectory } from '@profitpilot/db'
import { isShopifyApiError, isShopifyAuthError, ShopifyApiError } from '@profitpilot/shopify'
import type { OfflineTokenResult } from '@profitpilot/shopify'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { SyncModule, SyncRunResult } from '@profitpilot/sync'
import { CIRCUIT_OPEN_REASON } from '@profitpilot/sync'

export type SyncRunner = Readonly<{
  runModule(store: StoreId, module: SyncModule): Promise<SyncRunResult>
}>

export type RejectedTokenExchange = Readonly<{
  exchangeOfflineAccessToken(shop: string, idToken: string): Promise<OfflineTokenResult>
}>

/** Lets the sync path close a circuit that was tripped by a repaired cause. */
export type CircuitControl = Readonly<{ reset(store: StoreId): void }>

/**
 * Retries one sync after rotating a missing/rejected Shopify access token.
 * The retry is deliberately bounded to one attempt to avoid request loops.
 *
 * When the store circuit is open AND the caller supplied a fresh `id_token`,
 * the circuit is closed first: an open circuit caused by token failures is
 * repaired by the exchange, so refusing the request in ~9ms would leave the
 * store permanently stuck until the cooldown elapsed.
 */
export class TokenRefreshingSync {
  private readonly sync: SyncRunner
  private readonly directory: StoreDirectory
  private readonly tokenExchange: RejectedTokenExchange
  private readonly logger: Logger
  private readonly circuits: CircuitControl | null

  public constructor(sync: SyncRunner, directory: StoreDirectory, tokenExchange: RejectedTokenExchange, logger: Logger, circuits: CircuitControl | null = null) {
    this.sync = sync
    this.directory = directory
    this.tokenExchange = tokenExchange
    this.logger = logger
    this.circuits = circuits
  }

  public async runModule(store: StoreId, module: SyncModule, idToken?: string): Promise<SyncRunResult> {
    try {
      return await this.sync.runModule(store, module)
    } catch (error: unknown) {
      // An open circuit plus a usable id_token: rotate the token, close the
      // circuit, and let the retry below actually reach Shopify.
      if (isCircuitOpen(error) && idToken?.trim()) return this.recover(store, module, idToken, 'circuit-open', error)
      const reason = refreshReason(error)
      if (!reason) throw error
      if (!idToken?.trim()) throw reconnectRequired(store, reason, error)
      return this.recover(store, module, idToken, reason, error)
    }
  }

  private async recover(store: StoreId, module: SyncModule, idToken: string, reason: RecoveryReason, cause: unknown): Promise<SyncRunResult> {
    const connection = await this.directory.get(store)
    if (!connection) throw new AppError('NOT_FOUND', 'Shopify store is not registered', 404, { storeId: store })

    let result: OfflineTokenResult
    try {
      result = await this.tokenExchange.exchangeOfflineAccessToken(connection.shopDomain, idToken)
    } catch (exchangeError: unknown) {
      this.logger.error('Shopify offline access token refresh failed during sync', {
        shopDomain: connection.shopDomain,
        storeId: store,
        module,
        reason,
        error: exchangeError instanceof Error ? exchangeError.message : String(exchangeError),
        upstreamStatus: numberProperty(exchangeError, 'upstreamStatus'),
        upstreamCode: stringProperty(exchangeError, 'upstreamCode'),
      })
      throw withCause(new AppError(
        'DEPENDENCY_ERROR',
        'Shopify access token refresh failed. Hard refresh the embedded app and retry sync.',
        502,
        { storeId: store, action: 'HARD_REFRESH', reason },
      ), exchangeError instanceof Error ? exchangeError : cause)
    }

    // The cause of the failures is repaired; stop rejecting this store.
    this.circuits?.reset(store)

    this.logger.info('Shopify offline access token refreshed for sync retry', {
      shopDomain: connection.shopDomain,
      storeId: store,
      module,
      reason,
      accessMode: 'offline',
      source: result.source,
      scopes: result.scopes.join(','),
      circuitReset: this.circuits !== null,
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

type RecoveryReason = 'missing-token' | 'shopify-401' | 'circuit-open'

function refreshReason(error: unknown): 'missing-token' | 'shopify-401' | null {
  if (isShopifyAuthError(error)) return 'shopify-401'
  if (isShopifyApiError(error) && error.status === 401) return 'shopify-401'
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { status?: unknown; name?: unknown }
    if (candidate.status === 401 && (candidate.name === 'ShopifyApiError' || error instanceof Error)) return 'shopify-401'
    if (candidate.status === 401) return 'shopify-401'
  }
  if (error instanceof AppError && error.details.reason === 'SHOPIFY_TOKEN_MISSING') return 'missing-token'
  return null
}

function isCircuitOpen(error: unknown): boolean {
  return error instanceof AppError && error.details.reason === CIRCUIT_OPEN_REASON
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

function numberProperty(value: unknown, key: string): number {
  if (typeof value !== 'object' || value === null) return 0
  const property = (value as Record<string, unknown>)[key]
  return typeof property === 'number' ? property : 0
}

function stringProperty(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) return ''
  const property = (value as Record<string, unknown>)[key]
  return typeof property === 'string' ? property : ''
}
