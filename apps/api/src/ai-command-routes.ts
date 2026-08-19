import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, storeId, success } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import { AiCommandService } from '@profitpilot/ai'

export type AiCommandRouteDependencies = Readonly<{ service: AiCommandService }>

export function createAiCommandRouter(dependencies: AiCommandRouteDependencies): Router {
  const router = Router()
  const service = dependencies.service

  router.post('/ai-command/chat', (request, response, next) => {
    void (async () => {
      const body = requireRecord(request.body)
      const tenant = bodyStore(body)
      if (typeof body.text !== 'string') throw new AppError('VALIDATION_ERROR', 'text is required', 400)
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined
      if (body.stream === true) {
        response.status(200)
        response.setHeader('content-type', 'text/event-stream; charset=utf-8')
        response.setHeader('cache-control', 'no-cache, no-transform')
        response.setHeader('connection', 'keep-alive')
        response.setHeader('x-accel-buffering', 'no')
        response.flushHeaders()
        let open = true
        const controller = new AbortController()
        const abort = (): void => { open = false; controller.abort() }
        request.on('aborted', abort)
        response.on('close', abort)
        const send = (event: string, payload: unknown): void => {
          if (!open || response.writableEnded || response.destroyed) return
          response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
        }
        try {
          const result = await service.chat({ storeId: tenant, text: body.text, signal: controller.signal, ...(conversationId ? { conversationId } : {}) }, (event, payload) => send(event, payload))
          send('result', result)
        } catch (error: unknown) {
          if (open && !response.writableEnded) send('error', { message: error instanceof Error ? error.message : 'AI Command failed', status: error instanceof AppError ? error.status : 500, code: error instanceof AppError ? error.code : 'INTERNAL_ERROR' })
        } finally {
          if (!response.writableEnded) response.end()
        }
        return
      }
      response.status(200).json(success(await service.chat({ storeId: tenant, text: body.text, ...(conversationId ? { conversationId } : {}) }), requestIdFrom(request)))
    })().catch((error: unknown) => next(error))
  })

  router.get('/ai-command/conversations', asyncRoute(async (request) => service.conversations(queryStore(request), numberQuery(request.query.limit, 20))))
  router.get('/ai-command/conversations/:id', asyncRoute(async (request) => service.conversation(queryStore(request), param(request.params.id, 'conversation id'))))
  router.delete('/ai-command/conversations/:id', asyncRoute(async (request) => {
    await service.deleteConversation(queryStore(request), param(request.params.id, 'conversation id'))
    return { deleted: true }
  }))
  router.post('/ai-command/conversations/:id/archive', asyncRoute(async (request) => service.archiveConversation(bodyStore(requireRecord(request.body)), param(request.params.id, 'conversation id'))))
  router.get('/ai-command/conversations/:id/export', asyncRoute(async (request) => service.exportConversation(queryStore(request), param(request.params.id, 'conversation id'))))

  router.post('/ai-command/actions/:id/approve', asyncRoute(async (request) => service.approveAction(bodyStore(requireRecord(request.body)), param(request.params.id, 'action id'))))
  router.post('/ai-command/actions/:id/cancel', asyncRoute(async (request) => service.cancelAction(bodyStore(requireRecord(request.body)), param(request.params.id, 'action id'))))
  router.post('/ai-command/actions/:id/rollback', asyncRoute(async (request) => service.rollbackAction(bodyStore(requireRecord(request.body)), param(request.params.id, 'action id'))))
  router.get('/ai-command/actions', asyncRoute(async (request) => service.actionsHistory(queryStore(request), numberQuery(request.query.limit, 50))))
  router.get('/ai-command/actions/:id', asyncRoute(async (request) => service.action(queryStore(request), param(request.params.id, 'action id'))))

  router.get('/ai-command/saved', asyncRoute(async (request) => service.savedCommands(queryStore(request))))
  router.post('/ai-command/saved', asyncRoute(async (request) => {
    const body = requireRecord(request.body)
    if (typeof body.name !== 'string' || typeof body.commandText !== 'string') throw new AppError('VALIDATION_ERROR', 'name and commandText are required', 400)
    return service.saveCommand(bodyStore(body), { name: body.name, commandText: body.commandText, ...(typeof body.category === 'string' ? { category: body.category } : {}) })
  }))
  router.delete('/ai-command/saved/:id', asyncRoute(async (request) => {
    await service.deleteSaved(queryStore(request), param(request.params.id, 'saved command id'))
    return { deleted: true }
  }))
  router.post('/ai-command/saved/:id/execute', asyncRoute(async (request) => service.executeSaved(bodyStore(requireRecord(request.body)), param(request.params.id, 'saved command id'))))

  router.get('/ai-command/usage', asyncRoute(async (request) => service.usage(queryStore(request))))
  router.get('/ai-command/usage/history', asyncRoute(async (request) => service.usageHistory(queryStore(request), numberQuery(request.query.days, 30))))
  router.get('/ai-command/preferences', asyncRoute(async (request) => service.preferences(queryStore(request))))
  router.patch('/ai-command/preferences', asyncRoute(async (request) => {
    const body = requireRecord(request.body)
    return service.updatePreferences(bodyStore(body), body)
  }))
  router.get('/ai-command/quick-commands', asyncRoute(async (request) => service.quickCommands(queryStore(request))))
  router.get('/ai-command/suggestions', asyncRoute(async (request) => {
    const command = typeof request.query.command === 'string' ? request.query.command : ''
    if (!command.trim()) throw new AppError('VALIDATION_ERROR', 'command is required', 400)
    return service.suggestions(queryStore(request), command)
  }))
  router.get('/store/quick-insights', asyncRoute(async (request) => service.quickInsights(queryStore(request))))

  return router
}

function asyncRoute(handler: (request: Request) => Promise<unknown>) {
  return async (request: Request, response: import('express').Response, next: import('express').NextFunction): Promise<void> => {
    try { response.status(200).json(success(await handler(request), requestIdFrom(request))) } catch (error: unknown) { next(error) }
  }
}
function queryStore(request: Request): StoreId {
  const value = request.query.storeId ?? (isRecord(request.body) ? request.body.storeId : undefined)
  if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400)
  return storeId(value)
}
function bodyStore(body: Readonly<Record<string, unknown>>): StoreId {
  if (typeof body.storeId !== 'string' || !body.storeId.trim()) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400)
  return storeId(body.storeId)
}
function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new AppError('VALIDATION_ERROR', 'JSON object body is required', 400)
  return value
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function param(value: string | string[] | undefined, label: string): string {
  const result = Array.isArray(value) ? value[0] : value
  if (!result?.trim()) throw new AppError('VALIDATION_ERROR', `${label} is required`, 400)
  return result
}
function numberQuery(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
function requestIdFrom(request: Request) {
  return requestId(request.header('x-request-id') || randomUUID())
}
