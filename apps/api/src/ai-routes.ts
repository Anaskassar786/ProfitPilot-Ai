import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { AppError, hasPermission, requestId, storeId, success } from '@profitpilot/types'
import type { PlanTier, Role, StoreId } from '@profitpilot/types'
import { AGENT_IDS, REJECT_REASONS, RULE_IDS, verifyEvidencePack } from '@profitpilot/ai'
import type { ActionExecutor, AgentId, CostMeter, DecisionEngine, EvidencePack, Recommendation, RecommendationListQuery, RecommendationRepository, RecommendationSort, RecommendationStatus, RejectReason, RuleId } from '@profitpilot/ai'
import { getAuthContext } from './security.js'

const DECISION_STATUSES: readonly RecommendationStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED', 'EXPIRED']
const SORTS: readonly RecommendationSort[] = ['impact', 'confidence', 'created', 'decided']
const BULK_DECISION_LIMIT = 20
const SNOOZE_MAX_HOURS = 7 * 24
export const AI_RECOMMENDATION_USAGE_FEATURE = 'ai_recommendations_month'

export type RecommendationUsageMeter = Readonly<{
  /** Current period usage for ai_recommendations_month. */
  current(storeId: StoreId): Promise<number>
  /** Atomically add `count` to the period usage. */
  add(storeId: StoreId, count: number): Promise<void>
}>

export type RecommendationCalibration = Readonly<{
  record(storeId: StoreId, agent: AgentId, recommendationId: string, outcome: 'accepted' | 'rejected'): Promise<void>
}>

export type RecommendationAudit = Readonly<{
  record(entry: Readonly<{ storeId: StoreId; actorId: string | null; action: string; recommendationId: string; detail: Readonly<Record<string, string | number | boolean | null>> }>): Promise<void>
}>

export type AiRouteDependencies = Readonly<{
  engine: Pick<DecisionEngine, 'statuses'> & Partial<Pick<DecisionEngine, 'run'>>
  recommendations: RecommendationRepository
  costs: Pick<CostMeter, 'summary' | 'record'>
  snapshot?: (storeId: StoreId) => Promise<import('@profitpilot/ai').StoreSnapshot>
  /** Resolves the tenant plan for gating. Absent = gating disabled (tests). */
  plan?: (storeId: StoreId) => Promise<PlanTier>
  /** Plan limit for a feature. Absent = unlimited. */
  limit?: (plan: PlanTier, feature: typeof AI_RECOMMENDATION_USAGE_FEATURE) => number | null
  usage?: RecommendationUsageMeter
  calibration?: RecommendationCalibration
  audit?: RecommendationAudit
  /**
   * Role resolver for RBAC. A store with no explicit member roles resolves to
   * 'owner' — the embedded Shopify session belongs to the store owner.
   */
  role?: (storeId: StoreId, userId: string | null) => Promise<Role>
  executor?: ActionExecutor
  /** Idempotently matches executed actions to synced orders; returns rows written. */
  attribution?: (storeId: StoreId) => Promise<number>
}>

export function createAiRouter(dependencies: AiRouteDependencies): Router {
  const router = Router()

  router.get('/ai/agents', (request, response) => {
    response.status(200).json(success(dependencies.engine.statuses(), requestIdFrom(request)))
  })

  router.get('/ai/cost', (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      response.status(200).json(success(dependencies.costs.summary(tenant), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // Fixed paths are registered before /recommendations/:id so a route name is
  // never parsed as a recommendation id.
  router.get('/recommendations/summary', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      await dependencies.recommendations.expireStale(tenant)
      if (dependencies.attribution) await dependencies.attribution(tenant).catch(() => 0)
      const [summary, plan] = await Promise.all([
        dependencies.recommendations.summary(tenant),
        dependencies.plan ? dependencies.plan(tenant) : Promise.resolve<PlanTier | null>(null),
      ])
      const limit = plan && dependencies.limit ? dependencies.limit(plan, AI_RECOMMENDATION_USAGE_FEATURE) : null
      const used = dependencies.usage ? await dependencies.usage.current(tenant) : null
      response.status(200).json(success({
        ...summary,
        plan,
        usage: { feature: AI_RECOMMENDATION_USAGE_FEATURE, used, limit, remaining: limit === null || used === null ? null : Math.max(0, limit - used) },
      }, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/recommendations/analyze', async (request, response, next) => {
    try {
      if (!('run' in dependencies.engine) || !dependencies.engine.run || !dependencies.snapshot) throw new AppError('DEPENDENCY_ERROR', 'Recommendation analysis is not configured', 503)
      const tenant = queryStoreId(request)
      await requireRole(dependencies, request, tenant, 'recommendations:approve')
      // Plan gate: generation is metered monthly per store.
      let remaining: number | null = null
      if (dependencies.plan && dependencies.limit && dependencies.usage) {
        const plan = await dependencies.plan(tenant)
        const limit = dependencies.limit(plan, AI_RECOMMENDATION_USAGE_FEATURE)
        if (limit !== null) {
          const used = await dependencies.usage.current(tenant)
          remaining = Math.max(0, limit - used)
          if (remaining === 0) {
            throw new AppError('FORBIDDEN', `Your ${plan} plan includes ${limit} AI recommendations per month and all ${limit} are used. Upgrade to keep generating.`, 403, { reason: 'UPGRADE_REQUIRED', feature: AI_RECOMMENDATION_USAGE_FEATURE, plan, used, limit })
          }
        }
      }
      const snapshot = await dependencies.snapshot(tenant)
      const result = await dependencies.engine.run(snapshot, remaining === null ? {} : { maxRecommendations: remaining })
      if (dependencies.usage && result.recommendations.length > 0) await dependencies.usage.add(tenant, result.recommendations.length)
      if (dependencies.audit) await dependencies.audit.record({ storeId: tenant, actorId: actorId(request), action: 'recommendations.analyze', recommendationId: 'batch', detail: { generated: result.recommendations.length } })
      response.status(200).json(success(result, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/recommendations/bulk-decide', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const body = request.body as unknown
      if (!isRecord(body) || !Array.isArray(body.decisions)) throw new AppError('VALIDATION_ERROR', 'decisions array is required', 400)
      if (body.decisions.length === 0 || body.decisions.length > BULK_DECISION_LIMIT) throw new AppError('VALIDATION_ERROR', `decisions must contain 1-${BULK_DECISION_LIMIT} items`, 400)
      const parsed = body.decisions.map(parseBulkItem)
      const results: Array<Readonly<{ id: string; ok: boolean; recommendation?: Recommendation; error?: Readonly<{ code: string; message: string; status: number }> }>> = []
      for (const item of parsed) {
        try {
          const recommendation = await applyDecision(dependencies, request, tenant, item.id, item.expectedVersion, item.decision, item.reason)
          results.push({ id: item.id, ok: true, recommendation })
        } catch (error: unknown) {
          const app = error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'Decision failed', 500, {}, false)
          results.push({ id: item.id, ok: false, error: { code: app.code, message: app.expose ? app.message : 'Decision failed', status: app.status } })
        }
      }
      response.status(200).json(success({ results }, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/recommendations', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      await dependencies.recommendations.expireStale(tenant)
      const query = parseListQuery(request)
      response.status(200).json(success(await dependencies.recommendations.page(tenant, query), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/recommendations/:id/evidence/verify', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const recommendation = await loadRecommendation(dependencies, tenant, request)
      const pack = recommendation.evidencePack as Partial<EvidencePack>
      const complete = typeof pack.sha256 === 'string' && typeof pack.id === 'string' && typeof pack.ruleId === 'string' && typeof pack.ruleVersion === 'string' && typeof pack.generatedAt === 'string' && Array.isArray(pack.fields)
      const verified = complete ? verifyEvidencePack(pack as EvidencePack) : false
      response.status(200).json(success({ verified, sha256: typeof pack.sha256 === 'string' ? pack.sha256 : null, ruleVersion: typeof pack.ruleVersion === 'string' ? pack.ruleVersion : null, generatedAt: typeof pack.generatedAt === 'string' ? pack.generatedAt : null }, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/recommendations/:id', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      response.status(200).json(success(await loadRecommendation(dependencies, tenant, request), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/recommendations/:id/approve', async (request, response, next) => {
    await decide(request, response, next, dependencies, 'APPROVED')
  })

  router.post('/recommendations/:id/reject', async (request, response, next) => {
    await decide(request, response, next, dependencies, 'REJECTED')
  })

  router.post('/recommendations/:id/undo', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      await requireRole(dependencies, request, tenant, 'recommendations:approve')
      const id = paramId(request)
      const before = await dependencies.recommendations.get(tenant, id)
      const result = await dependencies.recommendations.undo(tenant, id)
      if (before && dependencies.calibration) {
        // The undone decision no longer represents merchant feedback; append a
        // compensating sample so calibration counts stay truthful.
        await dependencies.calibration.record(tenant, result.agent, result.id, before.status === 'APPROVED' ? 'rejected' : 'accepted').catch(() => undefined)
      }
      if (dependencies.audit) await dependencies.audit.record({ storeId: tenant, actorId: actorId(request), action: 'recommendations.undo', recommendationId: id, detail: { previousStatus: before?.status ?? 'UNKNOWN' } })
      response.status(200).json(success(result, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/recommendations/:id/snooze', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const id = paramId(request)
      const body = request.body as unknown
      const hours = isRecord(body) && typeof body.hours === 'number' && Number.isFinite(body.hours) ? Math.min(Math.max(body.hours, 1 / 60), SNOOZE_MAX_HOURS) : 1
      const until = new Date(Date.now() + hours * 3_600_000).toISOString()
      response.status(200).json(success(await dependencies.recommendations.snooze(tenant, id, until), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/recommendations/:id/execute', async (request, response, next) => {
    try {
      if (!dependencies.executor) throw new AppError('DEPENDENCY_ERROR', 'Action execution is not configured', 503)
      const tenant = queryStoreId(request)
      const id = paramId(request)
      const recommendation = await dependencies.recommendations.get(tenant, id)
      if (!recommendation) throw new AppError('NOT_FOUND', 'Recommendation not found', 404, { id })
      if (recommendation.status !== 'APPROVED') throw new AppError('CONFLICT', 'Only an approved recommendation can be executed', 409, { id, status: recommendation.status })
      // High-risk executions stay owner/admin territory even though the
      // recommendation itself was already approved.
      await requireRole(dependencies, request, tenant, 'recommendations:approve', recommendation.actionRisk !== 'SAFE')
      try {
        const execution = await dependencies.executor.execute({
          id: recommendation.id,
          storeId: tenant,
          actionType: recommendation.actionType,
          payload: { recommendationId: recommendation.id, title: recommendation.title, entityKey: recommendation.entityKey, impactValue: recommendation.impactValue, currency: recommendation.currency, ruleId: recommendation.ruleId },
          approvalStatus: 'approved',
          mode: 'MANUAL',
          dailyCap: 25,
        })
        const updated = await dependencies.recommendations.markExecution(tenant, id, 'EXECUTED')
        if (dependencies.audit) await dependencies.audit.record({ storeId: tenant, actorId: actorId(request), action: 'recommendations.execute', recommendationId: id, detail: { actionType: recommendation.actionType, outcome: 'EXECUTED' } })
        response.status(200).json(success({ recommendation: updated, execution }, requestIdFrom(request)))
      } catch (error: unknown) {
        if (error instanceof AppError && (error.status === 403 || error.status === 429)) throw error
        await dependencies.recommendations.markExecution(tenant, id, 'FAILED').catch(() => undefined)
        if (dependencies.audit) await dependencies.audit.record({ storeId: tenant, actorId: actorId(request), action: 'recommendations.execute', recommendationId: id, detail: { actionType: recommendation.actionType, outcome: 'FAILED' } })
        throw error
      }
    } catch (error: unknown) { next(error) }
  })

  return router
}

async function decide(request: Request, response: Response, next: NextFunction, dependencies: AiRouteDependencies, status: 'APPROVED' | 'REJECTED'): Promise<void> {
  try {
    const tenant = queryStoreId(request)
    const body = request.body as unknown
    if (!isRecord(body) || typeof body.expectedVersion !== 'number' || !Number.isInteger(body.expectedVersion)) throw new AppError('VALIDATION_ERROR', 'expectedVersion is required', 400)
    const id = paramId(request)
    const reason = status === 'REJECTED' ? parseRejectReason(body.reason) : null
    const result = await applyDecision(dependencies, request, tenant, id, body.expectedVersion, status, reason)
    response.status(200).json(success(result, requestIdFrom(request)))
  } catch (error: unknown) { next(error) }
}

/** Shared decision path used by single and bulk endpoints: RBAC → CAS → calibration → audit. */
async function applyDecision(dependencies: AiRouteDependencies, request: Request, tenant: StoreId, id: string, expectedVersion: number, status: 'APPROVED' | 'REJECTED', reason: RejectReason | null): Promise<Recommendation> {
  const current = await dependencies.recommendations.get(tenant, id)
  if (!current) throw new AppError('NOT_FOUND', 'Recommendation not found', 404, { id })
  await requireRole(dependencies, request, tenant, 'recommendations:approve', status === 'APPROVED' && current.actionRisk !== 'SAFE')
  const result = await dependencies.recommendations.decide(tenant, id, expectedVersion, status, { decidedBy: actorId(request), rejectReason: reason })
  if (dependencies.calibration) await dependencies.calibration.record(tenant, result.agent, result.id, status === 'APPROVED' ? 'accepted' : 'rejected').catch(() => undefined)
  if (dependencies.audit) await dependencies.audit.record({ storeId: tenant, actorId: actorId(request), action: status === 'APPROVED' ? 'recommendations.approve' : 'recommendations.reject', recommendationId: id, detail: { agent: result.agent, ruleId: result.ruleId, actionType: result.actionType, rejectReason: reason, expectedVersion } })
  return result
}

/**
 * RBAC (PR #46): decisions require `recommendations:approve`; approving or
 * executing a non-SAFE action additionally requires owner/admin. Stores with
 * no explicit member roles resolve to 'owner' — the embedded Shopify session
 * belongs to the store owner.
 */
async function requireRole(dependencies: AiRouteDependencies, request: Request, tenant: StoreId, permission: 'recommendations:approve', highRisk = false): Promise<void> {
  if (!dependencies.role) return
  const role = await dependencies.role(tenant, actorId(request))
  if (!hasPermission(role, permission)) throw new AppError('FORBIDDEN', 'Your role cannot decide recommendations', 403, { role, permission })
  if (highRisk && role !== 'owner' && role !== 'admin') throw new AppError('FORBIDDEN', 'Only an owner or admin can approve actions that contact customers or change the store', 403, { role, permission: 'recommendations:approve:high-risk' })
}

async function loadRecommendation(dependencies: AiRouteDependencies, tenant: StoreId, request: Request): Promise<Recommendation> {
  const id = paramId(request)
  const recommendation = await dependencies.recommendations.get(tenant, id)
  if (!recommendation) throw new AppError('NOT_FOUND', 'Recommendation not found', 404, { id })
  return recommendation
}

function parseListQuery(request: Request): RecommendationListQuery {
  const query: Record<string, unknown> = {}
  const status = stringParam(request, 'status')
  if (status) {
    if (!DECISION_STATUSES.includes(status as RecommendationStatus)) throw new AppError('VALIDATION_ERROR', 'Invalid status filter', 400, { status })
    query.status = status
  }
  const agent = stringParam(request, 'agent')
  if (agent) {
    if (!AGENT_IDS.includes(agent as AgentId)) throw new AppError('VALIDATION_ERROR', 'Invalid agent filter', 400, { agent })
    query.agent = agent
  }
  const ruleId = stringParam(request, 'ruleId')
  if (ruleId) {
    if (!RULE_IDS.includes(ruleId as RuleId)) throw new AppError('VALIDATION_ERROR', 'Invalid rule filter', 400, { ruleId })
    query.ruleId = ruleId
  }
  const minImpact = numberParam(request, 'minImpact')
  if (minImpact !== null) query.minImpact = minImpact
  const maxImpact = numberParam(request, 'maxImpact')
  if (maxImpact !== null) query.maxImpact = maxImpact
  const dateFrom = stringParam(request, 'dateFrom')
  if (dateFrom) query.dateFrom = dateFrom
  const dateTo = stringParam(request, 'dateTo')
  if (dateTo) query.dateTo = dateTo
  const sort = stringParam(request, 'sort')
  if (sort) {
    if (!SORTS.includes(sort as RecommendationSort)) throw new AppError('VALIDATION_ERROR', 'Invalid sort', 400, { sort })
    query.sort = sort
  }
  const direction = stringParam(request, 'direction')
  if (direction) {
    if (direction !== 'asc' && direction !== 'desc') throw new AppError('VALIDATION_ERROR', 'Invalid sort direction', 400, { direction })
    query.direction = direction
  }
  const cursor = numberParam(request, 'cursor')
  if (cursor !== null) query.cursor = Math.max(0, Math.floor(cursor))
  const limit = numberParam(request, 'limit')
  if (limit !== null) query.limit = limit
  return query as RecommendationListQuery
}

function parseBulkItem(value: unknown): Readonly<{ id: string; expectedVersion: number; decision: 'APPROVED' | 'REJECTED'; reason: RejectReason | null }> {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) throw new AppError('VALIDATION_ERROR', 'Each decision needs a recommendation id', 400)
  if (typeof value.expectedVersion !== 'number' || !Number.isInteger(value.expectedVersion)) throw new AppError('VALIDATION_ERROR', 'Each decision needs an integer expectedVersion', 400)
  if (value.decision !== 'approve' && value.decision !== 'reject') throw new AppError('VALIDATION_ERROR', 'decision must be approve or reject', 400)
  return { id: value.id, expectedVersion: value.expectedVersion, decision: value.decision === 'approve' ? 'APPROVED' : 'REJECTED', reason: value.decision === 'reject' ? parseRejectReason(value.reason) : null }
}

function parseRejectReason(value: unknown): RejectReason | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !REJECT_REASONS.includes(value as RejectReason)) throw new AppError('VALIDATION_ERROR', 'Invalid reject reason', 400, { reason: String(value) })
  return value as RejectReason
}

function actorId(request: Request): string | null {
  const context = getAuthContext(request)
  return context ? String(context.claims.sub) : null
}

function paramId(request: Request): string {
  const rawId = request.params.id
  const id = typeof rawId === 'string' ? rawId : rawId?.[0]
  if (!id) throw new AppError('VALIDATION_ERROR', 'recommendation id is required', 400)
  return id
}

function stringParam(request: Request, key: string): string | null {
  const value = request.query[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberParam(request: Request, key: string): number | null {
  const raw = stringParam(request, key)
  if (raw === null) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) throw new AppError('VALIDATION_ERROR', `${key} must be a number`, 400, { [key]: raw })
  return parsed
}

function queryStoreId(request: Request): StoreId {
  const value = request.query.storeId ?? (typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>).storeId : undefined)
  if (typeof value !== 'string' || value.trim().length === 0) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400)
  return storeId(value)
}

function requestIdFrom(request: Request) { return requestId(request.header('x-request-id') || randomUUID()) }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
