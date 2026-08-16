import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, storeId, success } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import { isCustomerInsightFeature, parseCustomerFilters } from './customer-insights.js'
import type { CustomerInsightFeature, CustomerInsightsService, CustomerService } from './customer-insights.js'

export type CustomerRouteDependencies = Readonly<{
  customers: Pick<CustomerService, 'list' | 'get'>
  insights: Pick<CustomerInsightsService, 'get' | 'query'>
}>

export function createCustomerRouter(dependencies: CustomerRouteDependencies): Router {
  const router = Router()

  router.get('/customers', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      response.status(200).json(success(await dependencies.customers.list(tenant, parseCustomerFilters(request.query)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // Register insight routes before /customers/:customerId.
  router.get('/customers/insights', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const rawFeature = request.query.feature
      if (rawFeature !== undefined && !isCustomerInsightFeature(rawFeature)) throw new AppError('VALIDATION_ERROR', 'Unknown customer insight feature', 400, { feature: String(rawFeature) })
      const feature = isCustomerInsightFeature(rawFeature) ? rawFeature as CustomerInsightFeature : undefined
      response.status(200).json(success(await dependencies.insights.get(tenant, feature), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/customers/insights/query', async (request, response, next) => {
    try {
      const body = request.body as unknown
      if (!isRecord(body) || typeof body.storeId !== 'string' || typeof body.question !== 'string') throw new AppError('VALIDATION_ERROR', 'storeId and question are required', 400)
      response.status(200).json(success(await dependencies.insights.query(storeId(body.storeId), body.question), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/customers/:customerId', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const value = request.params.customerId
      const customerId = typeof value === 'string' ? value.trim() : ''
      if (!customerId || customerId.length > 300) throw new AppError('VALIDATION_ERROR', 'A valid customer id is required', 400)
      const customer = await dependencies.customers.get(tenant, customerId)
      if (!customer) throw new AppError('NOT_FOUND', 'Customer was not found', 404)
      response.status(200).json(success(customer, requestIdFrom(request)))
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
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
