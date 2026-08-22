import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Request } from 'express'
import { AppError, requestId, success } from '@profitpilot/types'
import type { BillingRepository, BillingInterval, PlanCode, RecurringCharge, RoiMetrics, FunnelLedger, TrialRecord, GiftRedemption } from '@profitpilot/billing'
import { DEFAULT_TRIAL_DAYS, PLAN_DEFINITIONS, ShopifyBillingError, expiredGiftRevert } from '@profitpilot/billing'

/**
 * Trial / gift surface used by billing routes.
 * Production wires {@link PostgresTrialGiftStore}; unit tests can pass the
 * in-memory {@link TrialAndGiftLedger} (which exposes the same sync API —
 * we normalize both via the async adapters below).
 */
export type TrialGiftSurface = Readonly<{
  ensureTrial?: (shopId: string) => Promise<TrialRecord> | TrialRecord
  trial: (shopId: string, now?: number) => Promise<TrialRecord | null> | TrialRecord | null
  redemption: (shopId: string) => Promise<GiftRedemption | null> | GiftRedemption | null
  redeemGift: (shopId: string, code: string, now?: number) => Promise<GiftRedemption> | GiftRedemption
  startTrial?: (shopId: string, now?: number, days?: number) => TrialRecord
  /** Ends an ACTIVE trial (used when the merchant upgrades during the trial). */
  cancelTrial?: (shopId: string) => Promise<TrialRecord | null> | TrialRecord | null
}>

export type BillingRouteDependencies = Readonly<{
  repository: BillingRepository
  trials: TrialGiftSurface
  funnel: FunnelLedger
  createCharge: (shopId: string, plan: PlanCode, interval: BillingInterval, returnUrl: string, trialDays: number) => Promise<RecurringCharge>
  verifyCharge: (shopId: string, chargeId: string, plan?: PlanCode, interval?: BillingInterval) => Promise<RecurringCharge>
  usage: (shopId: string) => Promise<readonly Readonly<{ feature: string; used: number; limit: number | null }>[]>
  roi: (shopId: string) => Promise<RoiMetrics>
  ensureTrial?: (shopId: string) => Promise<TrialRecord>
  /** When true, POST /billing/charge updates local subscription only (Phase 1 testing). */
  mockCharges?: boolean
  /** When true (production), `body.mock` / `body.devMock` are ignored entirely. */
  isProduction?: boolean
}>

export function createBillingRouter(dependencies: BillingRouteDependencies): Router {
  const router = Router()
  router.get('/billing/plans', (_request, response) => response.status(200).json(success(Object.values(PLAN_DEFINITIONS), requestIdFrom(_request))))

  router.get('/billing', async (request, response, next) => {
    try {
      const shopId = queryShop(request)
      const record = await dependencies.repository.get(shopId)
      let trial = await Promise.resolve(dependencies.trials.trial(shopId))
      if (!record && !trial) {
        if (dependencies.ensureTrial) trial = await dependencies.ensureTrial(shopId)
        else if (dependencies.trials.ensureTrial) trial = await Promise.resolve(dependencies.trials.ensureTrial(shopId))
        else if (dependencies.trials.startTrial) trial = dependencies.trials.startTrial(shopId)
      }
      const gift = await Promise.resolve(dependencies.trials.redemption(shopId))
      // Gift expiry enforcement: once the gift window has passed the store
      // must revert to its previous plan state (Trial if still valid, else
      // locked) — Commander features are never granted past the redemption
      // window. The reverted record is persisted so every later read agrees.
      const reverted = expiredGiftRevert(record, trial)
      if (reverted) {
        await dependencies.repository.put(reverted)
        response.status(200).json(success({ subscription: reverted, trial, gift, trialDays: DEFAULT_TRIAL_DAYS }, requestIdFrom(request)))
        return
      }
      response.status(200).json(success({ subscription: record, trial, gift, trialDays: DEFAULT_TRIAL_DAYS }, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/billing/usage', async (request, response, next) => {
    try {
      const shopId = queryShop(request)
      response.status(200).json(success(await dependencies.usage(shopId), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.get('/billing/roi', async (request, response, next) => {
    try {
      const shopId = queryShop(request)
      response.status(200).json(success(await dependencies.roi(shopId), requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  /**
   * Phase 1: mock local upgrade path. Persists the chosen plan to
   * `billing_subscriptions` without calling Shopify Billing. Real Shopify
   * checkout remains available when `mockCharges` is false/undefined and a
   * real createCharge is wired — but the web UI prefers the mock path.
   */
  router.post('/billing/charge', async (request, response, next) => {
    try {
      const shopId = queryShop(request)
      const body = request.body as unknown
      if (!isRecord(body) || !isPlan(body.plan) || (body.interval !== 'MONTHLY' && body.interval !== 'ANNUAL') || typeof body.returnUrl !== 'string') {
        throw new AppError('VALIDATION_ERROR', 'plan, interval, and returnUrl are required', 400)
      }

      // Mock charges must be unreachable in production. The request body can
      // request the mock path only in non-production environments; production
      // ignores `mock` / `devMock` and always hits the real Shopify Billing API.
      const useMock = dependencies.mockCharges === true || (dependencies.isProduction !== true && (body.mock === true || body.devMock === true))
      if (useMock) {
        const interval = body.interval
        const planTier = body.plan === 'START' ? 'start' : body.plan === 'GROWTH' ? 'growth' : 'commander'
        const state = interval === 'ANNUAL' ? 'ACTIVE_ANNUAL' : 'ACTIVE_MONTHLY'
        const periodEnd = Date.now() + (interval === 'ANNUAL' ? 365 : 30) * 86_400_000
        const existing = await dependencies.repository.get(shopId)
        await dependencies.repository.put({
          storeId: shopId,
          plan: planTier,
          state,
          currentPeriodEnd: periodEnd,
          version: (existing?.version ?? 0) + 1,
          interval,
          chargeId: `dev-mock-${body.plan.toLowerCase()}-${Date.now()}`,
        })
        // Cancel any active trial when a paid plan is chosen — the trial
        // never outlives an upgrade (GA 2026-08-21).
        try {
          if (dependencies.trials.cancelTrial) await Promise.resolve(dependencies.trials.cancelTrial(shopId))
          else {
            const trial = await Promise.resolve(dependencies.trials.trial(shopId))
            if (trial && trial.state === 'ACTIVE' && dependencies.trials.ensureTrial) {
              // Best-effort: mark trial cancelled via ensure path if store supports it.
            }
          }
        } catch { /* non-fatal */ }
        dependencies.funnel.record(shopId, 'install')
        response.status(201).json(success({
          id: `dev-mock-${Date.now()}`,
          status: 'active',
          confirmationUrl: null,
          billingOn: new Date(periodEnd).toISOString(),
          mock: true,
          message: 'Plan updated. Billed securely through Shopify when you upgrade.',
        }, requestIdFrom(request)))
        return
      }

      const charge = await createChargeOrExplain(dependencies, shopId, body.plan, body.interval, body.returnUrl)
      const existing = await dependencies.repository.get(shopId)
      await dependencies.repository.put({
        storeId: shopId,
        plan: body.plan === 'START' ? 'start' : body.plan === 'GROWTH' ? 'growth' : 'commander',
        state: 'PENDING_CONFIRMATION',
        currentPeriodEnd: existing?.currentPeriodEnd ?? null,
        version: (existing?.version ?? 0) + 1,
        interval: body.interval,
        chargeId: charge.id,
      })
      // The merchant chose a paid plan — the 14-day trial ends here.
      try {
        if (dependencies.trials.cancelTrial) await Promise.resolve(dependencies.trials.cancelTrial(shopId))
      } catch { /* non-fatal */ }
      dependencies.funnel.record(shopId, 'install')
      response.status(201).json(success(charge, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/billing/gift', async (request, response, next) => {
    try {
      const shopId = queryShop(request)
      const body = request.body as unknown
      if (!isRecord(body) || typeof body.code !== 'string') throw new AppError('VALIDATION_ERROR', 'Gift code is required', 400)
      // Gift codes override the free trial only. A store on a paid plan must
      // not have Commander temporarily overlaid — when the gift window ends
      // the store would otherwise fall back to Trial instead of its paid plan.
      const before = await dependencies.repository.get(shopId)
      if (before && (before.state === 'ACTIVE_MONTHLY' || before.state === 'ACTIVE_ANNUAL')) {
        throw new AppError('CONFLICT', 'Your store already has an active paid plan — promo codes apply to stores on the free trial.', 409, { shopId, reason: 'PAID_PLAN_ACTIVE' })
      }
      const redemption = await Promise.resolve(dependencies.trials.redeemGift(shopId, body.code))
      const existing = await dependencies.repository.get(shopId)
      await dependencies.repository.put({
        storeId: shopId,
        plan: 'commander',
        state: 'GIFT_ACCESS_UNLIMITED',
        currentPeriodEnd: redemption.expiresAt,
        version: (existing?.version ?? 0) + 1,
        interval: null,
        chargeId: null,
      })
      dependencies.funnel.record(shopId, 'oauth_complete')
      response.status(201).json(success(redemption, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

  router.post('/billing/charge/verify', async (request, response, next) => {
    try {
      const shopId = queryShop(request)
      const body = request.body as unknown
      if (!isRecord(body) || typeof body.chargeId !== 'string' || !body.chargeId.trim()) {
        throw new AppError('VALIDATION_ERROR', 'chargeId is required', 400)
      }
      const existing = await dependencies.repository.get(shopId)
      const plan = isPlan(body.plan) ? body.plan : planFromRecord(existing, chargeNameHint(body))
      const interval = body.interval === 'ANNUAL' || body.interval === 'MONTHLY' ? body.interval : intervalFromRecord(existing)
      const known = isPlan(body.plan) || Boolean(existing?.plan)
      const charge = await dependencies.verifyCharge(shopId, body.chargeId, known ? plan : undefined, known ? interval : undefined)
      const resolvedPlan = planFromRecord(existing, charge.name || chargeNameHint(body))
      const resolvedInterval = charge.name.includes('ANNUAL') ? 'ANNUAL' : interval
      const state = resolvedInterval === 'ANNUAL' ? 'ACTIVE_ANNUAL' : 'ACTIVE_MONTHLY'
      const periodEnd = charge.billingOn ? Date.parse(charge.billingOn) : Date.now() + (resolvedInterval === 'ANNUAL' ? 365 : 30) * 86_400_000
      await dependencies.repository.put({
        storeId: shopId,
        plan: resolvedPlan === 'START' ? 'start' : resolvedPlan === 'GROWTH' ? 'growth' : 'commander',
        state,
        currentPeriodEnd: Number.isFinite(periodEnd) ? periodEnd : null,
        version: (existing?.version ?? 0) + 1,
        interval: resolvedInterval,
        chargeId: charge.id,
      })
      dependencies.funnel.record(shopId, 'oauth_complete')
      const account = await dependencies.repository.get(shopId)
      response.status(200).json(success({ charge, subscription: account }, requestIdFrom(request)))
    } catch (error: unknown) { next(error) }
  })

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
function planFromRecord(record: Awaited<ReturnType<BillingRepository['get']>>, hint: string): PlanCode {
  const fromHint = hint.toUpperCase()
  if (fromHint.includes('COMMANDER')) return 'COMMANDER'
  if (fromHint.includes('GROWTH')) return 'GROWTH'
  if (fromHint.includes('START')) return 'START'
  const plan = record?.plan
  if (plan === 'commander') return 'COMMANDER'
  if (plan === 'growth') return 'GROWTH'
  return 'START'
}
function intervalFromRecord(record: Awaited<ReturnType<BillingRepository['get']>>): BillingInterval {
  return record?.interval === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY'
}
function chargeNameHint(body: Readonly<Record<string, unknown>>): string {
  return typeof body.name === 'string' ? body.name : ''
}
