import { agentsForPlan } from '@profitpilot/billing'
import { calculateStoreHealth } from '@profitpilot/ai'
import type { StoreSnapshot } from '@profitpilot/ai'
import type { PlanTier, StoreId } from '@profitpilot/types'
import type { CustomerDataset, CustomerRepository } from './customers.js'
import type { InventoryDataset, InventoryRepository } from './inventory.js'
import type { OrderRepository, OrderView } from './orders.js'
import { aggregateProductStock, unitsSoldWithin } from './inventory-velocity.js'

const DAY_MS = 86_400_000
const DEAD_STOCK_DAYS = 60

export type AiCommandPageMetrics = Readonly<{
  customers: Readonly<{
    total: number | null
    inactive30Days: number | null
    repeat: number | null
    potentialRecoverableRevenue: number | null
  }>
  products: Readonly<{
    active: number | null
    lowStock: number | null
    deadStock: number | null
    crossSellPairs: number | null
  }>
  orders: Readonly<{
    total: number | null
    pending: number | null
    todayCount: number | null
  }>
  revenue: Readonly<{
    today: number | null
    yesterday: number | null
    changePercent: number | null
    currency: string | null
  }>
  storeHealth: Readonly<{
    score: number | null
    status: 'Healthy' | 'Needs attention' | null
  }>
  subscription: Readonly<{
    currentPlan: PlanTier | null
    basicAgentCount: number | null
  }>
  availability: Readonly<{
    customers: boolean
    products: boolean
    orders: boolean
    inventoryHistory: boolean
    storeHealth: boolean
  }>
  generatedAt: string
}>

export interface AiCommandPageMetricsProvider {
  get(storeId: StoreId): Promise<AiCommandPageMetrics>
}

type StoreContext = Readonly<{ timezone: string; currency: string | null }>

export type AiCommandPageMetricsDependencies = Readonly<{
  customers: Pick<CustomerRepository, 'list'>
  inventory: Pick<InventoryRepository, 'list'>
  orders: Pick<OrderRepository, 'list'>
  snapshot(storeId: StoreId): Promise<StoreSnapshot>
  planFor(storeId: StoreId): Promise<PlanTier>
  storeContext(storeId: StoreId): Promise<StoreContext | null>
  now?: () => number
}>

/**
 * Builds the Command Center's value cards from the same normalized store
 * repositories used by Customers, Orders, Inventory, billing, and store
 * health. Every source settles independently: a partial sync produces nulls
 * only for the unavailable facts instead of either inventing zeroes or taking
 * the entire page down.
 */
export class AiCommandPageMetricsService implements AiCommandPageMetricsProvider {
  private readonly now: () => number

  public constructor(private readonly dependencies: AiCommandPageMetricsDependencies) {
    this.now = dependencies.now ?? (() => Date.now())
  }

  public async get(storeId: StoreId): Promise<AiCommandPageMetrics> {
    const now = this.now()
    const [customersResult, inventoryResult, ordersResult, snapshotResult, planResult, storeResult] = await Promise.allSettled([
      this.dependencies.customers.list(storeId),
      this.dependencies.inventory.list(storeId),
      this.dependencies.orders.list(storeId),
      this.dependencies.snapshot(storeId),
      this.dependencies.planFor(storeId),
      this.dependencies.storeContext(storeId),
    ])

    const customerDataset = fulfilled(customersResult)
    const inventoryDataset = fulfilled(inventoryResult)
    const orderRows = fulfilled(ordersResult)
    const snapshot = fulfilled(snapshotResult)
    const plan = fulfilled(planResult)
    const store = fulfilled(storeResult)

    const customersAvailable = customerDataset !== null && customerDataset.customers.length > 0
    const productsAvailable = inventoryDataset !== null && inventoryDataset.items.length > 0
    const ordersAvailable = orderRows !== null && orderRows.length > 0
    const inventoryHistoryAvailable = inventoryDataset !== null && inventoryDataset.sales.historyDays >= DEAD_STOCK_DAYS

    const customerMetrics = customerValues(customerDataset, customersAvailable)
    const productMetrics = productValues(inventoryDataset, productsAvailable, inventoryHistoryAvailable, now)
    const orderMetrics = orderValues(orderRows, ordersAvailable, store, now)
    const health = snapshot === null ? null : calculateStoreHealth(snapshot)

    return {
      customers: customerMetrics,
      products: {
        ...productMetrics,
        crossSellPairs: ordersAvailable && orderRows !== null ? crossSellPairCount(orderRows) : null,
      },
      orders: orderMetrics.orders,
      revenue: orderMetrics.revenue,
      storeHealth: {
        score: health?.score ?? null,
        status: health === null || health.score === null ? null : health.score >= 75 ? 'Healthy' : 'Needs attention',
      },
      subscription: {
        currentPlan: plan,
        basicAgentCount: plan === null ? null : agentsForPlan(plan).length,
      },
      availability: {
        customers: customersAvailable,
        products: productsAvailable,
        orders: ordersAvailable,
        inventoryHistory: inventoryHistoryAvailable,
        storeHealth: health !== null && health.score !== null,
      },
      generatedAt: new Date(now).toISOString(),
    }
  }
}

function customerValues(dataset: CustomerDataset | null, available: boolean): AiCommandPageMetrics['customers'] {
  if (!dataset || !available) return { total: null, inactive30Days: null, repeat: null, potentialRecoverableRevenue: null }
  // CustomerRepository marks a customer inactive only when its order coverage
  // is known and no qualifying order was placed in the trailing 30 days.
  const inactive = dataset.customers.filter((customer) => customer.activity === 'inactive')
  const spendComplete = inactive.every((customer) => customer.totalSpent !== null)
  return {
    total: dataset.customers.length,
    inactive30Days: inactive.length,
    repeat: dataset.customers.filter((customer) => customer.lifetimeOrders >= 2).length,
    potentialRecoverableRevenue: spendComplete ? round(inactive.reduce((sum, customer) => sum + (customer.totalSpent ?? 0), 0)) : null,
  }
}

function productValues(dataset: InventoryDataset | null, available: boolean, historyAvailable: boolean, now: number): Omit<AiCommandPageMetrics['products'], 'crossSellPairs'> {
  if (!dataset || !available) return { active: null, lowStock: null, deadStock: null }
  const activeProductIds = new Set(dataset.items.filter((item) => item.productStatus === 'active').map((item) => item.productId))
  const lowStock = new Set(dataset.items.filter((item) => activeProductIds.has(item.productId) && item.status === 'low').map((item) => item.productId))
  let deadStock: number | null = null
  if (historyAvailable) {
    const products = aggregateProductStock(dataset.items).filter((product) => activeProductIds.has(product.productId) && product.quantity !== null && product.quantity > 0)
    deadStock = products.filter((product) => unitsSoldWithin(dataset.sales, product.productId, DEAD_STOCK_DAYS, now) === 0).length
  }
  return { active: activeProductIds.size, lowStock: lowStock.size, deadStock }
}

function orderValues(orders: readonly OrderView[] | null, available: boolean, store: StoreContext | null, now: number): Readonly<{
  orders: AiCommandPageMetrics['orders']
  revenue: AiCommandPageMetrics['revenue']
}> {
  if (!orders || !available) {
    return {
      orders: { total: null, pending: null, todayCount: null },
      revenue: { today: null, yesterday: null, changePercent: null, currency: store?.currency ?? null },
    }
  }
  if (!store || !validTimeZone(store.timezone)) {
    return {
      orders: { total: orders.length, pending: orders.filter((order) => order.status === 'pending').length, todayCount: null },
      revenue: { today: null, yesterday: null, changePercent: null, currency: store?.currency ?? null },
    }
  }
  const today = dayInTimeZone(now, store.timezone)
  const yesterday = dayInTimeZone(now - DAY_MS, store.timezone)
  const todayOrders = orders.filter((order) => orderDay(order, store.timezone) === today)
  const yesterdayOrders = orders.filter((order) => orderDay(order, store.timezone) === yesterday)
  const todayRevenue = revenueFor(todayOrders)
  const yesterdayRevenue = revenueFor(yesterdayOrders)
  const changePercent = todayRevenue !== null && yesterdayRevenue !== null && yesterdayRevenue !== 0
    ? round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
    : null
  return {
    orders: {
      total: orders.length,
      pending: orders.filter((order) => order.status === 'pending').length,
      todayCount: todayOrders.length,
    },
    revenue: { today: todayRevenue, yesterday: yesterdayRevenue, changePercent, currency: store.currency },
  }
}

function revenueFor(orders: readonly OrderView[]): number | null {
  const eligible = orders.filter((order) => order.status !== 'canceled' && order.paymentStatus !== 'refunded' && order.paymentStatus !== 'partially_refunded' && order.paymentStatus !== 'not_paid')
  if (eligible.some((order) => order.totalPrice === null)) return null
  return round(eligible.reduce((sum, order) => sum + (order.totalPrice ?? 0), 0))
}

/** Counts unique unordered product pairings from real qualifying order lines. */
export function crossSellPairCount(orders: readonly OrderView[]): number {
  const pairs = new Set<string>()
  for (const order of orders) {
    if (order.status === 'canceled' || order.paymentStatus === 'refunded' || order.paymentStatus === 'not_paid') continue
    const productIds = [...new Set(order.lineItems.flatMap((line) => line.productId ? [line.productId] : []))].sort()
    for (let left = 0; left < productIds.length; left += 1) {
      for (let right = left + 1; right < productIds.length; right += 1) {
        const first = productIds[left]
        const second = productIds[right]
        if (first && second) pairs.add(`${first}\u0000${second}`)
      }
    }
  }
  return pairs.size
}

function orderDay(order: OrderView, timezone: string): string | null {
  const timestamp = order.createdAt ?? order.processedAt
  if (!timestamp) return null
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? dayInTimeZone(parsed, timezone) : null
}

function dayInTimeZone(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp))
  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  return `${year}-${month}-${day}`
}

function validTimeZone(timezone: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); return true } catch { return false }
}

function fulfilled<Value>(result: PromiseSettledResult<Value>): Value | null {
  return result.status === 'fulfilled' ? result.value : null
}

function round(value: number): number { return Math.round(value * 100) / 100 }
