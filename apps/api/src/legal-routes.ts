import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, success } from '@profitpilot/types'
import { LEGAL_SLUGS, legalBodyText, legalDocument, legalDocuments, renderLegalHtml } from './legal.js'
import type { LegalConfig, LegalSlug } from './legal.js'

export type LegalRouteDependencies = Readonly<{ config: LegalConfig; now?: () => Date }>

export function createLegalRouter(dependencies: LegalRouteDependencies): Router {
  const router = Router()
  router.get('/legal', (request, response) => respondWithIndex(request, response, dependencies))
  router.get('/legal/:slug', (request, response, next) => {
    try {
      const slug = parseSlug(request.params.slug)
      const document = legalDocument(slug, dependencies.config, dependencies.now?.() ?? new Date())
      if (wantsHtml(request)) {
        response.type('html').status(200).send(renderLegalHtml(document))
        return
      }
      response.status(200).json(success({ ...document, bodyText: legalBodyText(document) }, requestIdFrom(request)))
    } catch (error: unknown) {
      next(error)
    }
  })
  return router
}

function respondWithIndex(request: Request, response: import('express').Response, dependencies: LegalRouteDependencies): void {
  const documents = legalDocuments(dependencies.config, dependencies.now?.() ?? new Date())
  if (wantsHtml(request)) {
    const links = documents.map((document) => `<li><a href="/legal/${document.slug}">${escapeHtml(document.title)}</a></li>`).join('')
    response.type('html').status(200).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ProfitPilot legal pages</title></head><body><main><h1>ProfitPilot legal pages</h1><ul>${links}</ul></main></body></html>`)
    return
  }
  response.status(200).json(success(documents.map((document) => ({ slug: document.slug, title: document.title, effectiveDate: document.effectiveDate, url: `/legal/${document.slug}` })), requestIdFrom(request)))
}

function parseSlug(value: string | undefined): LegalSlug {
  if (typeof value === 'string' && (LEGAL_SLUGS as readonly string[]).includes(value)) return value as LegalSlug
  throw new AppError('NOT_FOUND', 'Legal page not found', 404)
}

function wantsHtml(request: Request): boolean {
  const format = request.query.format
  if (format === 'json') return false
  if (format === 'html') return true
  const accept = request.header('accept') ?? ''
  return accept.includes('text/html') && !accept.includes('application/json')
}

function requestIdFrom(request: Request) {
  return requestId(request.header('x-request-id') || randomUUID())
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
