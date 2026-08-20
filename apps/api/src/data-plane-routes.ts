import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { requestId, storeId, success, AppError, toAppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { AnalyticsRepository, StoreDirectory } from '@profitpilot/db'
import { SYNC_MODULES } from '@profitpilot/sync'
import type { CircuitSnapshot, SyncModule, SyncRunResult } from '@profitpilot/sync'
import { getAuthContext } from './security.js'

export type SyncCircuits = Readonly<{
  snapshot(store: StoreId, now?: number): CircuitSnapshot
  reset(store: StoreId): void
}>

export type SyncTokenVault = Readonly<{ get(shop: string): Promise<string | null> }>

export type DataPlaneDependencies = Readonly<{
  sync: Readonly<{ runModule(store: StoreId, module: SyncModule, idToken?: string): Promise<SyncRunResult> }>
  analytics: Pick<AnalyticsRepository, 'read' | 'readCatalog'>
  circuits?: SyncCircuits
  tokenVault?: SyncTokenVault
  directory?: Pick<StoreDirectory, 'get' | 'getByShopDomain'>
}>

export function createDataPlaneRouter(dependencies: DataPlaneDependencies): Router {
  const router = Router()

  router.post('/sync', async (request, response, next) => {
    try {
      const body = request.body as unknown
      if (!isRecord(body) || typeof body.storeId !== 'string' || typeof body.module !== 'string' || !isSyncModule(body.module)) throw new AppError('VALIDATION_ERROR', 'storeId and a valid sync module are required', 400)
      const idToken = shopifySessionToken(request) ?? verifiedEmbeddedSessionToken(request)
      const result = await dependencies.sync.runModule(storeId(body.storeId), body.module, idToken ?? undefined)
      response.status(202).json(success(result, requestIdFrom(request)))
    } catch (error: unknown) {
      next(error)
    }
  })

  /** Runs all eight Shopify modules sequentially so rate limits and checkpoints remain predictable. */
  router.post('/sync/all', async (request, response, next) => {
    try {
      const body = request.body as unknown
      if (!isRecord(body) || typeof body.storeId !== 'string' || !body.storeId.trim()) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400)
      const tenant = storeId(body.storeId)
      const idToken = shopifySessionToken(request) ?? verifiedEmbeddedSessionToken(request)
      const modules: Array<Readonly<{ module: SyncModule; status: 'succeeded'; result: SyncRunResult }> | Readonly<{ module: SyncModule; status: 'failed'; error: Readonly<{ code: string; message: string }> }>> = []
      for (const module of SYNC_MODULES) {
        try {
          const result = await dependencies.sync.runModule(tenant, module, idToken ?? undefined)
          modules.push({ module, status: 'succeeded', result })
        } catch (error: unknown) {
          const failure = toAppError(error)
          modules.push({ module, status: 'failed', error: { code: failure.code, message: failure.expose ? failure.message : 'Internal server error' } })
        }
      }
      const succeeded = modules.filter((module) => module.status === 'succeeded').map((module) => module.module)
      const failed = modules.filter((module) => module.status === 'failed').map((module) => module.module)
      response.status(failed.length > 0 ? 207 : 200).json(success({ storeId: tenant, modules, succeeded, failed }, requestIdFrom(request)))
    } catch (error: unknown) {
      next(error)
    }
  })

  /**
   * Read-only health of the store's Shopify connection: whether an offline
   * access token exists, and whether the circuit breaker is currently open.
   * This is what answers "did token exchange actually succeed?" without a
   * database shell, and it never returns the token itself.
   */
  router.get('/sync/status', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const connection = await dependencies.directory?.get(tenant) ?? null
      response.status(200).json(success(await connectionStatus(dependencies, tenant, connection), requestIdFrom(request)))
    } catch (error: unknown) {
      next(error)
    }
  })

  /** Shopify-friendly alias that resolves the app's internal tenant id. */
  router.get('/shopify/status', async (request, response, next) => {
    try {
      const shop = typeof request.query.shop === 'string' ? request.query.shop.trim() : ''
      if (!shop) throw new AppError('VALIDATION_ERROR', 'shop query parameter is required', 400)
      if (!dependencies.directory) throw new AppError('DEPENDENCY_ERROR', 'Shopify store directory is not configured', 503)
      const connection = await dependencies.directory.getByShopDomain(shop)
      if (!connection) {
        response.status(200).json(success({ storeId: null, shopDomain: shop.toLowerCase(), registered: false, hasAccessToken: null, circuit: null, canSync: false }, requestIdFrom(request)))
        return
      }
      const authenticatedStore = getAuthContext(request)?.claims.storeId
      if (authenticatedStore && authenticatedStore !== connection.storeId) throw new AppError('NOT_FOUND', 'Shopify store was not found', 404)
      response.status(200).json(success(await connectionStatus(dependencies, connection.storeId, connection), requestIdFrom(request)))
    } catch (error: unknown) {
      next(error)
    }
  })

  /**
   * Manual circuit reset. The breaker also self-heals after its cooldown and is
   * closed automatically when a token exchange repairs the cause, but an
   * operator (or the dashboard's "Retry now" action) can close it immediately.
   */
  router.post('/sync/circuit/reset', (request, response, next) => {
    try {
      const body = request.body as unknown
      const tenantValue = isRecord(body) && typeof body.storeId === 'string' ? body.storeId : typeof request.query.storeId === 'string' ? request.query.storeId : ''
      if (!tenantValue.trim()) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400)
      if (!dependencies.circuits) throw new AppError('DEPENDENCY_ERROR', 'Sync circuit control is not configured', 503)
      const tenant = storeId(tenantValue)
      dependencies.circuits.reset(tenant)
      response.status(200).json(success({ storeId: tenant, circuit: dependencies.circuits.snapshot(tenant) }, requestIdFrom(request)))
    } catch (error: unknown) {
      next(error)
    }
  })

  router.get('/analytics', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const result = await dependencies.analytics.read(tenant)
      response.status(200).json(success(result, requestIdFrom(request)))
    } catch (error: unknown) {
      next(error)
    }
  })

  router.get('/catalog', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const result = await dependencies.analytics.readCatalog(tenant)
      response.status(200).json(success(result, requestIdFrom(request)))
    } catch (error: unknown) {
      next(error)
    }
  })

  return router
}

async function connectionStatus(
  dependencies: DataPlaneDependencies,
  tenant: StoreId,
  connection: Readonly<{ storeId: StoreId; shopDomain: string }> | null,
): Promise<Readonly<Record<string, unknown>>> {
  const circuit = dependencies.circuits?.snapshot(tenant) ?? null
  const hasAccessToken = connection && dependencies.tokenVault ? (await dependencies.tokenVault.get(connection.shopDomain)) !== null : null
  return {
    storeId: tenant,
    shopDomain: connection?.shopDomain ?? null,
    registered: connection !== null,
    hasAccessToken,
    circuit,
    canSync: connection !== null && hasAccessToken === true && circuit?.open !== true,
  }
}

function queryStoreId(request: Request): StoreId {
  const value = request.query.storeId
  if (typeof value !== 'string' || value.trim().length === 0) throw new AppError('VALIDATION_ERROR', 'storeId query parameter is required', 400)
  return storeId(value)
}

function requestIdFrom(request: Request) {
  const value = request.header('x-request-id')
  return requestId(value && value.length > 0 ? value : cryptoRandomId())
}

function cryptoRandomId(): string {
  return randomUUID()
}

function isSyncModule(value: string): value is SyncModule {
  return (SYNC_MODULES as readonly string[]).includes(value)
}

function shopifySessionToken(request: Request): string | null {
  const value = request.header('x-shopify-session-token')?.trim()
  // Shopify session JWTs are short lived and comfortably below this bound.
  // Reject an oversized header instead of forwarding attacker-controlled data.
  if (!value || value.length > 8_192) return null
  return value
}

/**
 * The `Authorization` bearer, but ONLY when the authentication middleware
 * already established a `shopify-session-token` context for this request.
 * That guarantee means the value is a Shopify session token the token
 * exchange can legitimately use — never a first-party app JWT — so sync's
 * one-shot RFC 8693 retry keeps working after the URL `id_token` disappears.
 */
function verifiedEmbeddedSessionToken(request: Request): string | null {
  const context = getAuthContext(request)
  if (context?.method !== 'shopify-session-token') return null
  const value = request.header('authorization')?.trim()
  if (!value || value.length > 8_192) return null
  const [scheme, token] = value.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token?.trim() ? token.trim() : null
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
