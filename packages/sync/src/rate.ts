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

export type CircuitSnapshot = Readonly<{ storeId: string; failures: number; open: boolean; openedAt: number | null; retryAfterMs: number | null; cooldownMs: number }>

/**
 * Reason string carried by the 503 raised when a store circuit is open. Callers
 * (and the dashboard) branch on this instead of matching the message text.
 */
export const CIRCUIT_OPEN_REASON = 'SHOPIFY_CIRCUIT_OPEN'

/**
 * Decides whether a failed Shopify operation should count against the store
 * circuit.
 *
 * Only genuine upstream problems may trip the breaker: Shopify 5xx, 429, and
 * transport errors. Local/configuration problems — a missing offline access
 * token, a rejected token (401), validation errors, checkpoint conflicts — must
 * NOT, because those are exactly the failures the token-exchange retry is meant
 * to repair. Counting them was what left `/sync` returning `503 Circuit Open`
 * in ~9ms with no Shopify request ever being attempted.
 */
export function isCircuitTrippingFailure(error: unknown): boolean {
  if (error instanceof AppError) {
    if (error.details.reason === CIRCUIT_OPEN_REASON) return false
    if (error.details.reason === 'SHOPIFY_TOKEN_MISSING') return false
    return error.status >= 500 && error.status !== 501
  }
  const status = upstreamStatus(error)
  if (status === null) return true // transport/unknown failure: treat as upstream
  if (status === 429) return true
  return status >= 500
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
    const openedAt = this.states.get(storeId)?.openedAt ?? null
    // Compare against null explicitly: `openedAt === 0` is a valid timestamp
    // and a truthiness check would treat that circuit as closed.
    if (openedAt === null) return
    if (now - openedAt >= this.cooldownMs) {
      // Cooldown elapsed: the circuit auto-resets (half-open) and the next
      // request is allowed through to probe Shopify again.
      this.states.set(storeId, { failures: 0, openedAt: null })
      return
    }
    throw new AppError('DEPENDENCY_ERROR', 'Shopify circuit is open for this store', 503, {
      storeId,
      reason: CIRCUIT_OPEN_REASON,
      action: 'RETRY_AFTER_COOLDOWN',
      retryAfterMs: this.cooldownMs - (now - openedAt),
    })
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

  /** Manual close, used after a token exchange repairs the underlying cause. */
  public reset(storeId: StoreId): void {
    this.states.delete(storeId)
  }

  public resetAll(): void {
    this.states.clear()
  }

  public state(storeId: StoreId): Readonly<{ failures: number; open: boolean }> {
    const state = this.states.get(storeId)
    return { failures: state?.failures ?? 0, open: state?.openedAt !== null && state?.openedAt !== undefined }
  }

  public snapshot(storeId: StoreId, now = Date.now()): CircuitSnapshot {
    const state = this.states.get(storeId)
    const openedAt = state?.openedAt ?? null
    const open = openedAt !== null && now - openedAt < this.cooldownMs
    return {
      storeId,
      failures: state?.failures ?? 0,
      open,
      openedAt,
      retryAfterMs: open && openedAt !== null ? this.cooldownMs - (now - openedAt) : null,
      cooldownMs: this.cooldownMs,
    }
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
      if (isCircuitTrippingFailure(error)) this.circuits.recordFailure(storeId, this.now())
      throw error
    }
  }
}

function upstreamStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

function isRateLimited(error: unknown): error is RateLimitSignal {
  if (typeof error !== 'object' || error === null) return false
  const signal = error as RateLimitSignal
  return signal.status === 429
}
