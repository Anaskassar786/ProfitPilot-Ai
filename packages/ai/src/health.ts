import type { StoreSnapshot } from './domain.js'

export type HealthComponent = Readonly<{ key: string; score: number | null; weight: number; reason: string }>
export type StoreHealth = Readonly<{
  score: number | null
  method: 'deterministic-v1'
  components: readonly HealthComponent[]
  /** Total closed-period order rows across the last two 30-day windows. */
  orderCount: number
  /** Days of order history between the earliest and latest order row (null when unknown). */
  historyDays: number | null
}>

/** Minimum closed-period orders before a health score is meaningful. */
export const MIN_ORDERS_FOR_HEALTH = 10
/** Minimum days of order history before momentum windows are meaningful. */
export const MIN_HISTORY_DAYS_FOR_HEALTH = 7

/**
 * Deterministic store health. Returns `score: null` whenever there is not
 * enough closed-period evidence to compute an honest number — a store with
 * thin, stale, or absent history must never render a panic-inducing
 * "0/100 Critical". The frontend turns these cases into educational empty
 * states, never a fake score.
 */
export function calculateStoreHealth(snapshot: StoreSnapshot): StoreHealth {
  const components: readonly HealthComponent[] = [
    momentum('revenue_momentum', snapshot.last30dRevenue, snapshot.previous30dRevenue, .35),
    momentum('order_momentum', snapshot.last30dOrders, snapshot.previous30dOrders, .25),
    inventoryHealth(snapshot),
    retentionHealth(snapshot),
  ]
  const orderCount = snapshot.last30dOrders + snapshot.previous30dOrders
  const historyDays = orderHistoryDays(snapshot)
  const available = components.filter((component) => component.score !== null)
  // Data-sufficiency gate: never score a store from a handful of orders or a
  // single-day window. `score: null` is the honest answer until evidence accrues.
  const tooFewOrders = orderCount < MIN_ORDERS_FOR_HEALTH
  const tooThinHistory = historyDays !== null && historyDays < MIN_HISTORY_DAYS_FOR_HEALTH
  if (available.length === 0 || tooFewOrders || tooThinHistory) {
    return { score: null, method: 'deterministic-v1', components, orderCount, historyDays }
  }
  const weighted = available.reduce((sum, component) => sum + (component.score ?? 0) * component.weight, 0)
  const weights = available.reduce((sum, component) => sum + component.weight, 0)
  return { score: Math.round(weighted / weights), method: 'deterministic-v1', components, orderCount, historyDays }
}

/**
 * Days between the earliest and latest order row. Used to distinguish a store
 * with genuine (but thin) order history from one that simply has not synced
 * enough data yet — the Command Center renders different empty states for each.
 */
function orderHistoryDays(snapshot: StoreSnapshot): number | null {
  const days = snapshot.orders.map((order) => order.day).filter((day) => day.length === 10 && Number.isFinite(Date.parse(`${day}T00:00:00Z`)))
  if (days.length === 0) return null
  const earliest = days.reduce((min, day) => (day < min ? day : min))
  const latest = snapshot.dataFreshAt && snapshot.dataFreshAt.length === 10 ? snapshot.dataFreshAt : days.reduce((max, day) => (day > max ? day : max))
  const span = Math.round((Date.parse(`${latest}T00:00:00Z`) - Date.parse(`${earliest}T00:00:00Z`)) / 86_400_000)
  return Number.isFinite(span) ? Math.max(0, span) : null
}

function momentum(key: string, current: number, previous: number, weight: number): HealthComponent {
  if (current < 0 || previous < 0 || current === 0 && previous === 0) return { key, score: null, weight, reason: 'Insufficient closed-period data' }
  if (previous === 0) return { key, score: 100, weight, reason: 'Positive activity with no previous-period baseline' }
  const change = (current - previous) / previous
  return { key, score: clamp(Math.round(50 + change * 100), 0, 100), weight, reason: `${Math.round(change * 100)}% period change` }
}

function inventoryHealth(snapshot: StoreSnapshot): HealthComponent {
  const withVelocity = snapshot.products.filter((product) => product.averageDailyUnits > 0)
  if (withVelocity.length === 0) return { key: 'inventory_coverage', score: null, weight: .2, reason: 'No product velocity rows' }
  const healthy = withVelocity.filter((product) => product.inventoryUnits / product.averageDailyUnits > 7).length
  return { key: 'inventory_coverage', score: Math.round((healthy / withVelocity.length) * 100), weight: .2, reason: `${healthy} of ${withVelocity.length} products above seven days of cover` }
}

function retentionHealth(snapshot: StoreSnapshot): HealthComponent {
  if (snapshot.customers.length === 0) return { key: 'customer_retention', score: null, weight: .2, reason: 'No customer rows' }
  const repeat = snapshot.customers.filter((customer) => customer.orderCount > 1).length
  return { key: 'customer_retention', score: Math.round((repeat / snapshot.customers.length) * 100), weight: .2, reason: `${repeat} of ${snapshot.customers.length} customers have repeat orders` }
}

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)) }
