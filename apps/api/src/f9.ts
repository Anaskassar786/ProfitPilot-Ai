import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request, RequestHandler } from 'express'
import { AppError, requestId, success } from '@profitpilot/types'
import type { AdminStepUpSessions } from '@profitpilot/billing'
import type { AdminOpsService, F9ControlService } from '@profitpilot/monitoring'
import { getAuthContext } from './security.js'

export type F9RouteDependencies = Readonly<{ controls: F9ControlService; ops: AdminOpsService; stepUp: AdminStepUpSessions }>

export function launchControlMiddleware(controls: F9ControlService | null): RequestHandler {
  return (request, _response, next): void => {
    if (!controls || isExempt(request.path)) { next(); return }
    void enforceControls(controls, request).then(() => next()).catch(next)
  }
}

export function createF9Router(dependencies: F9RouteDependencies): Router {
  const router = Router()
  router.get('/admin/maintenance', asyncRoute(async (request) => { requireStepUp(request, dependencies.stepUp); return dependencies.controls.maintenance() }))
  router.put('/admin/maintenance', asyncRoute(async (request) => { requireStepUp(request, dependencies.stepUp); const body = record(request.body); if (typeof body.enabled !== 'boolean' || typeof body.expectedVersion !== 'number') throw new AppError('VALIDATION_ERROR', 'enabled and expectedVersion are required', 400); return dependencies.controls.setMaintenance({ enabled: body.enabled, message: typeof body.message === 'string' ? body.message : '', expectedVersion: body.expectedVersion, actorId: actor(request, body.actorId) }) }))
  router.get('/admin/merchant-flags', asyncRoute(async (request) => { requireStepUp(request, dependencies.stepUp); return dependencies.controls.flags(requiredStore(request)) }))
  router.put('/admin/merchant-flags', asyncRoute(async (request) => { requireStepUp(request, dependencies.stepUp); const body = record(request.body); if (typeof body.aiEnabled !== 'boolean' || typeof body.automationEnabled !== 'boolean' || typeof body.suspended !== 'boolean' || typeof body.expectedVersion !== 'number') throw new AppError('VALIDATION_ERROR', 'flag booleans and expectedVersion are required', 400); return dependencies.controls.setFlags({ storeId: requiredStore(request), aiEnabled: body.aiEnabled, automationEnabled: body.automationEnabled, suspended: body.suspended, expectedVersion: body.expectedVersion, actorId: actor(request, body.actorId) }) }))
  router.get('/admin/launch-audit', asyncRoute(async (request) => { requireStepUp(request, dependencies.stepUp); return dependencies.controls.audit(typeof request.query.storeId === 'string' ? request.query.storeId : undefined) }))
  router.get('/admin/ops/queue', asyncRoute(async (request) => { requireStepUp(request, dependencies.stepUp); return dependencies.ops.snapshot() }))
  router.get('/admin/ops/metrics', asyncRoute(async (request) => { requireStepUp(request, dependencies.stepUp); return dependencies.ops.metrics() }))
  router.get('/admin/ops/activity', asyncRoute(async (request) => { requireStepUp(request, dependencies.stepUp); return dependencies.ops.activityFor(typeof request.query.storeId === 'string' ? request.query.storeId : undefined) }))
  router.post('/admin/ops/jobs/:id/retry', asyncRoute(async (request) => { requireStepUp(request, dependencies.stepUp); return dependencies.ops.retry(param(request.params.id), actor(request, 'admin')) }))
  return router
}

async function enforceControls(controls: F9ControlService, request: Request): Promise<void> {
  const maintenance = await controls.maintenance()
  if (maintenance.enabled) throw new AppError('MAINTENANCE_MODE', maintenance.message, 503, { retryAfterSeconds: 60 })
  const storeId = storeFromRequest(request)
  if (!storeId) return
  const flags = await controls.flags(storeId)
  if (flags.suspended) throw new AppError('FORBIDDEN', 'This merchant is temporarily suspended', 403)
  if (!flags.aiEnabled && isAiPath(request.path)) throw new AppError('FORBIDDEN', 'AI features are disabled for this merchant', 403)
  if (!flags.automationEnabled && isAutomationPath(request.path)) throw new AppError('FORBIDDEN', 'Automation features are disabled for this merchant', 403)
}

function isExempt(path: string): boolean { return path === '/live' || path === '/ready' || path === '/health' || path.startsWith('/shopify/webhooks') || path.startsWith('/admin') }
function isAiPath(path: string): boolean { return path.startsWith('/ai') || path.startsWith('/jarvis') || path.startsWith('/copilot') || path.startsWith('/recommendations') || path.startsWith('/forecasting') }
function isAutomationPath(path: string): boolean { return path.startsWith('/automation') || path.startsWith('/campaigns') || path.startsWith('/settings/merchant-email') }
function storeFromRequest(request: Request): string | null { const query = request.query.storeId ?? request.query.shopId; if (typeof query === 'string' && query.trim()) return query; const body = request.body; return recordOrNull(body)?.storeId as string | null | undefined ?? null }
function requiredStore(request: Request): string { const store = storeFromRequest(request); if (!store) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400); return store }
function record(value: unknown): Readonly<Record<string, unknown>> { const result = recordOrNull(value); if (!result) throw new AppError('VALIDATION_ERROR', 'JSON object body is required', 400); return result }
function recordOrNull(value: unknown): Readonly<Record<string, unknown>> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null }
function actor(request: Request, fallback: unknown): string { return getAuthContext(request)?.claims.sub ?? (typeof fallback === 'string' && fallback.trim() ? fallback : 'admin') }
function param(value: string | string[] | undefined): string { const result = Array.isArray(value) ? value[0] : value; if (!result?.trim()) throw new AppError('VALIDATION_ERROR', 'job id is required', 400); return result }
function requireStepUp(request: Request, stepUp: AdminStepUpSessions): void { const token = request.header('x-admin-step-up'); if (!token || !stepUp.valid(token)) throw new AppError('UNAUTHORIZED', 'Admin step-up session is required', 401) }
function asyncRoute(handler: (request: Request) => Promise<unknown>) { return async (request: Request, response: import('express').Response, next: import('express').NextFunction): Promise<void> => { try { response.status(200).json(success(await handler(request), requestId(request.header('x-request-id') || cryptoRandomId()))) } catch (error: unknown) { next(error) } } }
function cryptoRandomId(): string { return randomUUID() }
