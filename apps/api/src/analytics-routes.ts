import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, storeId, success } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { AnalyticsInsightsService } from './analytics-insights.js'

export type AnalyticsRouteDependencies = Readonly<{ insights: Pick<AnalyticsInsightsService, 'get' | 'query'> }>
export function createAnalyticsRouter(dependencies: AnalyticsRouteDependencies): Router {
  const router = Router()
  router.get('/analytics/insights', async (request, response, next) => { try { response.status(200).json(success(await dependencies.insights.get(queryStore(request)), requestIdFrom(request))) } catch (error) { next(error) } })
  router.post('/analytics/insights/query', async (request, response, next) => { try { const body = request.body as unknown; if (!isRecord(body) || typeof body.storeId !== 'string' || typeof body.question !== 'string') throw new AppError('VALIDATION_ERROR', 'storeId and question are required', 400); response.status(200).json(success(await dependencies.insights.query(storeId(body.storeId), body.question), requestIdFrom(request))) } catch (error) { next(error) } })
  return router
}
function queryStore(request: Request): StoreId { const value = request.query.storeId; if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_ERROR', 'storeId query parameter is required', 400); return storeId(value) }
function requestIdFrom(request: Request) { return requestId(request.header('x-request-id') || randomUUID()) }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
