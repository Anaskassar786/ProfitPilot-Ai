import { describe, expect, it } from 'vitest'
import { AppError, storeId } from '@profitpilot/types'
import { AdaptiveRateController, StoreCircuitRegistry, StoreRequestPolicy } from './rate.js'

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
