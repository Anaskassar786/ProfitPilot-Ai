import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, success } from '@profitpilot/types'
import type { BillingRepository, BillingInterval, PlanCode, RecurringCharge, RoiMetrics, TrialAndGiftLedger, FunnelLedger } from '@profitpilot/billing'
import { PLAN_DEFINITIONS, ShopifyBillingError } from '@profitpilot/billing'

export type BillingRouteDependencies = Readonly<{ repository: BillingRepository; trials: TrialAndGiftLedger; funnel: FunnelLedger; createCharge: (shopId: string, plan: PlanCode, interval: BillingInterval, returnUrl: string, trialDays: number) => Promise<RecurringCharge>; verifyCharge: (shopId: string, chargeId: string, plan: PlanCode, interval: BillingInterval) => Promise<RecurringCharge>; usage: (shopId: string) => Promise<readonly Readonly<{ feature: string; used: number; limit: number | null }>[] >; roi: (shopId: string) => Promise<RoiMetrics>; ensureTrial?: (shopId: string) => Promise<import('@profitpilot/billing').TrialRecord> }>

/** Shopify caps trials at the plan level; 14 days is the ProfitPilot default. */
const DEFAULT_TRIAL_DAYS = 14

export function createBillingRouter(dependencies: BillingRouteDependencies): Router {
  const router = Router()
  router.get('/billing/plans', (_request, response) => response.status(200).json(success(Object.values(PLAN_DEFINITIONS), requestIdFrom(_request))))
  router.get('/billing', async (request, response, next) => { try { const shopId = queryShop(request); const record = await dependencies.repository.get(shopId); let trial = dependencies.trials.trial(shopId); if (!record && !trial) trial = dependencies.ensureTrial ? await dependencies.ensureTrial(shopId) : dependencies.trials.startTrial(shopId); response.status(200).json(success({ subscription: record, trial, gift: dependencies.trials.redemption(shopId), trialDays: DEFAULT_TRIAL_DAYS }, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.get('/billing/usage', async (request, response, next) => { try { const shopId = queryShop(request); response.status(200).json(success(await dependencies.usage(shopId), requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.get('/billing/roi', async (request, response, next) => { try { const shopId = queryShop(request); response.status(200).json(success(await dependencies.roi(shopId), requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.post('/billing/charge', async (request, response, next) => { try { const shopId = queryShop(request); const body = request.body as unknown; if (!isRecord(body) || !isPlan(body.plan) || (body.interval !== 'MONTHLY' && body.interval !== 'ANNUAL') || typeof body.returnUrl !== 'string') throw new AppError('VALIDATION_ERROR', 'plan, interval, and returnUrl are required', 400); const charge = await createChargeOrExplain(dependencies, shopId, body.plan, body.interval, body.returnUrl); dependencies.funnel.record(shopId, 'install'); response.status(201).json(success(charge, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.post('/billing/gift', async (request, response, next) => { try { const shopId = queryShop(request); const body = request.body as unknown; if (!isRecord(body) || typeof body.code !== 'string') throw new AppError('VALIDATION_ERROR', 'Gift code is required', 400); const redemption = dependencies.trials.redeemGift(shopId, body.code); await dependencies.repository.put({ storeId: shopId, plan: 'commander', state: 'GIFT_ACCESS_UNLIMITED', currentPeriodEnd: redemption.expiresAt, version: 0, interval: null, chargeId: null }); dependencies.funnel.record(shopId, 'oauth_complete'); response.status(201).json(success(redemption, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  router.post('/billing/charge/verify', async (request, response, next) => { try { const shopId = queryShop(request); const body = request.body as unknown; if (!isRecord(body) || typeof body.chargeId !== 'string' || !isPlan(body.plan) || (body.interval !== 'MONTHLY' && body.interval !== 'ANNUAL')) throw new AppError('VALIDATION_ERROR', 'chargeId, plan, and interval are required', 400); const charge = await dependencies.verifyCharge(shopId, body.chargeId, body.plan, body.interval); const state = body.interval === 'ANNUAL' ? 'ACTIVE_ANNUAL' : 'ACTIVE_MONTHLY'; await dependencies.repository.put({ storeId: shopId, plan: body.plan === 'START' ? 'start' : body.plan === 'GROWTH' ? 'growth' : 'commander', state, currentPeriodEnd: charge.billingOn ? Date.parse(charge.billingOn) : null, version: 0, interval: body.interval, chargeId: charge.id }); dependencies.funnel.record(shopId, 'oauth_complete'); response.status(200).json(success(charge, requestIdFrom(request))) } catch (error: unknown) { next(error) } })
  return router
}

/**
 * Wraps the Shopify Billing call so a rejected charge reaches the merchant as
 * an actionable message instead of a bare 500. Shopify answers 422 with the
 * offending fields; those are surfaced verbatim (they contain no secrets) and
 * kept on the error cause so the API error log records the upstream body.
 */
async function createChargeOrExplain(dependencies: BillingRouteDependencies, shopId: string, plan: PlanCode, interval: BillingInterval, returnUrl: string): Promise<RecurringCharge> {
  if (!/^https:\/\//i.test(returnUrl)) throw new AppError('VALIDATION_ERROR', 'returnUrl must be an absolute https URL', 400, { returnUrl })
  try {
    return await dependencies.createCharge(shopId, plan, interval, returnUrl, DEFAULT_TRIAL_DAYS)
  } catch (error: unknown) {
    if (!(error instanceof ShopifyBillingError)) throw error
    const rawBody = error.upstreamBody || ''
    const validationText = describeValidation(error.validationErrors)
    const isCustomAppRejection = /owned by a Shop/i.test(rawBody) || /owned by a Shop/i.test(validationText) || /partners area/i.test(rawBody) || /partners area/i.test(validationText)

    if (isCustomAppRejection) {
      const appError = new AppError(
        'VALIDATION_ERROR',
        'This app was created as a Custom App owned by a shop. To accept subscription charges (including test charges), create or migrate the app in the Shopify Partner Dashboard (partners.shopify.com).',
        422,
        { shopId, plan, interval, upstreamStatus: 422, reason: 'CUSTOM_APP_NOT_PARTNER_APP' },
      )
      appError.cause = error
      throw appError
    }

    const fields = Object.keys(error.validationErrors).join(',')
    const status = error.status === 422 ? 422 : error.status === 401 || error.status === 403 ? 502 : error.status >= 500 ? 502 : error.status
    const appError = new AppError(
      error.status === 422 ? 'VALIDATION_ERROR' : 'DEPENDENCY_ERROR',
      error.status === 422
        ? `Shopify rejected this subscription charge${fields ? ` (${describeValidation(error.validationErrors)})` : ''}. Development and partner-test stores can only accept test charges.`
        : 'Shopify Billing is unavailable right now. Retry in a moment.',
      status,
      { shopId, plan, interval, upstreamStatus: error.status, ...(fields ? { fields } : {}) },
    )
    appError.cause = error
    throw appError
  }
}

function describeValidation(errors: Readonly<Record<string, readonly string[]>>): string {
  return Object.entries(errors).map(([field, messages]) => `${field} ${messages.join(', ')}`).join('; ')
}

function queryShop(request: Request): string { const value = request.query.shopId; if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_ERROR', 'shopId is required', 400); return value }
function requestIdFrom(request: Request) { return requestId(request.header('x-request-id') || randomUUID()) }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isPlan(value: unknown): value is PlanCode { return value === 'START' || value === 'GROWTH' || value === 'COMMANDER' }
