import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, PhaseNotImplementedError, requestId, success } from '@profitpilot/types'
import type { AdminStepUpSessions, FunnelLedger } from '@profitpilot/billing'
import type { AccessReviewService } from '@profitpilot/monitoring'
import type { Role } from '@profitpilot/types'
import { getAuthContext } from './security.js'

/** Minimal gift admin surface — kill switch only. Backed by Postgres or in-memory. */
export type GiftAdminSurface = Readonly<{ setGiftKillSwitch: (active: boolean) => void }>

export type AdminRouteDependencies = Readonly<{ adminKey: string; stepUp: AdminStepUpSessions; funnel: FunnelLedger; gifts: GiftAdminSurface; accessReview?: AccessReviewService }>

export function createAdminRouter(dependencies: AdminRouteDependencies): Router {
  const router = Router()
  router.post('/admin/step-up', (request, response, next) => { try { const body = request.body as unknown; if (!isRecord(body) || typeof body.key !== 'string') throw new AppError('UNAUTHORIZED', 'Admin key is required', 401); const token = dependencies.stepUp.issue(body.key, dependencies.adminKey); response.status(200).json(success({ stepUpToken: token, expiresInMinutes: 15 }, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.get('/admin/funnel', (request, response, next) => { try { requireStepUp(request, dependencies); response.status(200).json(success({ milestones: dependencies.funnel.milestones(String(request.query.shopId ?? '')) }, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.post('/admin/gift-kill-switch', (request, response, next) => { try { requireStepUp(request, dependencies); const body = request.body as unknown; if (!isRecord(body) || typeof body.active !== 'boolean') throw new AppError('VALIDATION_ERROR', 'active boolean is required', 400); dependencies.gifts.setGiftKillSwitch(body.active); response.status(200).json(success({ active: body.active }, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.get('/admin/access-review', async (request, response, next) => { try { requireStepUp(request, dependencies); const review = accessReview(dependencies); response.status(200).json(success(await review.report(queryStore(request)), requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.post('/admin/access-review/assign', async (request, response, next) => { try { requireStepUp(request, dependencies); const body = requireAccessBody(request.body); if (!body.role) throw new AppError('VALIDATION_ERROR', 'role is required for assignment', 400); const review = accessReview(dependencies); const input = { storeId: body.storeId, userId: body.userId, role: body.role, actorId: actorFor(request, body.actorId), ...(body.expectedVersion === undefined ? {} : { expectedVersion: body.expectedVersion }) }; response.status(200).json(success(await review.assign(input), requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.post('/admin/access-review/revoke', async (request, response, next) => { try { requireStepUp(request, dependencies); const body = requireAccessBody(request.body); if (body.expectedVersion === undefined) throw new AppError('VALIDATION_ERROR', 'expectedVersion is required for revocation', 400); const review = accessReview(dependencies); response.status(200).json(success(await review.revoke({ storeId: body.storeId, userId: body.userId, actorId: actorFor(request, body.actorId), expectedVersion: body.expectedVersion }), requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.get('/admin/access-review/export', async (request, response, next) => { try { requireStepUp(request, dependencies); const review = accessReview(dependencies); const format = request.query.format === 'JSON' ? 'JSON' : 'CSV'; const actorId = getAuthContext(request)?.claims.sub ?? (typeof request.query.actorId === 'string' && request.query.actorId.trim() ? request.query.actorId : 'admin'); const exported = await review.export(queryStore(request), actorId, format); response.status(200).json(success({ filename: exported.filename, contentType: exported.contentType, body: exported.body }, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  return router
}

function requireStepUp(request: Request, dependencies: AdminRouteDependencies): void { const token = request.header('x-admin-step-up'); if (!token || !dependencies.stepUp.valid(token)) throw new AppError('UNAUTHORIZED', 'Admin step-up session is required', 401) }
function accessReview(dependencies: AdminRouteDependencies): AccessReviewService { if (!dependencies.accessReview) throw new PhaseNotImplementedError('F7', 'SOC-2-Lite access review') ; return dependencies.accessReview }
function queryStore(request: Request): string { const value = request.query.storeId; if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400); return value }
type AccessBody = Readonly<{ storeId: string; userId: string; actorId: string; role?: Role; expectedVersion?: number }>
function requireAccessBody(value: unknown): AccessBody {
  if (!isRecord(value) || typeof value.storeId !== 'string' || typeof value.userId !== 'string' || typeof value.actorId !== 'string') throw new AppError('VALIDATION_ERROR', 'storeId, userId, and actorId are required', 400)
  const role = value.role
  const expectedVersion = value.expectedVersion
  if ((role !== undefined && !isRole(role)) || (expectedVersion !== undefined && (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 0))) throw new AppError('VALIDATION_ERROR', 'role and expectedVersion must use valid values', 400)
  return { storeId: value.storeId, userId: value.userId, actorId: value.actorId, ...(isRole(role) ? { role } : {}), ...(typeof expectedVersion === 'number' ? { expectedVersion } : {}) }
}
function isRole(value: unknown): value is Role { return value === 'owner' || value === 'admin' || value === 'operator' || value === 'analyst' || value === 'viewer' }
function actorFor(request: Request, fallback: string): string { return getAuthContext(request)?.claims.sub ?? fallback }
function requestIdFrom(request: Request) { return requestId(request.header('x-request-id') || randomUUID()) }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
