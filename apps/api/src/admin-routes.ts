import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, success } from '@profitpilot/types'
import type { AdminStepUpSessions, FunnelLedger, TrialAndGiftLedger } from '@profitpilot/billing'

export type AdminRouteDependencies = Readonly<{ adminKey: string; stepUp: AdminStepUpSessions; funnel: FunnelLedger; gifts: TrialAndGiftLedger }>

export function createAdminRouter(dependencies: AdminRouteDependencies): Router {
  const router = Router()
  router.post('/admin/step-up', (request, response, next) => { try { const body = request.body as unknown; if (!isRecord(body) || typeof body.key !== 'string') throw new AppError('UNAUTHORIZED', 'Admin key is required', 401); const token = dependencies.stepUp.issue(body.key, dependencies.adminKey); response.status(200).json(success({ stepUpToken: token, expiresInMinutes: 15 }, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.get('/admin/funnel', (request, response, next) => { try { requireStepUp(request, dependencies); response.status(200).json(success({ milestones: dependencies.funnel.milestones(String(request.query.shopId ?? '')) }, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.post('/admin/gift-kill-switch', (request, response, next) => { try { requireStepUp(request, dependencies); const body = request.body as unknown; if (!isRecord(body) || typeof body.active !== 'boolean') throw new AppError('VALIDATION_ERROR', 'active boolean is required', 400); dependencies.gifts.setGiftKillSwitch(body.active); response.status(200).json(success({ active: body.active }, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  return router
}

function requireStepUp(request: Request, dependencies: AdminRouteDependencies): void { const token = request.header('x-admin-step-up'); if (!token || !dependencies.stepUp.valid(token)) throw new AppError('UNAUTHORIZED', 'Admin step-up session is required', 401) }
function requestIdFrom(request: Request) { return requestId(request.header('x-request-id') || randomUUID()) }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
