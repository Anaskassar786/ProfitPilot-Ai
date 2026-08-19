import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request, Response } from 'express'
import { AppError, isExportDataset, requestId, success } from '@profitpilot/types'
import type { ExportsService } from './exports-service.js'

/**
 * Data Exports HTTP surface.
 *
 *   GET  /exports/overview  — plan, monthly usage, export cards, history
 *   GET  /exports/history   — recent downloads
 *   POST /exports/:dataset  — generate one real file (402 when the plan
 *                             does not include it or the month is used up)
 *
 * The legacy `POST /exports` writer stays in the automation router untouched
 * so nothing else in the app breaks; this router owns the merchant page.
 */

export type ExportsRouteDependencies = Readonly<{ service: ExportsService }>

export function createExportsRouter(dependencies: ExportsRouteDependencies): Router {
  const router = Router()
  const service = dependencies.service

  router.get('/exports/overview', handle(async (request, response) => {
    send(request, response, await service.overview(tenant(request)))
  }))

  router.get('/exports/history', handle(async (request, response) => {
    send(request, response, await service.history(tenant(request), limitParam(request)))
  }))

  router.post('/exports/:dataset', handle(async (request, response) => {
    const dataset = request.params.dataset
    if (!isExportDataset(dataset)) throw new AppError('VALIDATION_ERROR', 'Choose one of the available exports: orders, catalog, audit, or revenue.', 400, { dataset: typeof dataset === 'string' ? dataset : null })
    const body = isRecord(request.body) ? request.body : {}
    const range = { from: optionalDay(body.from), to: optionalDay(body.to) }
    send(request, response, await service.generate(tenant(request), dataset, range), 201)
  }))

  return router
}

function handle(handler: (request: Request, response: Response) => Promise<void>) {
  return async (request: Request, response: Response, next: (error: unknown) => void): Promise<void> => {
    try { await handler(request, response) } catch (error: unknown) { next(error) }
  }
}

function tenant(request: Request): string {
  const raw = request.query.storeId ?? (isRecord(request.body) ? request.body.storeId : undefined)
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) throw new AppError('VALIDATION_ERROR', 'Connect your Shopify store before exporting.', 400, { reason: 'STORE_REQUIRED' })
  return value
}

function limitParam(request: Request): number {
  const raw = request.query.limit
  const parsed = typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(parsed)) return 10
  return Math.max(1, Math.min(50, Math.trunc(parsed)))
}

function optionalDay(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function send(request: Request, response: Response, data: unknown, status = 200): void {
  response.status(status).json(success(data, requestId(request.header('x-request-id') || randomUUID())))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
