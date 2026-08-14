import type { StoreSnapshot } from './domain.js'

export type HealthComponent = Readonly<{ key: string; score: number | null; weight: number; reason: string }>
export type StoreHealth = Readonly<{ score: number | null; method: 'deterministic-v1'; components: readonly HealthComponent[] }>

export function calculateStoreHealth(snapshot: StoreSnapshot): StoreHealth {
  const components: readonly HealthComponent[] = [
    momentum('revenue_momentum', snapshot.last30dRevenue, snapshot.previous30dRevenue, .35),
    momentum('order_momentum', snapshot.last30dOrders, snapshot.previous30dOrders, .25),
    inventoryHealth(snapshot),
    retentionHealth(snapshot),
  ]
  const available = components.filter((component) => component.score !== null)
  if (available.length === 0) return { score: null, method: 'deterministic-v1', components }
  const weighted = available.reduce((sum, component) => sum + (component.score ?? 0) * component.weight, 0)
  const weights = available.reduce((sum, component) => sum + component.weight, 0)
  return { score: Math.round(weighted / weights), method: 'deterministic-v1', components }
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
