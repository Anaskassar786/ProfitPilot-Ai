import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, storeId, success } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import { CopilotService, JarvisService } from '@profitpilot/ai'
import type { JarvisAddressing, JarvisEngagementMode, JarvisLanguage, JarvisPage, JarvisPlan, JarvisTtsProvider } from '@profitpilot/ai'
import { writeCsv } from '@profitpilot/reporting'
import type { ClosedPeriod, ReportFrequency, ReportService, ReportSchedule } from '@profitpilot/reporting'

export type JarvisRouteDependencies = Readonly<{ service: JarvisService; tts?: JarvisTtsProvider }>
export type CopilotRouteDependencies = Readonly<{ service: CopilotService }>
export type ForecastRouteDependencies = Readonly<{ forecast: (storeId: string) => Promise<unknown> }>
export type ReportRouteDependencies = Readonly<{ service: ReportService }>

export function createF8Router(dependencies: Readonly<{ jarvis?: JarvisRouteDependencies; copilot?: CopilotRouteDependencies; forecasting?: ForecastRouteDependencies; reports?: ReportRouteDependencies }>): Router {
  const router = Router()
  if (dependencies.jarvis) registerJarvis(router, dependencies.jarvis)
  if (dependencies.copilot) registerCopilot(router, dependencies.copilot)
  if (dependencies.forecasting) registerForecast(router, dependencies.forecasting)
  if (dependencies.reports) registerReports(router, dependencies.reports)
  return router
}

function registerJarvis(router: Router, dependencies: JarvisRouteDependencies): void {
  router.post('/jarvis/tts', (request, response, next) => {
    void (async () => {
      const body = requireRecord(request.body)
      if (typeof body.text !== 'string' || !body.text.trim()) throw new AppError('VALIDATION_ERROR', 'Text is required for speech', 400)
      const tts = dependencies.tts
      if (!tts || !tts.available) throw new AppError('DEPENDENCY_ERROR', 'Cloud speech is not configured. The browser voice is used instead.', 503)
      const voice = body.voice === 'masculine' ? 'masculine' : 'feminine'
      const language = body.language === 'hi' ? 'hi' : 'en'
      // queryStore enforces the tenant before we spend a synthesis call.
      queryStore(request)
      let result
      try {
        result = await tts.synthesize(body.text, voice, language)
      } catch (error: unknown) {
        // Synthesis failure must never break a spoken reply — surface a 503 so
        // the client falls back to the browser voice instead of hanging.
        const message = error instanceof Error ? error.message : 'Cloud speech failed.'
        throw new AppError('DEPENDENCY_ERROR', message, 503)
      }
      response.status(200)
      response.setHeader('content-type', result.contentType)
      response.setHeader('cache-control', 'private, max-age=3600')
      response.send(result.audio)
    })().catch((error: unknown) => next(error))
  })
  router.get('/jarvis/preferences', asyncRoute(async (request) => dependencies.service.preferences(queryStore(request))))
  router.get('/jarvis/briefing', asyncRoute(async (request) => dependencies.service.briefing(queryStore(request), pageValue(request.query.page), planValue(request.query.plan))))
  router.put('/jarvis/preferences', asyncRoute(async (request) => {
    const body = requireRecord(request.body)
    return dependencies.service.updatePreferences(queryStore(request), body as Readonly<Partial<{ addressing: JarvisAddressing; language: JarvisLanguage | 'auto'; engagementMode: JarvisEngagementMode; silenceUntil: number | null; navigationSuggestions: boolean; onlyAnswerWhenAsked: boolean }>>)
  }))
  router.post('/jarvis/sessions', asyncRoute(async (request) => { const body = requireRecord(request.body); return dependencies.service.startSession(queryStore(request), pageValue(body.page), planValue(body.plan)) }))
  router.get('/jarvis/sessions/:id', asyncRoute(async (request) => dependencies.service.getSession(queryStore(request), param(request.params.id, 'session id'))))
  router.get('/jarvis/sessions/:id/messages', asyncRoute(async (request) => dependencies.service.messages(queryStore(request), param(request.params.id, 'session id'))))
  router.post('/jarvis/sessions/:id/message', (request, response, next) => {
    void (async () => {
      const body = requireRecord(request.body)
      if (typeof body.text !== 'string') throw new AppError('VALIDATION_ERROR', 'Jarvis text is required', 400)
      const store = queryStore(request)
      const sessionId = param(request.params.id, 'session id')
      const requestIdValue = request.header('x-request-id')
      const input = { text: body.text, page: pageValue(body.page), voice: body.voice === true, ...(requestIdValue ? { requestId: requestIdValue } : {}) }
      if (body.stream === true) {
        response.status(200)
        response.setHeader('content-type', 'text/event-stream; charset=utf-8')
        response.setHeader('cache-control', 'no-cache, no-transform')
        response.setHeader('connection', 'keep-alive')
        response.setHeader('x-accel-buffering', 'no')
        response.flushHeaders()
        let connectionOpen = true
        const onClose = () => { connectionOpen = false }
        response.on('close', onClose)
        const send = (event: string, payload: unknown): void => {
          // A client can navigate away or close the tab mid-stream. Writing to
          // a destroyed socket throws and would surface as an unhandled
          // rejection / 500, so guard every frame.
          if (!connectionOpen || response.writableEnded || response.destroyed) return
          response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
        }
        try {
          const result = await dependencies.service.message(store, sessionId, input, (fullText) => send('text', { text: fullText }))
          send('done', { response: result })
        } catch (error: unknown) {
          // Streaming failed (provider error, evidence degradation, etc.). The
          // service already degrades most failures to a DEGRADED response, but
          // if a genuine error escapes, report it as a framed SSE error instead
          // of leaving the connection hanging so the client can fall back.
          if (connectionOpen && !response.writableEnded) {
            send('error', { message: error instanceof Error ? error.message : 'Jarvis stream failed' })
          }
        } finally {
          response.off('close', onClose)
          if (!response.writableEnded) response.end()
        }
        return
      }
      response.status(200).json(success(await dependencies.service.message(store, sessionId, input), requestId(requestIdValue || randomUUID())))
    })().catch((error: unknown) => next(error))
  })
  router.post('/jarvis/sessions/:id/action', asyncRoute(async (request) => { const body = requireRecord(request.body); if (typeof body.actionId !== 'string') throw new AppError('VALIDATION_ERROR', 'actionId is required', 400); return dependencies.service.confirmAction(queryStore(request), param(request.params.id, 'session id'), body.actionId) }))
  router.post('/jarvis/sessions/:id/store-action', asyncRoute(async (request) => {
    const body = requireRecord(request.body)
    if (typeof body.actionId !== 'string') throw new AppError('VALIDATION_ERROR', 'actionId is required', 400)
    const parameters = isRecord(body.parameters) ? body.parameters : {}
    const confirmed = body.confirmed === true
    return dependencies.service.invokeStoreAction(queryStore(request), param(request.params.id, 'session id'), { actionId: body.actionId, parameters: parameters as Readonly<Record<string, string | number | boolean | null>> }, confirmed)
  }))
  router.post('/jarvis/sessions/:id/:state', asyncRoute(async (request) => { const state = request.params.state; if (state !== 'pause' && state !== 'resume' && state !== 'end') throw new AppError('NOT_FOUND', 'Jarvis session command not found', 404); return dependencies.service.setSessionState(queryStore(request), param(request.params.id, 'session id'), state) }))
}

function registerCopilot(router: Router, dependencies: CopilotRouteDependencies): void {
  router.get('/copilot/threads', asyncRoute(async (request) => dependencies.service.listThreads(queryStore(request))))
  router.post('/copilot/threads', asyncRoute(async (request) => { const body = requireRecord(request.body); return dependencies.service.createThread(queryStore(request), typeof body.title === 'string' ? body.title : 'Copilot thread') }))
  router.get('/copilot/threads/:id/messages', asyncRoute(async (request) => dependencies.service.threadAnswers(queryStore(request), param(request.params.id, 'thread id'))))
  router.get('/copilot/threads/:id/export', asyncRoute(async (request) => { const answers = await dependencies.service.threadAnswers(queryStore(request), param(request.params.id, 'thread id')); const rows = answers.map((answer) => ({ createdAt: new Date(answer.createdAt).toISOString(), query: answer.query, intent: answer.intent, answer: answer.answer, confidence: answer.evidence?.confidence ?? null })); const file = writeCsv(`copilot-thread-${param(request.params.id, 'thread id')}.csv`, rows); return { filename: file.filename, contentType: file.contentType, bodyBase64: file.body.toString('base64'), rows: rows.length } }))
  router.post('/copilot/query', asyncRoute(async (request) => { const body = requireRecord(request.body); if (typeof body.query !== 'string') throw new AppError('VALIDATION_ERROR', 'Copilot query is required', 400); return dependencies.service.query({ storeId: queryStore(request), query: body.query, page: pageValue(body.page), ...(typeof body.threadId === 'string' ? { threadId: body.threadId } : {}) }) }))
}

function registerForecast(router: Router, dependencies: ForecastRouteDependencies): void { router.get('/forecasting', asyncRoute(async (request) => dependencies.forecast(queryStore(request)))) }

function registerReports(router: Router, dependencies: ReportRouteDependencies): void {
  router.get('/reports', asyncRoute(async (request) => dependencies.service.list(queryStore(request))))
  router.get('/reports/schedules', asyncRoute(async (request) => dependencies.service.schedules(queryStore(request))))
  router.post('/reports/schedules', asyncRoute(async (request) => { const body = requireRecord(request.body); if (!isFrequency(body.frequency) || typeof body.nextRunAt !== 'number' || typeof body.enabled !== 'boolean') throw new AppError('VALIDATION_ERROR', 'frequency, nextRunAt, and enabled are required', 400); const schedule: ReportSchedule = { id: typeof body.id === 'string' ? body.id : randomUUID(), storeId: queryStore(request), frequency: body.frequency, enabled: body.enabled, nextRunAt: body.nextRunAt, version: typeof body.version === 'number' ? body.version : 0 }; return dependencies.service.saveSchedule(schedule) }))
  router.get('/reports/:id/download', asyncRoute(async (request) => { const download = await dependencies.service.download(queryStore(request), param(request.params.id, 'report id')); return { filename: download.run.filename, contentType: 'application/pdf', bodyBase64: download.body.toString('base64'), bytes: download.body.byteLength } }))
  router.post('/reports/generate', asyncRoute(async (request) => { const body = requireRecord(request.body); if (!isFrequency(body.frequency) || typeof body.start !== 'string' || typeof body.end !== 'string') throw new AppError('VALIDATION_ERROR', 'frequency, start, and end are required', 400); const generated = await dependencies.service.generate({ storeId: queryStore(request), frequency: body.frequency, period: { start: body.start, end: body.end }, email: body.email === true }); return { run: generated.run, file: generated.file ? { filename: generated.file.filename, contentType: generated.file.contentType, bodyBase64: generated.file.body.toString('base64') } : null } }))
}

function asyncRoute(handler: (request: Request) => Promise<unknown>) { return async (request: Request, response: import('express').Response, next: import('express').NextFunction): Promise<void> => { try { response.status(200).json(success(await handler(request), requestId(request.header('x-request-id') || randomUUID()))) } catch (error: unknown) { next(error) } } }
function queryStore(request: Request): StoreId { const value = request.query.storeId ?? (isRecord(request.body) ? request.body.storeId : undefined); if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400); return storeId(value) }
function requireRecord(value: unknown): Readonly<Record<string, unknown>> { if (!isRecord(value)) throw new AppError('VALIDATION_ERROR', 'JSON object body is required', 400); return value }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function param(value: string | string[] | undefined, label: string): string { const result = Array.isArray(value) ? value[0] : value; if (!result?.trim()) throw new AppError('VALIDATION_ERROR', `${label} is required`, 400); return result }
function pageValue(value: unknown): JarvisPage { return typeof value === 'string' && value.trim() ? value : 'dashboard' }
function planValue(value: unknown): JarvisPlan { if (value === undefined) return 'trial'; if (value === 'trial' || value === 'start' || value === 'growth' || value === 'commander') return value; throw new AppError('VALIDATION_ERROR', 'Invalid Jarvis plan', 400) }
function isFrequency(value: unknown): value is ReportFrequency { return value === 'DAILY' || value === 'WEEKLY' || value === 'MONTHLY' || value === 'QUARTERLY' }
