import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { requestId, storeId, success, AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { AnalyticsRepository } from '@profitpilot/db'
import { SYNC_MODULES } from '@profitpilot/sync'
import type { SyncModule, SyncRunResult } from '@profitpilot/sync'

export type DataPlaneDependencies = Readonly<{ sync: Readonly<{ runModule(store: StoreId, module: SyncModule): Promise<SyncRunResult> }>; analytics: Pick<AnalyticsRepository, 'read' | 'readCatalog'> }>

export function createDataPlaneRouter(dependencies: DataPlaneDependencies): Router {
  const router = Router()

  router.post('/sync', async (request, response, next) => {
    try {
      const body = request.body as unknown
      if (!isRecord(body) || typeof body.storeId !== 'string' || typeof body.module !== 'string' || !isSyncModule(body.module)) throw new AppError('VALIDATION_ERROR', 'storeId and a valid sync module are required', 400)
      const result = await dependencies.sync.runModule(storeId(body.storeId), body.module)
      response.status(202).json(success(result, requestIdFrom(request)))
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
