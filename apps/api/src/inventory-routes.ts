import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, storeId, success } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { filterInventory, parseInventoryFilters } from './inventory.js'
import type { InventoryRepository } from './inventory.js'
import { isInventoryInsightFeature, normalizeHistoryDays } from './inventory-insights.js'
import type { InventoryInsightsService } from './inventory-insights.js'

export type InventoryRouteDependencies = Readonly<{
  repository: InventoryRepository
  /** Resolves the tenant's plan so locked premium metadata is accurate. */
  plan: (storeId: StoreId) => Promise<PlanTier>
  /** Optional so the inventory table can be served without the AI layer wired. */
  insights?: Pick<InventoryInsightsService, 'get' | 'query' | 'history' | 'recordReorderDecision'>
}>

export function createInventoryRouter(dependencies: InventoryRouteDependencies): Router {
  const router = Router()
  const insights = dependencies.insights

  router.get('/inventory', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const filters = parseInventoryFilters(request.query)
      const [dataset, plan] = await Promise.all([
        dependencies.repository.list(tenant, filters.lowStockThreshold),
        dependencies.plan(tenant),
      ])
      response.status(200).json(success(filterInventory(dataset, filters, plan), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // Every fixed path is registered before /inventory/:variantId so a route name
  // is never parsed as a variant id.
  router.get('/inventory/locations', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const dataset = await dependencies.repository.list(tenant)
      const totals = new Map<string, { itemCount: number; totalUnits: number }>()
      for (const item of dataset.items) {
        for (const level of item.locations) {
          const current = totals.get(level.locationId) ?? { itemCount: 0, totalUnits: 0 }
          totals.set(level.locationId, { itemCount: current.itemCount + 1, totalUnits: current.totalUnits + Math.max(0, level.available) })
        }
      }
      const locations = dataset.locations.map((location) => ({ ...location, ...(totals.get(location.id) ?? { itemCount: 0, totalUnits: 0 }) }))
      response.status(200).json(success({ locations, multiLocation: locations.length > 1, coverage: dataset.coverage }, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/inventory/insights', async (request, response, next) => {
    try {
      const service = requireInsights(insights)
      const tenant = queryStoreId(request)
      const rawFeature = request.query.feature
      if (rawFeature !== undefined && !isInventoryInsightFeature(rawFeature)) throw new AppError('VALIDATION_ERROR', 'Unknown inventory insight feature', 400, { feature: String(rawFeature) })
      const feature = typeof rawFeature === 'string' ? rawFeature : undefined
      if (typeof request.query.question === 'string') throw new AppError('VALIDATION_ERROR', 'Custom questions must use POST /inventory/insights/query', 400)
      response.status(200).json(success(await service.get(tenant, feature), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/inventory/insights/query', async (request, response, next) => {
    try {
      const service = requireInsights(insights)
      const body = request.body as unknown
      if (!isRecord(body) || typeof body.storeId !== 'string' || typeof body.question !== 'string') throw new AppError('VALIDATION_ERROR', 'storeId and question are required', 400)
      response.status(200).json(success(await service.query(storeId(body.storeId), body.question), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/inventory/history', async (request, response, next) => {
    try {
      const service = requireInsights(insights)
      const tenant = queryStoreId(request)
      const raw = request.query.days
      if (raw !== undefined && typeof raw !== 'string' && typeof raw !== 'number') throw new AppError('VALIDATION_ERROR', 'days must be one of 7, 30, 90, or 365', 400)
      response.status(200).json(success(await service.history(tenant, normalizeHistoryDays(raw)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // Manual review of a reorder suggestion. This records the merchant's decision
  // for the audit trail; ProfitPilot never places a purchase order itself.
  router.post('/inventory/reorder-decision', async (request, response, next) => {
    try {
      const service = requireInsights(insights)
      const body = request.body as unknown
      if (!isRecord(body) || typeof body.storeId !== 'string' || typeof body.productId !== 'string' || typeof body.decision !== 'string') throw new AppError('VALIDATION_ERROR', 'storeId, productId, and decision are required', 400)
      response.status(200).json(success(await service.recordReorderDecision(storeId(body.storeId), body.productId, body.decision), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/inventory/:variantId', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const raw = request.params.variantId
      const variantId = typeof raw === 'string' ? raw.trim() : ''
      if (!variantId || variantId.length > 200) throw new AppError('VALIDATION_ERROR', 'A valid variant id is required', 400)
      const item = await dependencies.repository.get(tenant, variantId)
      if (!item) throw new AppError('NOT_FOUND', 'Inventory item was not found', 404)
      response.status(200).json(success(item, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  return router
}

function requireInsights<Service>(service: Service | undefined): Service {
  if (!service) throw new AppError('NOT_FOUND', 'Inventory intelligence is not enabled on this deployment', 404)
  return service
}
function queryStoreId(request: Request): StoreId {
  const value = request.query.storeId
  if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_ERROR', 'storeId query parameter is required', 400)
  return storeId(value)
}
function requestIdFrom(request: Request) { return requestId(request.header('x-request-id') || randomUUID()) }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
