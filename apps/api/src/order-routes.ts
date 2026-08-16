import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, storeId, success } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import { filterOrders, isOrderInsightFeature, parseOrderFilters } from './orders.js'
import type { OrderInsightFeature, OrderInsightsService, OrderRepository } from './orders.js'

export type OrderRouteDependencies = Readonly<{
  repository: OrderRepository
  insights: Pick<OrderInsightsService, 'get'>
}>

export function createOrderRouter(dependencies: OrderRouteDependencies): Router {
  const router = Router()

  router.get('/orders', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const orders = await dependencies.repository.list(tenant)
      response.status(200).json(success(filterOrders(orders, parseOrderFilters(request.query)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // Register this before /orders/:orderId so "insights" is never interpreted as an order id.
  router.get('/orders/insights', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const rawFeature = request.query.feature
      if (rawFeature !== undefined && !isOrderInsightFeature(rawFeature)) throw new AppError('VALIDATION_ERROR', 'Unknown order insight feature', 400, { feature: String(rawFeature) })
      const feature = isOrderInsightFeature(rawFeature) ? rawFeature as OrderInsightFeature : undefined
      const question = typeof request.query.question === 'string' ? request.query.question : undefined
      if (question && feature !== 'custom_ai_queries') throw new AppError('VALIDATION_ERROR', 'Custom questions require feature=custom_ai_queries', 400)
      const result = await dependencies.insights.get(tenant, feature, question)
      response.status(200).json(success(result, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/orders/:orderId', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const raw = request.params.orderId
      const orderId = typeof raw === 'string' ? raw.trim() : ''
      if (!orderId || orderId.length > 200) throw new AppError('VALIDATION_ERROR', 'A valid order id is required', 400)
      const order = await dependencies.repository.get(tenant, orderId)
      if (!order) throw new AppError('NOT_FOUND', 'Order was not found', 404)
      response.status(200).json(success(order, requestIdFrom(request)))
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
