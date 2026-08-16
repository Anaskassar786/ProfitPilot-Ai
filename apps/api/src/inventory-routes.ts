import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, storeId, success } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { filterInventory, parseInventoryFilters } from './inventory.js'
import type { InventoryRepository } from './inventory.js'

export type InventoryRouteDependencies = Readonly<{
  repository: InventoryRepository
  /** Resolves the tenant's plan so locked premium metadata is accurate. */
  plan: (storeId: StoreId) => Promise<PlanTier>
}>

export function createInventoryRouter(dependencies: InventoryRouteDependencies): Router {
  const router = Router()

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

  // Registered before /inventory/:variantId so "locations" is never parsed as a variant id.
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

function queryStoreId(request: Request): StoreId {
  const value = request.query.storeId
  if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_ERROR', 'storeId query parameter is required', 400)
  return storeId(value)
}
function requestIdFrom(request: Request) { return requestId(request.header('x-request-id') || randomUUID()) }
