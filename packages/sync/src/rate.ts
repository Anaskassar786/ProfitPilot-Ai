import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'

export type RateState = Readonly<{ delayMs: number; concurrency: number; rateLimitEvents: number; lastRateLimitedAt: number | null }>
export type RateLimitSignal = Readonly<{ retryAfterMs?: number | null; status?: number }>
export type Sleep = (milliseconds: number) => Promise<void>

export class AdaptiveRateController {
  private readonly states = new Map<StoreId, RateState>()
  private readonly minDelayMs: number
  private readonly maxDelayMs: number
  private readonly maxConcurrency: number
  private readonly sleep: Sleep
  private readonly now: () => number

  public constructor(options: Readonly<{ minDelayMs?: number; maxDelayMs?: number; maxConcurrency?: number; sleep?: Sleep; now?: () => number }> = {}) {
    this.minDelayMs = options.minDelayMs ?? 0
    this.maxDelayMs = options.maxDelayMs ?? 30_000
    this.maxConcurrency = options.maxConcurrency ?? 2
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.now = options.now ?? (() => Date.now())
    if (this.minDelayMs < 0 || this.maxDelayMs < this.minDelayMs || this.maxConcurrency < 1) throw new RangeError('Invalid rate controller bounds')
  }

  public state(storeId: StoreId): RateState {
    return this.states.get(storeId) ?? { delayMs: this.minDelayMs, concurrency: this.maxConcurrency, rateLimitEvents: 0, lastRateLimitedAt: null }
  }

  public async execute<Value>(storeId: StoreId, operation: () => Promise<Value>): Promise<Value> {
    const current = this.state(storeId)
    if (current.delayMs > 0) await this.sleep(current.delayMs)
    try {
      const value = await operation()
      this.recordSuccess(storeId)
      return value
    } catch (error: unknown) {
      if (isRateLimited(error)) this.recordRateLimit(storeId, error.retryAfterMs ?? null)
      throw error
    }
  }

  public recordSuccess(storeId: StoreId): RateState {
    const current = this.state(storeId)
    const next: RateState = { ...current, delayMs: Math.max(this.minDelayMs, Math.floor(current.delayMs / 2)), concurrency: Math.min(this.maxConcurrency, current.concurrency + 1) }
    this.states.set(storeId, next)
    return next
  }

  public recordRateLimit(storeId: StoreId, retryAfterMs: number | null): RateState {
    const current = this.state(storeId)
    const exponential = Math.max(current.delayMs * 2, this.minDelayMs || 100)
    const next: RateState = { delayMs: Math.min(this.maxDelayMs, Math.max(exponential, retryAfterMs ?? 0)), concurrency: Math.max(1, current.concurrency - 1), rateLimitEvents: current.rateLimitEvents + 1, lastRateLimitedAt: this.now() }
    this.states.set(storeId, next)
    return next
  }
}

export class StoreCircuitRegistry {
  private readonly states = new Map<StoreId, Readonly<{ failures: number; openedAt: number | null }>>()
  private readonly threshold: number
  private readonly cooldownMs: number

  public constructor(options: Readonly<{ failureThreshold?: number; cooldownMs?: number }> = {}) {
    this.threshold = options.failureThreshold ?? 3
    this.cooldownMs = options.cooldownMs ?? 60_000
    if (this.threshold < 1 || this.cooldownMs < 1) throw new RangeError('Circuit bounds must be positive')
  }

  public assertAvailable(storeId: StoreId, now = Date.now()): void {
    const state = this.states.get(storeId)
    if (!state?.openedAt) return
    if (now - state.openedAt >= this.cooldownMs) {
      this.states.set(storeId, { failures: 0, openedAt: null })
      return
    }
    throw new AppError('DEPENDENCY_ERROR', 'Shopify circuit is open for this store', 503, { storeId, retryAfterMs: this.cooldownMs - (now - state.openedAt) })
  }

  public recordSuccess(storeId: StoreId): void {
    this.states.set(storeId, { failures: 0, openedAt: null })
  }

  public recordFailure(storeId: StoreId, now = Date.now()): Readonly<{ failures: number; opened: boolean }> {
    const previous = this.states.get(storeId) ?? { failures: 0, openedAt: null }
    const failures = previous.failures + 1
    const opened = failures >= this.threshold
    this.states.set(storeId, { failures, openedAt: opened ? (previous.openedAt ?? now) : null })
    return { failures, opened }
  }

  public state(storeId: StoreId): Readonly<{ failures: number; open: boolean }> {
    const state = this.states.get(storeId)
    return { failures: state?.failures ?? 0, open: state?.openedAt !== null && state?.openedAt !== undefined }
  }
}

export class StoreRequestPolicy {
  private readonly rate: AdaptiveRateController
  private readonly circuits: StoreCircuitRegistry
  private readonly now: () => number

  public constructor(rate: AdaptiveRateController, circuits: StoreCircuitRegistry, now: () => number = () => Date.now()) {
    this.rate = rate
    this.circuits = circuits
    this.now = now
  }

  public async execute<Value>(storeId: StoreId, operation: () => Promise<Value>): Promise<Value> {
    this.circuits.assertAvailable(storeId, this.now())
    try {
      const result = await this.rate.execute(storeId, operation)
      this.circuits.recordSuccess(storeId)
      return result
    } catch (error: unknown) {
      this.circuits.recordFailure(storeId, this.now())
      throw error
    }
  }
}

function isRateLimited(error: unknown): error is RateLimitSignal {
  if (typeof error !== 'object' || error === null) return false
  const signal = error as RateLimitSignal
  return signal.status === 429
}
