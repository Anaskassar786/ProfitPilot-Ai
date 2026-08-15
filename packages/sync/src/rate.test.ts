import { describe, expect, it } from 'vitest'
import { AppError, storeId } from '@profitpilot/types'
import { AdaptiveRateController, CIRCUIT_OPEN_REASON, isCircuitTrippingFailure, StoreCircuitRegistry, StoreRequestPolicy } from './rate.js'

describe('adaptive Shopify rate policy', () => {
  it('starts each store at the configured concurrency', () => expect(new AdaptiveRateController({ maxConcurrency: 3 }).state(storeId('s')).concurrency).toBe(3))
  it('backs off and lowers concurrency after a 429', () => {
    const controller = new AdaptiveRateController({ minDelayMs: 10, maxDelayMs: 1000, maxConcurrency: 3, now: () => 100 })
    const state = controller.recordRateLimit(storeId('s'), 250)
    expect(state.delayMs).toBe(250)
    expect(state.concurrency).toBe(2)
    expect(state.rateLimitEvents).toBe(1)
  })
  it('recovers delay and concurrency on success', () => {
    const controller = new AdaptiveRateController({ minDelayMs: 10, maxConcurrency: 3 })
    controller.recordRateLimit(storeId('s'), null)
    const state = controller.recordSuccess(storeId('s'))
    expect(state.delayMs).toBe(10)
    expect(state.concurrency).toBe(3)
  })
  it('sleeps the current per-store delay before a request', async () => {
    const waits: number[] = []
    const controller = new AdaptiveRateController({ minDelayMs: 10, sleep: async (delay) => { waits.push(delay) } })
    controller.recordRateLimit(storeId('s'), 20)
    await controller.execute(storeId('s'), async () => 'ok')
    expect(waits).toEqual([20])
  })
  it('records a rate-limit signal from an operation', async () => {
    const controller = new AdaptiveRateController({ minDelayMs: 10, sleep: async () => undefined })
    await expect(controller.execute(storeId('s'), async () => { throw { status: 429, retryAfterMs: 33 } })).rejects.toMatchObject({ status: 429 })
    expect(controller.state(storeId('s')).delayMs).toBe(33)
  })
  it('keeps store rate states isolated', () => {
    const controller = new AdaptiveRateController()
    controller.recordRateLimit(storeId('one'), null)
    expect(controller.state(storeId('two')).rateLimitEvents).toBe(0)
  })
})

describe('store circuit isolation', () => {
  it('opens after the configured failure threshold', () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 2, cooldownMs: 100 })
    circuits.recordFailure(storeId('s'), 10)
    expect(circuits.recordFailure(storeId('s'), 20).opened).toBe(true)
    expect(circuits.state(storeId('s')).open).toBe(true)
  })
  it('rejects requests while a store circuit is open', () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 1, cooldownMs: 100 })
    circuits.recordFailure(storeId('s'), 10)
    expect(() => circuits.assertAvailable(storeId('s'), 20)).toThrow(AppError)
  })
  it('closes after cooldown and resets failures', () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 1, cooldownMs: 100 })
    circuits.recordFailure(storeId('s'), 10)
    expect(() => circuits.assertAvailable(storeId('s'), 110)).not.toThrow()
    expect(circuits.state(storeId('s')).open).toBe(false)
  })
  it('resets a store after a successful request', () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 2 })
    circuits.recordFailure(storeId('s'))
    circuits.recordSuccess(storeId('s'))
    expect(circuits.state(storeId('s'))).toEqual({ failures: 0, open: false })
  })
  it('keeps a noisy store from affecting another store', () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 1 })
    circuits.recordFailure(storeId('noisy'))
    expect(() => circuits.assertAvailable(storeId('quiet'))).not.toThrow()
  })
  it('combines circuit isolation with adaptive rate policy', async () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 2 })
    const rate = new AdaptiveRateController({ sleep: async () => undefined })
    const policy = new StoreRequestPolicy(rate, circuits)
    await expect(policy.execute(storeId('s'), async () => { throw { status: 429, retryAfterMs: 1 } })).rejects.toMatchObject({ status: 429 })
    await expect(policy.execute(storeId('s'), async () => { throw new Error('second') })).rejects.toThrow('second')
    expect(() => circuits.assertAvailable(storeId('s'))).toThrow('circuit is open')
  })
})

describe('circuit trip classification', () => {
  it('ignores a missing offline access token', () => {
    expect(isCircuitTrippingFailure(new AppError('DEPENDENCY_ERROR', 'missing', 503, { reason: 'SHOPIFY_TOKEN_MISSING' }))).toBe(false)
  })
  it('ignores a Shopify 401 so the token exchange can repair it', () => {
    expect(isCircuitTrippingFailure({ name: 'ShopifyApiError', status: 401 })).toBe(false)
  })
  it('ignores validation and conflict failures', () => {
    expect(isCircuitTrippingFailure(new AppError('VALIDATION_ERROR', 'bad', 400))).toBe(false)
    expect(isCircuitTrippingFailure(new AppError('CONFLICT', 'checkpoint', 409))).toBe(false)
  })
  it('never lets an open-circuit rejection count against itself', () => {
    expect(isCircuitTrippingFailure(new AppError('DEPENDENCY_ERROR', 'open', 503, { reason: CIRCUIT_OPEN_REASON }))).toBe(false)
  })
  it('trips on Shopify 5xx, 429, and transport errors', () => {
    expect(isCircuitTrippingFailure({ status: 500 })).toBe(true)
    expect(isCircuitTrippingFailure({ status: 429 })).toBe(true)
    expect(isCircuitTrippingFailure(new Error('ECONNRESET'))).toBe(true)
  })
})

describe('circuit recovery controls', () => {
  it('does not open on repeated token failures', async () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 2 })
    const policy = new StoreRequestPolicy(new AdaptiveRateController({ sleep: async () => undefined }), circuits)
    const missing = () => { throw new AppError('DEPENDENCY_ERROR', 'missing', 503, { reason: 'SHOPIFY_TOKEN_MISSING' }) }
    await expect(policy.execute(storeId('s'), async () => missing())).rejects.toThrow('missing')
    await expect(policy.execute(storeId('s'), async () => missing())).rejects.toThrow('missing')
    await expect(policy.execute(storeId('s'), async () => missing())).rejects.toThrow('missing')
    expect(circuits.state(storeId('s')).open).toBe(false)
  })
  it('carries a machine-readable reason and retry hint when open', () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 1, cooldownMs: 5_000 })
    circuits.recordFailure(storeId('s'), 1_000)
    const failure = (() => { try { circuits.assertAvailable(storeId('s'), 2_000); return null } catch (error: unknown) { return error as AppError } })()
    expect(failure?.details.reason).toBe(CIRCUIT_OPEN_REASON)
    expect(failure?.details.retryAfterMs).toBe(4_000)
  })
  it('closes immediately on an explicit reset', () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 1, cooldownMs: 60_000 })
    circuits.recordFailure(storeId('s'), 0)
    expect(() => circuits.assertAvailable(storeId('s'), 10)).toThrow('circuit is open')
    circuits.reset(storeId('s'))
    expect(() => circuits.assertAvailable(storeId('s'), 20)).not.toThrow()
  })
  it('reports a snapshot with the remaining cooldown', () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 1, cooldownMs: 1_000 })
    circuits.recordFailure(storeId('s'), 0)
    expect(circuits.snapshot(storeId('s'), 400)).toMatchObject({ open: true, failures: 1, retryAfterMs: 600, cooldownMs: 1_000 })
    expect(circuits.snapshot(storeId('s'), 1_500)).toMatchObject({ open: false, retryAfterMs: null })
  })
  it('clears every store with resetAll', () => {
    const circuits = new StoreCircuitRegistry({ failureThreshold: 1 })
    circuits.recordFailure(storeId('a'))
    circuits.recordFailure(storeId('b'))
    circuits.resetAll()
    expect(circuits.state(storeId('a')).open).toBe(false)
    expect(circuits.state(storeId('b')).open).toBe(false)
  })
})
