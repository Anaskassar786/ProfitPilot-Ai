/**
 * PatternAI (formerly Insights Hub) — HTTP router.
 *
 * Every endpoint: tenant middleware (storeId), plan gating with 402
 * UPGRADE_REQUIRED + generic "Upgrade Plan" CTA, per-store rate limiting
 * (25 req/min), and the standard { ok, data, meta } response envelope.
 * Commander-only public API endpoints authenticate via Bearer API key and
 * enforce the hourly cap from INSIGHTS_HUB_API_RATE_LIMIT.
 *
 * Rebrand note: every route is served under BOTH `/patternai/*` (the new
 * canonical prefix) and the original `/insights/*` prefix, so existing
 * installations, bookmarks, and the public API keep working unchanged while
 * the product surface moves to PatternAI. Table names are untouched.
 */

import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request, Response } from 'express'
import { AppError, requestId, storeId as toStoreId, success } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import { COMPARISON_TYPES, DISCOVERY_CATEGORIES, DISCOVERY_STATUSES, INSIGHTS_HUB_DEFAULT_RATE_LIMIT, PATTERN_TYPES, PREDICTION_HORIZONS, insightsHubEnvConfig } from '@profitpilot/ai'
import type { ComparisonType, DiscoveryCategory, DiscoveryStatus, InsightsHubEnvConfig, KnowledgeEntryType, PredictionHorizon } from '@profitpilot/ai'
import { InsightsRateLimiter } from './insights-hub.js'
import type { InsightsHubService, InsightsPreferencesPatch } from './insights-hub.js'

export const KNOWLEDGE_ENTRY_TYPES = ['DISCOVERY', 'LESSON', 'NOTE', 'PATTERN', 'INVESTIGATION', 'CUSTOM'] as const

export type InsightsHubRouteDependencies = Readonly<{
  service: InsightsHubService
  env?: InsightsHubEnvConfig
  rateLimiter?: InsightsRateLimiter
}>

/** Canonical `/patternai/*` path plus the legacy `/insights/*` alias. */
export function patternAiPaths(suffix: string): string[] {
  return [`/patternai/${suffix}`, `/insights/${suffix}`]
}

export function createInsightsHubRouter(dependencies: InsightsHubRouteDependencies): Router {
  const router = Router()
  const env = dependencies.env ?? insightsHubEnvConfig(process.env)
  const limiter = dependencies.rateLimiter ?? new InsightsRateLimiter(env.rateLimitPerStore || INSIGHTS_HUB_DEFAULT_RATE_LIMIT)
  const service = dependencies.service

  /* ── shared plumbing ─────────────────────────────────────────────────── */

  const tenant = (request: Request): StoreId => {
    const value = request.query.storeId ?? (isRecord(request.body) ? request.body.storeId : undefined)
    if (typeof value !== 'string' || value.trim().length === 0) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400)
    return toStoreId(value)
  }

  const rateLimit = (request: Request): void => {
    if (!env.enabled) throw new AppError('DEPENDENCY_ERROR', 'PatternAI is disabled on this workspace (INSIGHTS_HUB_ENABLED=false).', 503)
    let store = 'anonymous'
    try { store = tenant(request) } catch { store = String(request.ip ?? 'anonymous') }
    const verdict = limiter.consume(store)
    if (!verdict.allowed) throw new AppError('RATE_LIMITED', `PatternAI rate limit reached. Retry in ${verdict.retryAfterSeconds}s.`, 429, { retryAfterSeconds: verdict.retryAfterSeconds, limitPerMinute: env.rateLimitPerStore })
  }

  const handle = (handler: (request: Request, response: Response) => Promise<void>) => async (request: Request, response: Response, next: (error: unknown) => void): Promise<void> => {
    try {
      rateLimit(request)
      await handler(request, response)
    } catch (error: unknown) { next(error) }
  }

  const send = (request: Request, response: Response, data: unknown, status = 200): void => {
    response.status(status).json(success(data, requestId(request.header('x-request-id') || randomUUID())))
  }

  const paramId = (request: Request): string => {
    const raw = request.params.id
    const id = typeof raw === 'string' ? raw : raw?.[0]
    if (!id || !/^[A-Za-z0-9_\-]{1,80}$/.test(id)) throw new AppError('VALIDATION_ERROR', 'a valid id is required', 400)
    return id
  }

  const limitParam = (request: Request, fallback: number, max = 100): number => {
    const raw = request.query.limit
    if (typeof raw !== 'string' || raw.trim() === '') return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 1) throw new AppError('VALIDATION_ERROR', 'limit must be a positive number', 400, { limit: raw })
    return Math.min(max, Math.floor(parsed))
  }

  const enumParam = <Value extends string>(request: Request, key: string, allowed: readonly Value[]): Value | null => {
    const raw = request.query[key]
    if (typeof raw !== 'string' || raw.trim() === '') return null
    const value = raw.trim()
    if (!(allowed as readonly string[]).includes(value)) throw new AppError('VALIDATION_ERROR', `invalid ${key}`, 400, { [key]: value, allowed: allowed.join(',') })
    return value as Value
  }

  const bodyRecord = (request: Request): Readonly<Record<string, unknown>> => {
    if (!isRecord(request.body)) throw new AppError('VALIDATION_ERROR', 'a JSON body is required', 400)
    return request.body
  }

  const bodyString = (request: Request, key: string, maxLength: number): string => {
    const body = bodyRecord(request)
    const value = body[key]
    if (typeof value !== 'string' || value.trim().length === 0) throw new AppError('VALIDATION_ERROR', `${key} is required`, 400, { field: key })
    if (value.length > maxLength) throw new AppError('VALIDATION_ERROR', `${key} is too long (max ${maxLength})`, 400, { field: key })
    return value.trim()
  }

  const bodyBoolean = (request: Request, key: string, fallback: boolean): boolean => {
    const body = bodyRecord(request)
    const value = body[key]
    if (value === undefined) return fallback
    if (typeof value !== 'boolean') throw new AppError('VALIDATION_ERROR', `${key} must be a boolean`, 400, { field: key })
    return value
  }

  const ratingBody = (request: Request): number => {
    const body = bodyRecord(request)
    const value = body.rating
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) throw new AppError('VALIDATION_ERROR', 'rating must be an integer 0-5', 400, { rating: String(value) })
    return value
  }

  /* ── Overview + usage ────────────────────────────────────────────────── */

  // Diagnostics first: `GET /patternai/health?storeId=…` reports which storage
  // sections answer and which do not. When a deploy is missing a migration the
  // answer is here in one request instead of buried in the platform logs.
  router.get(patternAiPaths('health'), async (request: Request, response: Response, next: (error: unknown) => void) => {
    try {
      send(request, response, await service.health(tenant(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get(patternAiPaths('overview'), handle(async (request, response) => {
    send(request, response, await service.overview(tenant(request)))
  }))

  router.get(patternAiPaths('usage'), handle(async (request, response) => {
    send(request, response, await service.usageSummary(tenant(request)))
  }))

  router.get(patternAiPaths('cost-summary'), handle(async (request, response) => {
    // The provider tier is :free — the honest cost summary states that, with
    // the model identity surfaced for the cost meter drawer.
    send(request, response, {
      storeId: tenant(request),
      dailyBudgetUsd: env.dailyBudgetUsd,
      estimatedCostUsd: 0,
      currency: 'USD',
      models: [...env.models],
      note: 'PatternAI runs on free-tier Nemotron models; the cost meter records calls with a $0 rate. Set INSIGHTS_HUB_DAILY_BUDGET_USD when switching to paid models.',
    })
  }))

  /* ── Discoveries ─────────────────────────────────────────────────────── */

  router.get(patternAiPaths('discoveries/feed'), handle(async (request, response) => {
    send(request, response, await service.discoveryFeed(tenant(request)))
  }))

  router.get(patternAiPaths('discoveries'), handle(async (request, response) => {
    const store = tenant(request)
    const status = enumParam(request, 'status', DISCOVERY_STATUSES)
    const category = enumParam(request, 'category', DISCOVERY_CATEGORIES)
    const cursorRaw = request.query.cursor
    const cursor = typeof cursorRaw === 'string' && Number.isFinite(Number(cursorRaw)) ? Math.max(0, Number(cursorRaw)) : 0
    send(request, response, { items: await service.listDiscoveries(store, { status: status ?? undefined, category: category ?? undefined, limit: limitParam(request, 20), cursor }) })
  }))

  router.post(patternAiPaths('discoveries/generate'), handle(async (request, response) => {
    send(request, response, await service.generateDiscoveriesForStore(tenant(request)), 201)
  }))

  router.get(patternAiPaths('discoveries/:id'), handle(async (request, response) => {
    send(request, response, await service.getDiscovery(tenant(request), paramId(request)))
  }))

  router.post(patternAiPaths('discoveries/:id/status'), handle(async (request, response) => {
    const body = bodyRecord(request)
    const status = body.status
    if (typeof status !== 'string' || !(DISCOVERY_STATUSES as readonly string[]).includes(status)) throw new AppError('VALIDATION_ERROR', `status must be one of ${DISCOVERY_STATUSES.join(', ')}`, 400, { status: String(status) })
    send(request, response, await service.setDiscoveryStatus(tenant(request), paramId(request), status as DiscoveryStatus))
  }))

  /* ── Lessons ─────────────────────────────────────────────────────────── */

  router.get(patternAiPaths('lessons/recommended'), handle(async (request, response) => {
    send(request, response, await service.recommendedLessons(tenant(request)))
  }))

  router.get(patternAiPaths('lessons'), handle(async (request, response) => {
    const category = enumParam(request, 'category', DISCOVERY_CATEGORIES)
    send(request, response, { items: await service.listLessons(tenant(request), category) })
  }))

  router.post(patternAiPaths('lessons/generate'), handle(async (request, response) => {
    const body = bodyRecord(request)
    const category = typeof body.category === 'string' && (DISCOVERY_CATEGORIES as readonly string[]).includes(body.category) ? (body.category as DiscoveryCategory) : null
    if (body.category !== undefined && category === null) throw new AppError('VALIDATION_ERROR', `category must be one of ${DISCOVERY_CATEGORIES.join(', ')}`, 400, { category: String(body.category) })
    send(request, response, await service.generateLessons(tenant(request), category), 201)
  }))

  router.get(patternAiPaths('lessons/:id'), handle(async (request, response) => {
    send(request, response, await service.getLesson(tenant(request), paramId(request)))
  }))

  router.post(patternAiPaths('lessons/:id/read'), handle(async (request, response) => {
    send(request, response, await service.markLessonRead(tenant(request), paramId(request)))
  }))

  router.post(patternAiPaths('lessons/:id/rate'), handle(async (request, response) => {
    send(request, response, await service.rateLesson(tenant(request), paramId(request), ratingBody(request)))
  }))

  router.post(patternAiPaths('lessons/:id/bookmark'), handle(async (request, response) => {
    send(request, response, await service.bookmarkLesson(tenant(request), paramId(request), bodyBoolean(request, 'bookmarked', true)))
  }))

  /* ── Patterns ────────────────────────────────────────────────────────── */

  router.get(patternAiPaths('patterns'), handle(async (request, response) => {
    const type = enumParam(request, 'type', PATTERN_TYPES)
    send(request, response, await service.listPatterns(tenant(request), type))
  }))

  router.post(patternAiPaths('patterns/detect'), handle(async (request, response) => {
    send(request, response, await service.detectPatternsForStore(tenant(request)), 201)
  }))

  router.get(patternAiPaths('patterns/:id'), handle(async (request, response) => {
    send(request, response, await service.getPattern(tenant(request), paramId(request)))
  }))

  router.post(patternAiPaths('patterns/:id/alert'), handle(async (request, response) => {
    send(request, response, await service.setPatternAlerts(tenant(request), paramId(request), bodyBoolean(request, 'enabled', true)))
  }))

  router.delete(patternAiPaths('patterns/:id'), handle(async (request, response) => {
    await service.invalidatePattern(tenant(request), paramId(request))
    send(request, response, { invalidated: true })
  }))

  /* ── Personas ────────────────────────────────────────────────────────── */

  router.get(patternAiPaths('personas'), handle(async (request, response) => {
    send(request, response, await service.listPersonas(tenant(request)))
  }))

  router.post(patternAiPaths('personas/generate'), handle(async (request, response) => {
    send(request, response, await service.generatePersonas(tenant(request)), 201)
  }))

  router.get(patternAiPaths('personas/:id'), handle(async (request, response) => {
    send(request, response, await service.getPersona(tenant(request), paramId(request)))
  }))

  router.get(patternAiPaths('personas/:id/customers'), handle(async (request, response) => {
    send(request, response, await service.personaCustomers(tenant(request), paramId(request)))
  }))

  /* ── Why? investigations ─────────────────────────────────────────────── */

  router.post(patternAiPaths('investigations'), handle(async (request, response) => {
    const question = bodyString(request, 'question', 400)
    send(request, response, await service.investigateQuestion(tenant(request), question), 201)
  }))

  router.get(patternAiPaths('investigations'), handle(async (request, response) => {
    send(request, response, { items: await service.listInvestigations(tenant(request), limitParam(request, 20)) })
  }))

  router.get(patternAiPaths('investigations/:id'), handle(async (request, response) => {
    send(request, response, await service.getInvestigation(tenant(request), paramId(request)))
  }))

  router.post(patternAiPaths('investigations/:id/rate'), handle(async (request, response) => {
    send(request, response, await service.rateInvestigation(tenant(request), paramId(request), ratingBody(request)))
  }))

  /* ── Trends ──────────────────────────────────────────────────────────── */

  router.get(patternAiPaths('trends/business'), handle(async (request, response) => {
    send(request, response, await service.listTrends(tenant(request), 'business'))
  }))

  router.get(patternAiPaths('trends/market'), handle(async (request, response) => {
    send(request, response, await service.marketTrends(tenant(request)))
  }))

  router.get(patternAiPaths('trends'), handle(async (request, response) => {
    const type = typeof request.query.type === 'string' ? request.query.type : 'all'
    if (!['all', 'BUSINESS', 'MARKET', 'EMERGING', 'DECLINING'].includes(type)) throw new AppError('VALIDATION_ERROR', 'invalid trend type', 400, { type })
    send(request, response, await service.listTrends(tenant(request), type))
  }))

  router.post(patternAiPaths('trends/:id/alert'), handle(async (request, response) => {
    send(request, response, await service.setTrendAlerts(tenant(request), paramId(request), bodyBoolean(request, 'enabled', true)))
  }))

  /* ── Comparisons ─────────────────────────────────────────────────────── */

  router.post(patternAiPaths('comparisons'), handle(async (request, response) => {
    const body = bodyRecord(request)
    const type = body.comparisonType
    if (typeof type !== 'string' || !(COMPARISON_TYPES as readonly string[]).includes(type)) throw new AppError('VALIDATION_ERROR', `comparisonType must be one of ${COMPARISON_TYPES.join(', ')}`, 400, { comparisonType: String(type) })
    const subjectA = bodyString(request, 'subjectA', 160)
    const subjectB = bodyString(request, 'subjectB', 160)
    send(request, response, await service.createComparison(tenant(request), type as ComparisonType, subjectA, subjectB), 201)
  }))

  router.get(patternAiPaths('comparisons'), handle(async (request, response) => {
    const type = enumParam(request, 'type', COMPARISON_TYPES)
    send(request, response, { items: await service.listComparisons(tenant(request), type, limitParam(request, 20)) })
  }))

  router.get(patternAiPaths('comparisons/:id'), handle(async (request, response) => {
    send(request, response, await service.getComparison(tenant(request), paramId(request)))
  }))

  router.delete(patternAiPaths('comparisons/:id'), handle(async (request, response) => {
    await service.deleteComparison(tenant(request), paramId(request))
    send(request, response, { deleted: true })
  }))

  /* ── Knowledge base ──────────────────────────────────────────────────── */

  router.post(patternAiPaths('knowledge/search'), handle(async (request, response) => {
    const store = tenant(request)
    const q = bodyString(request, 'q', 200)
    send(request, response, { items: await service.listKnowledge(store, { limit: 50 }, q) })
  }))

  router.get(patternAiPaths('knowledge'), handle(async (request, response) => {
    const entryType = enumParam(request, 'type', KNOWLEDGE_ENTRY_TYPES)
    const tag = typeof request.query.tag === 'string' && request.query.tag.trim() ? request.query.tag.trim() : undefined
    send(request, response, { items: await service.listKnowledge(tenant(request), { entryType: entryType ?? undefined, tag, limit: limitParam(request, 50) }, null) })
  }))

  router.post(patternAiPaths('knowledge'), handle(async (request, response) => {
    const body = bodyRecord(request)
    const entryType = body.entryType ?? 'NOTE'
    if (typeof entryType !== 'string' || !(KNOWLEDGE_ENTRY_TYPES as readonly string[]).includes(entryType)) throw new AppError('VALIDATION_ERROR', `entryType must be one of ${KNOWLEDGE_ENTRY_TYPES.join(', ')}`, 400, { entryType: String(entryType) })
    const title = bodyString(request, 'title', 180)
    const content = typeof body.contentMarkdown === 'string' ? body.contentMarkdown : ''
    const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 8) : undefined
    const linked = Array.isArray(body.linkedInsights) ? body.linkedInsights.filter((id): id is string => typeof id === 'string').slice(0, 20) : undefined
    send(request, response, await service.createKnowledge(tenant(request), { entryType: entryType as KnowledgeEntryType, title, contentMarkdown: content, ...(tags ? { tags } : {}), ...(linked ? { linkedInsights: linked } : {}) }), 201)
  }))

  router.get(patternAiPaths('knowledge/:id'), handle(async (request, response) => {
    send(request, response, await service.getKnowledge(tenant(request), paramId(request)))
  }))

  router.patch(patternAiPaths('knowledge/:id'), handle(async (request, response) => {
    const body = bodyRecord(request)
    const patch: { title?: string; contentMarkdown?: string; tags?: readonly string[] } = {}
    if (body.title !== undefined) patch.title = bodyString(request, 'title', 180)
    if (body.contentMarkdown !== undefined) {
      if (typeof body.contentMarkdown !== 'string') throw new AppError('VALIDATION_ERROR', 'contentMarkdown must be a string', 400)
      patch.contentMarkdown = body.contentMarkdown
    }
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags) || !body.tags.every((tag) => typeof tag === 'string')) throw new AppError('VALIDATION_ERROR', 'tags must be a string array', 400)
      patch.tags = (body.tags as readonly string[]).slice(0, 8)
    }
    send(request, response, await service.updateKnowledge(tenant(request), paramId(request), patch))
  }))

  router.delete(patternAiPaths('knowledge/:id'), handle(async (request, response) => {
    await service.deleteKnowledge(tenant(request), paramId(request))
    send(request, response, { deleted: true })
  }))

  /* ── Timeline ────────────────────────────────────────────────────────── */

  const TIMELINE_TYPES = ['DISCOVERY', 'LESSON', 'PATTERN', 'PERSONA', 'INVESTIGATION', 'TREND', 'COMPARISON', 'PREDICTION'] as const

  const timelineHandler = async (request: Request, response: Response, types: readonly string[] | null): Promise<void> => {
    const daysRaw = request.query.days
    let days: number | null = null
    if (typeof daysRaw === 'string' && daysRaw.trim() !== '') {
      const parsed = Number(daysRaw)
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3650) throw new AppError('VALIDATION_ERROR', 'days must be between 1 and 3650', 400, { days: daysRaw })
      days = Math.floor(parsed)
    }
    send(request, response, await service.timeline(tenant(request), days, types))
  }

  router.get(patternAiPaths('timeline/filter'), handle(async (request, response) => {
    const type = enumParam(request, 'type', TIMELINE_TYPES)
    await timelineHandler(request, response, type ? [type] : null)
  }))

  router.get(patternAiPaths('timeline'), handle(async (request, response) => {
    await timelineHandler(request, response, null)
  }))

  /* ── Predictions ─────────────────────────────────────────────────────── */

  router.get(patternAiPaths('predictions'), handle(async (request, response) => {
    const horizon = enumParam(request, 'horizon', PREDICTION_HORIZONS)
    send(request, response, await service.listPredictions(tenant(request), horizon))
  }))

  router.post(patternAiPaths('predictions/generate'), handle(async (request, response) => {
    send(request, response, await service.generatePredictions(tenant(request)), 201)
  }))

  router.get(patternAiPaths('predictions/:id'), handle(async (request, response) => {
    send(request, response, await service.getPrediction(tenant(request), paramId(request)))
  }))

  router.post(patternAiPaths('predictions/:id/validate'), handle(async (request, response) => {
    const body = bodyRecord(request)
    const actual = body.actualValue
    if (typeof actual !== 'number' || !Number.isFinite(actual)) throw new AppError('VALIDATION_ERROR', 'actualValue must be a number', 400, { actualValue: String(actual) })
    send(request, response, await service.validatePredictionAccuracy(tenant(request), paramId(request), actual))
  }))

  /* ── Preferences ─────────────────────────────────────────────────────── */

  router.get(patternAiPaths('preferences'), handle(async (request, response) => {
    send(request, response, await service.preferences(tenant(request)))
  }))

  router.patch(patternAiPaths('preferences'), handle(async (request, response) => {
    const body = bodyRecord(request)
    const patch: InsightsPreferencesPatch = {}
    if (body.autoDiscoveryEnabled !== undefined) {
      if (typeof body.autoDiscoveryEnabled !== 'boolean') throw new AppError('VALIDATION_ERROR', 'autoDiscoveryEnabled must be a boolean', 400)
      patch.autoDiscoveryEnabled = body.autoDiscoveryEnabled
    }
    if (body.discoveryFrequency !== undefined) {
      if (!['REALTIME', 'DAILY', 'WEEKLY'].includes(String(body.discoveryFrequency))) throw new AppError('VALIDATION_ERROR', 'discoveryFrequency must be REALTIME, DAILY, or WEEKLY', 400)
      patch.discoveryFrequency = body.discoveryFrequency as 'REALTIME' | 'DAILY' | 'WEEKLY'
    }
    if (body.discoveryCategories !== undefined) {
      if (!Array.isArray(body.discoveryCategories) || !body.discoveryCategories.every((category) => (DISCOVERY_CATEGORIES as readonly string[]).includes(String(category)))) throw new AppError('VALIDATION_ERROR', `discoveryCategories must be a subset of ${DISCOVERY_CATEGORIES.join(', ')}`, 400)
      patch.discoveryCategories = body.discoveryCategories as readonly DiscoveryCategory[]
    }
    if (body.notificationPreferences !== undefined) {
      if (!isRecord(body.notificationPreferences)) throw new AppError('VALIDATION_ERROR', 'notificationPreferences must be an object', 400)
      const prefs: Record<string, boolean> = {}
      for (const key of ['highConfidenceDiscoveries', 'trendAlerts', 'weeklyDigest', 'anomalyAlerts'] as const) {
        const value = body.notificationPreferences[key]
        if (value !== undefined) {
          if (typeof value !== 'boolean') throw new AppError('VALIDATION_ERROR', `${key} must be a boolean`, 400)
          prefs[key] = value
        }
      }
      patch.notificationPreferences = prefs
    }
    if (body.trendMonitoringEnabled !== undefined) {
      if (typeof body.trendMonitoringEnabled !== 'boolean') throw new AppError('VALIDATION_ERROR', 'trendMonitoringEnabled must be a boolean', 400)
      patch.trendMonitoringEnabled = body.trendMonitoringEnabled
    }
    if (body.personaUpdatesEnabled !== undefined) {
      if (typeof body.personaUpdatesEnabled !== 'boolean') throw new AppError('VALIDATION_ERROR', 'personaUpdatesEnabled must be a boolean', 400)
      patch.personaUpdatesEnabled = body.personaUpdatesEnabled
    }
    if (body.language !== undefined) patch.language = body.language as 'en' | 'hi'
    send(request, response, await service.updatePreferences(tenant(request), patch))
  }))

  /* ── API access management (Commander) ───────────────────────────────── */

  router.post(patternAiPaths('api-access/generate-key'), handle(async (request, response) => {
    send(request, response, await service.generateApiKey(tenant(request)), 201)
  }))

  router.post(patternAiPaths('api-access/regenerate'), handle(async (request, response) => {
    // Regeneration issues a fresh key; the old key stops resolving instantly.
    send(request, response, await service.generateApiKey(tenant(request)), 201)
  }))

  router.get(patternAiPaths('api-access/key'), handle(async (request, response) => {
    const status = await service.apiAccessStatus(tenant(request))
    send(request, response, { maskedKey: status.maskedKey, enabled: status.enabled, plan: status.plan, rateLimitPerHour: status.rateLimitPerHour })
  }))

  router.get(patternAiPaths('api-access/usage'), handle(async (request, response) => {
    send(request, response, await service.apiAccessStatus(tenant(request)))
  }))

  router.get(patternAiPaths('api-access/documentation'), handle(async (request, response) => {
    send(request, response, {
      specUrl: '/public-api/insights/openapi.json',
      guideUrl: '/legal/docs/patternai-api',
      docsFile: 'docs/PATTERN_AI.md#public-api-commander',
      authentication: 'Authorization: Bearer ihk_<key>',
      rateLimit: { perHour: env.apiRateLimit, perDay: env.apiRateLimit * 10 },
      endpoints: ['/public-api/insights/discoveries', '/public-api/insights/patterns', '/public-api/insights/personas', '/public-api/insights/predictions', '/public-api/insights/trends'],
    })
  }))

  /* ── Public API (Commander, Bearer key auth) ─────────────────────────── */

  const publicApi = (endpoint: string, handler: (store: StoreId, request: Request) => Promise<unknown>) => async (request: Request, response: Response, next: (error: unknown) => void): Promise<void> => {
    try {
      const authorization = request.header('authorization') ?? ''
      const key = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
      if (!key) throw new AppError('UNAUTHORIZED', 'Missing PatternAI API key. Use Authorization: Bearer ihk_<key>', 401)
      const store = await service.authenticatePublicApi(key, endpoint)
      send(request, response, await handler(store, request))
    } catch (error: unknown) { next(error) }
  }

  router.get('/public-api/insights/openapi.json', async (request, response) => {
    send(request, response, insightsOpenApiSpec(env))
  })

  router.get('/public-api/insights/discoveries', publicApi('/public-api/insights/discoveries', async (store, request) => {
    const status = enumParam(request, 'status', DISCOVERY_STATUSES)
    return { items: await service.listDiscoveries(store, { status: status ?? undefined, limit: limitParam(request, 50), cursor: 0 }) }
  }))

  router.get('/public-api/insights/patterns', publicApi('/public-api/insights/patterns', async (store) => {
    return service.listPatterns(store, null)
  }))

  router.get('/public-api/insights/personas', publicApi('/public-api/insights/personas', async (store) => {
    return service.listPersonas(store)
  }))

  router.get('/public-api/insights/predictions', publicApi('/public-api/insights/predictions', async (store) => {
    return service.listPredictions(store, null)
  }))

  router.get('/public-api/insights/trends', publicApi('/public-api/insights/trends', async (store) => {
    return service.listTrends(store, 'all')
  }))

  /* ── Auto-discovery trigger (worker / scheduler) ─────────────────────── */

  router.post(patternAiPaths('auto-discovery/run'), handle(async (request, response) => {
    // Used by the worker sweep (Part 4): runs the daily pipeline when due.
    const store = tenant(request)
    const result = await service.generateDiscoveriesForStore(store)
    send(request, response, result, 201)
  }))

  return router
}

/** OpenAPI 3.1 description of the Commander public API. */
export function insightsOpenApiSpec(env: InsightsHubEnvConfig): Readonly<Record<string, unknown>> {
  const discoverySchema = { type: 'object', properties: { id: { type: 'string' }, discoveryType: { type: 'string', enum: ['PATTERN', 'ANOMALY', 'OPPORTUNITY', 'CORRELATION', 'TREND', 'SEGMENT', 'BEHAVIOR'] }, category: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, confidenceScore: { type: 'number' }, impactEstimate: { type: ['number', 'null'] }, discoveredAt: { type: 'string', format: 'date-time' }, status: { type: 'string' } } }
  const security = [{ bearerAuth: [] }]
  const envelope = (schema: unknown) => ({ type: 'object', properties: { ok: { type: 'boolean' }, data: schema, meta: { type: 'object' } } })
  const listPath = (name: string, schema: unknown, description: string) => ({
    get: {
      operationId: `listInsights${name}`,
      summary: description,
      tags: ['PatternAI'],
      security,
      responses: {
        '200': { description: 'Successful response', content: { 'application/json': { schema: envelope(schema) } } },
        '401': { description: 'Missing or invalid API key' },
        '429': { description: `Rate limited (${env.apiRateLimit} requests/hour)` },
      },
    },
  })
  return {
    openapi: '3.1.0',
    info: { title: 'ProfitPilot PatternAI Public API', version: '1.0.0', description: 'Commander-tier programmatic access to AI discoveries, patterns, personas, predictions, and trends. All data is computed from the merchant’s real synced store data.' },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'PatternAI API key (ihk_...) generated in PatternAI → API access' } },
      schemas: { Discovery: discoverySchema },
    },
    paths: {
      '/public-api/insights/discoveries': listPath('Discoveries', { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Discovery' } } } }, 'Fetch AI discoveries computed from store data'),
      '/public-api/insights/patterns': listPath('Patterns', { type: 'object' }, 'Fetch recognized patterns'),
      '/public-api/insights/personas': listPath('Personas', { type: 'object' }, 'Fetch customer psychology personas'),
      '/public-api/insights/predictions': listPath('Predictions', { type: 'object' }, 'Fetch predictive insights'),
      '/public-api/insights/trends': listPath('Trends', { type: 'object' }, 'Fetch business and market trends'),
    },
    'x-rate-limit': { perHour: env.apiRateLimit, perDay: env.apiRateLimit * 10 },
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
