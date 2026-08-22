import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { planAtLeast } from '@profitpilot/ai'
import { AppError, requestId, storeId, success } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import type { AnalyticsInsightsService } from './analytics-insights.js'

type AnalyticsMethods = Pick<AnalyticsInsightsService, 'get' | 'query' | 'channels' | 'geography' | 'cohorts' | 'comparisons' | 'funnel'>
/** `plan` is the server-side entitlement source (billing repository). When
 *  provided, every plan-restricted analytics route is gated here with a 402
 *  before the service runs — the client-side `hasPlan()` check in
 *  analytics.tsx is a UX nicety only and must never be the enforcement. */
export type AnalyticsRouteDependencies = Readonly<{ insights: AnalyticsMethods; plan?: (store: StoreId) => Promise<PlanTier> }>

export function createAnalyticsRouter(dependencies: AnalyticsRouteDependencies): Router {
  const router = Router()
  const requirePlan = async (store: StoreId, required: 'growth' | 'commander', feature: string): Promise<void> => {
    if (!dependencies.plan) return // service-level checks still apply (defense in depth)
    const plan = await dependencies.plan(store)
    if (!planAtLeast(plan, required)) throw new AppError('PAYMENT_REQUIRED', `Upgrade required for ${feature}`, 402, { reason: 'UPGRADE_REQUIRED', feature, plan, requiredPlan: required })
  }
  const get = (path: string, read: (store: StoreId) => Promise<unknown>, gate?: 'growth' | 'commander', feature?: string) => router.get(path, async (request, response, next) => {
    try {
      const store = queryStore(request)
      if (gate && feature) await requirePlan(store, gate, feature)
      response.status(200).json(success(await read(store), requestIdFrom(request)))
    } catch (error) { next(error) }
  })
  get('/analytics/insights', (store) => dependencies.insights.get(store))
  get('/analytics/channels', (store) => dependencies.insights.channels(store))
  get('/analytics/geography', (store) => dependencies.insights.geography(store), 'growth', 'analytics:geographic_distribution')
  get('/analytics/cohorts', (store) => dependencies.insights.cohorts(store), 'growth', 'analytics:cohort_analysis')
  get('/analytics/comparisons', (store) => dependencies.insights.comparisons(store), 'commander', 'analytics:period_comparisons')
  get('/analytics/funnel', (store) => dependencies.insights.funnel(store), 'growth', 'analytics:conversion_funnel')
  router.post('/analytics/insights/query', async (request, response, next) => {
    try {
      const body = request.body as unknown
      if (!isRecord(body) || typeof body.storeId !== 'string' || typeof body.question !== 'string') throw new AppError('VALIDATION_ERROR', 'storeId and question are required', 400)
      const store = storeId(body.storeId)
      await requirePlan(store, 'commander', 'analytics:custom_ai_queries')
      response.status(200).json(success(await dependencies.insights.query(store, body.question), requestIdFrom(request)))
    } catch (error) { next(error) }
  })
  return router
}
function queryStore(request: Request): StoreId { const value = request.query.storeId; if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_ERROR', 'storeId query parameter is required', 400); return storeId(value) }
function requestIdFrom(request: Request) { return requestId(request.header('x-request-id') || randomUUID()) }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
