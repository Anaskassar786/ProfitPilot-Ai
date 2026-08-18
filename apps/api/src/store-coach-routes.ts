import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { AppError, requestId, success } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { CoachGoalRecord, CoachPreferences } from './store-coach-repositories.js'
import type { StoreCoachService } from './store-coach-service.js'

/**
 * PR #48 — Store Coach HTTP endpoints. Thin wrappers over StoreCoachService:
 * tenant resolution, input validation, plan gating (402 UPGRADE_REQUIRED),
 * and the standard { ok, data, requestId } response envelope. Chat streams
 * over SSE because the spec requires real-time token delivery.
 */

export type StoreCoachRouteDependencies = Readonly<{
  service: StoreCoachService
}>

export function createStoreCoachRouter(dependencies: StoreCoachRouteDependencies): Router {
  const router = Router()
  const service = dependencies.service

  // ---- Daily huddle ----
  router.get('/store-coach/huddle/today', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.todayHuddle(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/huddle/history', async (request, response, next) => {
    try {
      const days = positiveInt(request.query.days, 30)
      response.status(200).json(success(await service.huddleHistory(queryStoreId(request), days), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.post('/store-coach/huddle/:id/viewed', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.markHuddleViewed(queryStoreId(request), param(request, 'id')), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.post('/store-coach/huddle/generate', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.generateHuddle(queryStoreId(request), true), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // ---- Priorities ----
  router.get('/store-coach/priorities/today', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.todayPriorities(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.post('/store-coach/priorities/:id/complete', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.completePriority(queryStoreId(request), param(request, 'id')), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.post('/store-coach/priorities/:id/dismiss', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.dismissPriority(queryStoreId(request), param(request, 'id')), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.post('/store-coach/priorities/generate', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.generatePriorities(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // ---- Goals ----
  router.get('/store-coach/goals', async (request, response, next) => {
    try {
      const status = typeof request.query.status === 'string' && request.query.status.trim() ? request.query.status.toUpperCase() as CoachGoalRecord['status'] : undefined
      response.status(200).json(success(await service.listGoals(queryStoreId(request), status), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.post('/store-coach/goals', async (request, response, next) => {
    try {
      response.status(201).json(success(await service.createGoal(queryStoreId(request), goalInput(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.patch('/store-coach/goals/:id', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.updateGoal(queryStoreId(request), param(request, 'id'), goalPatch(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.delete('/store-coach/goals/:id', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.deleteGoal(queryStoreId(request), param(request, 'id')), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/goals/suggestions', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.suggestGoals(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  // Accepts an AI suggestion by its catalog position: the body echoes the
  // suggestion JSON returned by GET /store-coach/goals/suggestions so the
  // created goal is always grounded in the same validated payload.
  router.post('/store-coach/goals/:id/accept-suggestion', async (request, response, next) => {
    try {
      void param(request, 'id')
      const body = asRecord(request.body)
      const suggestion = asRecord(body.suggestion)
      const title = String(suggestion.title ?? '').trim()
      if (!title) throw new AppError('VALIDATION_ERROR', 'The suggestion body is required (title, metric, target_value)', 400)
      const goal = await service.acceptGoalSuggestion(queryStoreId(request), {
        title,
        description: String(suggestion.description ?? '').trim(),
        metric: String(suggestion.metric ?? 'REVENUE').toUpperCase() as CoachGoalRecord['metric'],
        targetValue: Number(suggestion.targetValue ?? suggestion.target_value ?? 0),
        currency: String(suggestion.currency ?? 'USD').toUpperCase(),
        feasibility: String(suggestion.feasibility ?? 'MEDIUM').toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW',
        rationale: String(suggestion.rationale ?? ''),
      }, typeof body.startDate === 'string' && body.startDate ? body.startDate : new Date().toISOString().slice(0, 10))
      response.status(201).json(success(goal, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/goals/:id/progress', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.goalProgress(queryStoreId(request), param(request, 'id')), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // ---- Achievements + streak ----
  router.get('/store-coach/achievements', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.earnedAchievements(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/achievements/available', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.availableAchievements(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/streak', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.streak(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // ---- Progress dashboard ----
  router.get('/store-coach/progress/summary', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.progressSummary(queryStoreId(request), positiveInt(request.query.days, 30)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/progress/trends', async (request, response, next) => {
    try {
      const metric = typeof request.query.metric === 'string' && request.query.metric.trim() ? request.query.metric.toLowerCase() : 'revenue'
      response.status(200).json(success(await service.progressTrends(queryStoreId(request), metric, positiveInt(request.query.days, 90)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/progress/heatmap', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.activityHeatmap(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/progress/comparisons', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.progressComparisons(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // ---- Chat (SSE) ----
  router.post('/store-coach/chat', async (request, response, next) => {
    try {
      const tenant = queryStoreId(request)
      const body = asRecord(request.body)
      const message = typeof body.message === 'string' ? body.message : ''
      response.status(200)
      response.setHeader('content-type', 'text/event-stream; charset=utf-8')
      response.setHeader('cache-control', 'no-cache, no-transform')
      response.setHeader('connection', 'keep-alive')
      response.setHeader('x-accel-buffering', 'no')
      response.flushHeaders?.()
      const send = (payload: unknown): void => {
        response.write(`data: ${JSON.stringify(payload)}\n\n`)
      }
      try {
        const coachMessage = await service.streamChat(tenant, message, (fullText) => send({ type: 'delta', text: fullText }))
        send({ type: 'done', message: coachMessage })
      } catch (streamError: unknown) {
        const appError = streamError instanceof AppError ? streamError : new AppError('INTERNAL_ERROR', 'Chat stream failed', 500, {}, false)
        send({ type: 'error', code: appError.code, message: appError.message, status: appError.status, details: appError.details })
      }
      response.end()
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/chat/history', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.chatHistory(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.post('/store-coach/chat/clear', async (request, response, next) => {
    try {
      await service.clearChat(queryStoreId(request))
      response.status(200).json(success({ cleared: true }, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/chat/suggestions', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.chatSuggestions(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // ---- Weekly review ----
  router.get('/store-coach/review/current', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.currentReview(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/review/history', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.reviewHistory(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.post('/store-coach/review/generate', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.generateReview(queryStoreId(request), true), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/review/:id/pdf', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.reviewPdf(queryStoreId(request), param(request, 'id')), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.post('/store-coach/review/:id/email', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.emailReview(queryStoreId(request), param(request, 'id')), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // ---- Preferences ----
  router.get('/store-coach/preferences', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.preferences(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.patch('/store-coach/preferences', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.updatePreferences(queryStoreId(request), preferencePatch(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // ---- Health score ----
  router.get('/store-coach/health-score', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.healthScore(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // ---- Onboarding ----
  router.get('/store-coach/onboarding/status', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.onboardingStatus(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.post('/store-coach/onboarding/complete-step', async (request, response, next) => {
    try {
      const step = Number(asRecord(request.body).step)
      if (!Number.isInteger(step) || step < 1 || step > 5) throw new AppError('VALIDATION_ERROR', 'step must be an integer between 1 and 5', 400)
      response.status(200).json(success(await service.completeOnboardingStep(queryStoreId(request), step), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.post('/store-coach/onboarding/skip', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.skipOnboarding(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  // ---- Usage + cost ----
  router.get('/store-coach/usage', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.usage(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })
  router.get('/store-coach/cost-summary', async (request, response, next) => {
    try {
      response.status(200).json(success(await service.costSummary(queryStoreId(request)), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  return router
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function queryStoreId(request: Request): StoreId {
  const value = typeof request.query.storeId === 'string' && request.query.storeId.trim() ? request.query.storeId : ''
  if (!value) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400)
  return value as StoreId
}

function requestIdFrom(request: Request): import('@profitpilot/types').RequestId {
  return requestId(String(request.header('x-request-id') ?? `store-coach-${Date.now()}`))
}

function param(request: Request, name: string): string {
  const value = request.params[name]
  if (typeof value !== 'string' || value.trim() === '') throw new AppError('VALIDATION_ERROR', `:${name} is required`, 400)
  return value
}

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 365) : fallback
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : {}
}

function goalInput(request: Request): Readonly<{ goalType: CoachGoalRecord['goalType']; title: string; description: string; metric: CoachGoalRecord['metric']; targetValue: number; targetCurrency: string; startDate: string; endDate: string }> {
  const body = asRecord(request.body)
  const goalType = String(body.goalType ?? 'WEEKLY').toUpperCase()
  if (!['WEEKLY', 'MONTHLY', 'QUARTERLY', 'CUSTOM'].includes(goalType)) throw new AppError('VALIDATION_ERROR', 'goalType must be WEEKLY, MONTHLY, QUARTERLY, or CUSTOM', 400)
  const metric = String(body.metric ?? 'REVENUE').toUpperCase()
  if (!['REVENUE', 'ORDERS', 'CUSTOMERS', 'AOV', 'RETENTION', 'CUSTOM'].includes(metric)) throw new AppError('VALIDATION_ERROR', 'metric is invalid', 400)
  const title = String(body.title ?? '').trim()
  if (!title) throw new AppError('VALIDATION_ERROR', 'title is required', 400)
  const startDate = String(body.startDate ?? new Date().toISOString().slice(0, 10))
  const endDate = String(body.endDate ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new AppError('VALIDATION_ERROR', 'startDate and endDate must be ISO dates (YYYY-MM-DD)', 400)
  return {
    goalType: goalType as CoachGoalRecord['goalType'],
    title,
    description: String(body.description ?? '').trim(),
    metric: metric as CoachGoalRecord['metric'],
    targetValue: Number(body.targetValue ?? 0),
    targetCurrency: String(body.targetCurrency ?? 'USD').toUpperCase(),
    startDate,
    endDate,
  }
}

function goalPatch(request: Request): Readonly<{ title?: string; description?: string; targetValue?: number; endDate?: string; currentProgress?: number; status?: CoachGoalRecord['status'] }> {
  const body = asRecord(request.body)
  const patch: { title?: string; description?: string; targetValue?: number; endDate?: string; currentProgress?: number; status?: CoachGoalRecord['status'] } = {}
  if (typeof body.title === 'string') patch.title = body.title.trim()
  if (typeof body.description === 'string') patch.description = body.description.trim()
  if (typeof body.targetValue === 'number' && body.targetValue > 0) patch.targetValue = body.targetValue
  if (typeof body.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) patch.endDate = body.endDate
  if (typeof body.currentProgress === 'number' && body.currentProgress >= 0) patch.currentProgress = body.currentProgress
  if (typeof body.status === 'string') {
    const status = body.status.toUpperCase()
    if (['ACTIVE', 'ACHIEVED', 'MISSED', 'CANCELLED'].includes(status)) patch.status = status as CoachGoalRecord['status']
  }
  return patch
}

function preferencePatch(request: Request): Readonly<Partial<Omit<CoachPreferences, 'storeId' | 'updatedAt'>>> {
  const body = asRecord(request.body)
  const patch: { personality?: CoachPreferences['personality']; huddleTimeMinutes?: number; huddleEnabled?: boolean; weeklyEmailEnabled?: boolean; voiceEnabled?: boolean; widgetEnabled?: boolean; language?: 'en' | 'hi'; notificationFrequency?: 'LOW' | 'NORMAL' | 'HIGH' } = {}
  if (typeof body.personality === 'string' && ['PROFESSIONAL', 'MOTIVATIONAL', 'ANALYTICAL', 'CASUAL'].includes(body.personality.toUpperCase())) patch.personality = body.personality.toUpperCase() as CoachPreferences['personality']
  if (typeof body.huddleTimeMinutes === 'number' && Number.isInteger(body.huddleTimeMinutes) && body.huddleTimeMinutes >= 0 && body.huddleTimeMinutes < 1440) patch.huddleTimeMinutes = body.huddleTimeMinutes
  if (typeof body.huddleEnabled === 'boolean') patch.huddleEnabled = body.huddleEnabled
  if (typeof body.weeklyEmailEnabled === 'boolean') patch.weeklyEmailEnabled = body.weeklyEmailEnabled
  if (typeof body.voiceEnabled === 'boolean') patch.voiceEnabled = body.voiceEnabled
  if (typeof body.widgetEnabled === 'boolean') patch.widgetEnabled = body.widgetEnabled
  if (typeof body.language === 'string' && ['en', 'hi'].includes(body.language)) patch.language = body.language as 'en' | 'hi'
  if (typeof body.notificationFrequency === 'string' && ['LOW', 'NORMAL', 'HIGH'].includes(body.notificationFrequency.toUpperCase())) patch.notificationFrequency = body.notificationFrequency.toUpperCase() as 'LOW' | 'NORMAL' | 'HIGH'
  return patch
}
