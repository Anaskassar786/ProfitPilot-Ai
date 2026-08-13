import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { AppError, requestId, storeId, success } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { CostMeter, DecisionEngine, RecommendationRepository } from '@profitpilot/ai'

export type AiRouteDependencies = Readonly<{ engine: Pick<DecisionEngine, 'statuses'>; recommendations: RecommendationRepository; costs: Pick<CostMeter, 'summary'> }>

export function createAiRouter(dependencies: AiRouteDependencies): Router {
  const router = Router()

  router.get('/ai/agents', (request, response) => {
    response.status(200).json(success(dependencies.engine.statuses(), requestIdFrom(request)))
  })

  router.get('/recommendations', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      response.status(200).json(success(await dependencies.recommendations.list(tenant), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/recommendations/:id/approve', async (request, response, next) => {
    await decide(request, response, next, dependencies, 'APPROVED')
  })

  router.post('/recommendations/:id/reject', async (request, response, next) => {
    await decide(request, response, next, dependencies, 'REJECTED')
  })

  router.get('/ai/cost', (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      response.status(200).json(success(dependencies.costs.summary(tenant), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  return router
}

async function decide(request: Request, response: Response, next: NextFunction, dependencies: AiRouteDependencies, status: 'APPROVED' | 'REJECTED'): Promise<void> {
  try {
    const tenant = queryStoreId(request)
    const body = request.body as unknown
    if (!isRecord(body) || typeof body.expectedVersion !== 'number' || !Number.isInteger(body.expectedVersion)) throw new AppError('VALIDATION_ERROR', 'expectedVersion is required', 400)
    const rawId = request.params.id
    const id = typeof rawId === 'string' ? rawId : rawId?.[0]
    if (!id) throw new AppError('VALIDATION_ERROR', 'recommendation id is required', 400)
    const result = await dependencies.recommendations.decide(tenant, id, body.expectedVersion, status)
    response.status(200).json(success(result, requestIdFrom(request)))
  } catch (error: unknown) { next(error) }
}

function queryStoreId(request: Request): StoreId {
  const value = request.query.storeId ?? (typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>).storeId : undefined)
  if (typeof value !== 'string' || value.trim().length === 0) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400)
  return storeId(value)
}

function requestIdFrom(request: Request) { return requestId(request.header('x-request-id') || randomUUID()) }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

