import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { AppError, requestId, storeId, success } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { AGENT_DESCRIPTIONS, AGENT_IDS, calculateStoreHealth, ruleCatalog } from '@profitpilot/ai'
import type { AgentId, AgentSettingsRepository, CalibrationLedger, CostBreakdownRow, CostEntry, CostRecordInput, CostSummary, DecisionEngine, RecommendationRepository, RunProgressEvent } from '@profitpilot/ai'
import { agentAccess, agentsForPlan, assertAgentAccess } from '@profitpilot/billing'

export type AiRouteDependencies = Readonly<{
  engine: Pick<DecisionEngine, 'statuses'> & Partial<Pick<DecisionEngine, 'run' | 'cacheHits'>>
  recommendations: RecommendationRepository
  costs: Readonly<{ summary(storeId: StoreId): CostSummary | Promise<CostSummary>; record(input: CostRecordInput): CostEntry | Promise<CostEntry>; breakdown?(storeId: StoreId): readonly CostBreakdownRow[] | Promise<readonly CostBreakdownRow[]> }>
  snapshot?: (storeId: StoreId) => Promise<import('@profitpilot/ai').StoreSnapshot>
  /** Resolves the billing plan tier for a store. Absent ⇒ every agent unlocked (backward compatible). */
  plan?: (storeId: StoreId) => Promise<PlanTier>
  settings?: AgentSettingsRepository
  calibration?: Pick<CalibrationLedger, 'recordDecision'>
}>

export type AgentOverviewEntry = Readonly<{
  id: AgentId
  label: string
  promptVersion: string
  execution: 'READY' | 'UNCONFIGURED' | 'RUNNING' | 'PAUSED'
  languageOnly: true
  locked: boolean
  requiredPlan: PlanTier
  paused: boolean
  tagline: string
  sampleInsight: string
}>
export type AgentOverview = Readonly<{ plan: PlanTier; unlockedCount: number; totalCount: number; agents: readonly AgentOverviewEntry[] }>

export function createAiRouter(dependencies: AiRouteDependencies): Router {
  const router = Router()

  router.get('/ai/agents', async (request, response, next) => {
    try {
      const tenant = optionalStoreId(request)
      // Without a tenant this stays the legacy global status contract.
      if (!tenant) { response.status(200).json(success(dependencies.engine.statuses(), requestIdFrom(request))); return }
      response.status(200).json(success(await agentOverview(dependencies, tenant), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/ai/rules', (request, response) => {
    response.status(200).json(success(ruleCatalog(), requestIdFrom(request)))
  })

  router.get('/ai/health', async (request, response, next) => {
    try {
      if (!dependencies.snapshot) throw new AppError('DEPENDENCY_ERROR', 'Store snapshots are not configured', 503)
      const tenant = queryStoreId(request)
      const snapshot = await dependencies.snapshot(tenant)
      response.status(200).json(success(calculateStoreHealth(snapshot), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/ai/cost', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      response.status(200).json(success(await Promise.resolve(dependencies.costs.summary(tenant)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/ai/cost/breakdown', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const breakdown = dependencies.costs.breakdown ? await Promise.resolve(dependencies.costs.breakdown(tenant)) : []
      response.status(200).json(success(breakdown, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/ai/agents/:agentId/activity', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const agent = agentIdParam(request)
      const recommendations = await dependencies.recommendations.listByAgent(tenant, agent, 20)
      response.status(200).json(success(recommendations, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.patch('/ai/agents/:agentId', async (request, response, next) => {
    try {
      if (!dependencies.settings) throw new AppError('DEPENDENCY_ERROR', 'Agent settings are not configured', 503)
      const tenant = queryStoreId(request)
      const agent = agentIdParam(request)
      await assertUnlocked(dependencies, tenant, agent)
      const body = request.body as unknown
      if (!isRecord(body) || typeof body.paused !== 'boolean') throw new AppError('VALIDATION_ERROR', 'paused must be a boolean', 400)
      const settings = await dependencies.settings.setPaused(tenant, agent, body.paused)
      response.status(200).json(success(settings, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/ai/agents/:agentId/run', async (request, response, next) => {
    try {
      if (!('run' in dependencies.engine) || typeof dependencies.engine.run !== 'function' || !dependencies.snapshot) throw new AppError('DEPENDENCY_ERROR', 'Recommendation analysis is not configured', 503)
      const tenant = queryStoreId(request)
      const agent = agentIdParam(request)
      await assertUnlocked(dependencies, tenant, agent)
      await assertNotPaused(dependencies, tenant, agent)
      const snapshot = await dependencies.snapshot(tenant)
      const result = await dependencies.engine.run(snapshot, { agents: [agent] })
      response.status(200).json(success(result, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/ai/run-all', async (request, response, next) => {
    try {
      if (!('run' in dependencies.engine) || typeof dependencies.engine.run !== 'function' || !dependencies.snapshot) throw new AppError('DEPENDENCY_ERROR', 'Recommendation analysis is not configured', 503)
      const tenant = queryStoreId(request)
      const plan = await resolvePlan(dependencies, tenant)
      const paused = dependencies.settings ? await dependencies.settings.forStore(tenant) : new Map()
      const unlocked = AGENT_IDS.filter((agent) => agentAccess(plan, agent).allowed)
      const runnable = unlocked.filter((agent) => paused.get(agent)?.paused !== true)
      const skipped = AGENT_IDS.filter((agent) => !runnable.includes(agent)).map((agent) => ({ agent, reason: unlocked.includes(agent) ? 'PAUSED' : 'LOCKED' }))
      // Server-sent events over the same connection; the client streams frames.
      response.status(200)
      response.setHeader('content-type', 'text/event-stream')
      response.setHeader('cache-control', 'no-cache')
      response.setHeader('connection', 'keep-alive')
      response.flushHeaders?.()
      const send = (event: string, data: unknown): void => { response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
      send('start', { plan, runnable, skipped, requestId: requestIdFrom(request) })
      try {
        const snapshot = await dependencies.snapshot(tenant)
        const result = await dependencies.engine.run(snapshot, {
          agents: runnable,
          onProgress: (progress: RunProgressEvent) => send('progress', progress),
        })
        send('done', { recommendations: result.recommendations.length, deduplicated: result.deduplicated, cacheHits: result.cacheHits, health: result.health, generatedAt: result.generatedAt })
      } catch (error: unknown) {
        send('error', { message: error instanceof Error ? error.message : 'Run failed' })
      }
      response.end()
    } catch (error: unknown) { next(error) }
  })

  router.get('/recommendations', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      response.status(200).json(success(await dependencies.recommendations.list(tenant), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/recommendations/analyze', async (request, response, next) => {
    try {
      if (!('run' in dependencies.engine) || typeof dependencies.engine.run !== 'function' || !dependencies.snapshot) throw new AppError('DEPENDENCY_ERROR', 'Recommendation analysis is not configured', 503)
      const tenant = queryStoreId(request)
      const plan = await resolvePlan(dependencies, tenant)
      const unlocked = AGENT_IDS.filter((agent) => agentAccess(plan, agent).allowed)
      const snapshot = await dependencies.snapshot(tenant)
      const result = await dependencies.engine.run(snapshot, { agents: unlocked })
      response.status(200).json(success(result, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/recommendations/:id/approve', async (request, response, next) => {
    await decide(request, response, next, dependencies, 'APPROVED')
  })

  router.post('/recommendations/:id/reject', async (request, response, next) => {
    await decide(request, response, next, dependencies, 'REJECTED')
  })

  return router
}

async function agentOverview(dependencies: AiRouteDependencies, tenant: StoreId): Promise<AgentOverview> {
  const plan = await resolvePlan(dependencies, tenant)
  const settings = dependencies.settings ? await dependencies.settings.forStore(tenant) : new Map()
  const statuses = dependencies.engine.statuses()
  const agents = statuses.map((status) => {
    const access = agentAccess(plan, status.id)
    const paused = settings.get(status.id)?.paused === true
    return {
      id: status.id,
      label: status.label,
      promptVersion: status.promptVersion,
      execution: access.allowed ? (paused ? 'PAUSED' as const : status.execution) : 'PAUSED' as const,
      languageOnly: true as const,
      locked: !access.allowed,
      requiredPlan: access.requiredPlan,
      paused,
      tagline: AGENT_DESCRIPTIONS[status.id].tagline,
      sampleInsight: AGENT_DESCRIPTIONS[status.id].sampleInsight,
    }
  })
  return { plan, unlockedCount: agentsForPlan(plan).length, totalCount: statuses.length, agents }
}

async function resolvePlan(dependencies: AiRouteDependencies, tenant: StoreId): Promise<PlanTier> {
  if (!dependencies.plan) return 'commander'
  return dependencies.plan(tenant)
}

async function assertUnlocked(dependencies: AiRouteDependencies, tenant: StoreId, agent: AgentId): Promise<void> {
  const plan = await resolvePlan(dependencies, tenant)
  assertAgentAccess(plan, agent)
}

async function assertNotPaused(dependencies: AiRouteDependencies, tenant: StoreId, agent: AgentId): Promise<void> {
  if (!dependencies.settings) return
  const settings = await dependencies.settings.forStore(tenant)
  if (settings.get(agent)?.paused === true) throw new AppError('CONFLICT', 'This agent is paused. Resume it before running.', 409, { agent })
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
    // PR45: close the calibration loop — merchant decisions now teach the
    // per-agent confidence caps instead of evaporating.
    if (dependencies.calibration) {
      await dependencies.calibration.recordDecision(tenant, result.agent, result.id, status === 'APPROVED' ? 'accepted' : 'rejected').catch(() => undefined)
    }
    response.status(200).json(success(result, requestIdFrom(request)))
  } catch (error: unknown) { next(error) }
}

function agentIdParam(request: Request): AgentId {
  const raw = request.params.agentId
  const value = typeof raw === 'string' ? raw : raw?.[0]
  if (!value || !(AGENT_IDS as readonly string[]).includes(value)) throw new AppError('VALIDATION_ERROR', 'Unknown agent id', 400, { agentId: value ?? null })
  return value as AgentId
}

function queryStoreId(request: Request): StoreId {
  const value = request.query.storeId ?? (typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>).storeId : undefined)
  if (typeof value !== 'string' || value.trim().length === 0) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400)
  return storeId(value)
}

function optionalStoreId(request: Request): StoreId | null {
  const value = request.query.storeId
  return typeof value === 'string' && value.trim().length > 0 ? storeId(value) : null
}

function requestIdFrom(request: Request) { return requestId(request.header('x-request-id') || randomUUID()) }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
