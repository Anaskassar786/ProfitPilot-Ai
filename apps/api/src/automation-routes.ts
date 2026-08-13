import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, success } from '@profitpilot/types'
import { activateWorkflow, compileTemplate, MerchantEmailVerifier, priorityForPlan, ThreadLedger } from '@profitpilot/automation'
import type { CampaignTemplate, TemplateRepository, Ticket, WorkflowDefinition, WorkflowRepository } from '@profitpilot/automation'
import { writeCsv, writePdf, writeXlsx } from '@profitpilot/reporting'
import type { ExportRow, ExportFormat } from '@profitpilot/reporting'

export type AutomationRouteDependencies = Readonly<{ workflows: WorkflowRepository; templates: TemplateRepository; emailVerifier: MerchantEmailVerifier; tickets: ThreadLedger }>

export function createAutomationRouter(dependencies: AutomationRouteDependencies): Router {
  const router = Router()
  router.get('/automation/workflows', async (request, response, next) => { try { response.status(200).json(success(await dependencies.workflows.list(queryStore(request)), requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.post('/automation/workflows', async (request, response, next) => { try { const definition = request.body as WorkflowDefinition; await dependencies.workflows.put(definition); response.status(201).json(success(definition, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.post('/automation/workflows/:id/activate', async (request, response, next) => { try { const draft = await dependencies.workflows.get(request.params.id); if (!draft) throw new AppError('NOT_FOUND', 'Workflow not found', 404); const activated = activateWorkflow(draft, new Date().toISOString()); await dependencies.workflows.activate(activated); response.status(200).json(success(activated, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.get('/campaigns/templates', async (_request, response, next) => { try { response.status(200).json(success(await dependencies.templates.list(), requestIdFrom(_request))) } catch (error: unknown) { next(error) } })
  router.post('/campaigns/templates', async (request, response, next) => { try { const body = request.body as unknown; if (!isRecord(body) || typeof body.storeId !== 'string') throw new AppError('VALIDATION_ERROR', 'storeId is required for campaign templates', 400); const template = compileTemplate(body as Omit<CampaignTemplate, 'variables'>); await dependencies.templates.put(template); response.status(201).json(success(template, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.post('/exports', (request, response, next) => { try { const body = request.body as unknown; if (!isRecord(body) || !isFormat(body.format) || !Array.isArray(body.rows)) throw new AppError('VALIDATION_ERROR', 'format and rows are required', 400); const rows = body.rows.filter(isExportRow); const file = body.format === 'CSV' ? writeCsv(`export-${randomUUID()}.csv`, rows) : body.format === 'XLSX' ? writeXlsx(`export-${randomUUID()}.xlsx`, rows) : writePdf(`export-${randomUUID()}.pdf`, rows); response.status(200).json(success({ filename: file.filename, contentType: file.contentType, bodyBase64: file.body.toString('base64'), rows: rows.length }, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.get('/support/tickets', (request, response) => response.status(200).json(success(dependencies.tickets.list(queryStore(request)), requestIdFrom(request))))
  router.post('/support/tickets', (request, response, next) => { try { const body = request.body as unknown; if (!isRecord(body) || typeof body.shopId !== 'string' || typeof body.subject !== 'string' || !isPlan(body.plan)) throw new AppError('VALIDATION_ERROR', 'shopId, subject, and plan are required', 400); const now = Date.now(); const ticket: Ticket = { id: randomUUID(), shopId: body.shopId, subject: body.subject, priority: priorityForPlan(body.plan), status: 'OPEN', createdAt: now, updatedAt: now, version: 0 }; response.status(201).json(success(dependencies.tickets.create(ticket), requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.post('/settings/merchant-email', (request, response, next) => { try { const body = request.body as unknown; if (!isRecord(body) || typeof body.shopId !== 'string' || typeof body.email !== 'string' || typeof body.fromName !== 'string') throw new AppError('VALIDATION_ERROR', 'shopId, email, and fromName are required', 400); const config = dependencies.emailVerifier.save(body.shopId, body.email, body.fromName); const verificationToken = dependencies.emailVerifier.token(body.shopId, body.email, Date.now() + 86_400_000); response.status(200).json(success({ config, verificationRequired: true, verificationToken }, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.post('/settings/merchant-email/verify', (request, response, next) => { try { const body = request.body as unknown; if (!isRecord(body) || typeof body.token !== 'string') throw new AppError('VALIDATION_ERROR', 'verification token is required', 400); response.status(200).json(success(dependencies.emailVerifier.verify(body.token), requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  return router
}

function queryStore(request: Request): string { const value = request.query.storeId; if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_ERROR', 'storeId is required', 400); return value }
function requestIdFrom(request: Request) { return requestId(request.header('x-request-id') || randomUUID()) }
function isFormat(value: unknown): value is ExportFormat { return value === 'CSV' || value === 'XLSX' || value === 'PDF' }
function isPlan(value: unknown): value is 'start' | 'growth' | 'commander' { return value === 'start' || value === 'growth' || value === 'commander' }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isExportRow(value: unknown): value is ExportRow { return isRecord(value) && Object.values(value).every((item) => item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') }
