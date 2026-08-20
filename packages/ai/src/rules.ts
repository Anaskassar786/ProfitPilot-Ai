import type { RuleSignal, StoreSnapshot } from './domain.js'
import { actionRisk } from './domain.js'
import { calculateStoreHealth } from './health.js'

export const RULE_VERSION = '1.1.0'
export type RuleConfig = Readonly<{ stockoutDays: number; deadStockDays: number; highLtvThreshold: number; churnDays: number; repeatPurchaseDays: number; cartRecoveryRate: number; crossSellRate: number; welcomeDays: number; minimumMargin: number; momentumThreshold: number; healthDigestDay: number }>

const DEFAULTS: RuleConfig = { stockoutDays: 7, deadStockDays: 120, highLtvThreshold: 250, churnDays: 75, repeatPurchaseDays: 45, cartRecoveryRate: .11, crossSellRate: .08, welcomeDays: 7, minimumMargin: .55, momentumThreshold: .15, healthDigestDay: 1 }

/**
 * Machine-readable catalog of every deterministic rule, so the UI renders
 * real rule data instead of a hard-coded "8 deterministic rules" string.
 */
export type RuleCatalogEntry = Readonly<{ id: string; name: string; agent: string; purpose: string; threshold: string; inputs: readonly string[]; impact: string }>
export function ruleCatalog(config: Partial<RuleConfig> = {}): readonly RuleCatalogEntry[] {
  const options = { ...DEFAULTS, ...config }
  return [
    { id: 'STOCKOUT_RISK', name: 'Stockout risk', agent: 'INVENTORY_AGENT', purpose: 'Flags products that will sell out at current velocity', threshold: `≤ ${options.stockoutDays} days of cover`, inputs: ['products.inventory_units', 'products.average_daily_units', 'products.unit_price'], impact: 'Revenue at risk before restock' },
    { id: 'DEAD_STOCK', name: 'Dead stock', agent: 'INVENTORY_AGENT', purpose: 'Finds inventory with zero sales locking up cash', threshold: `${options.deadStockDays} days without a sale`, inputs: ['products.units_sold_120d', 'products.last_sold_at', 'products.inventory_units'], impact: 'Inventory value at risk' },
    { id: 'CHURN_RISK', name: 'Churn risk', agent: 'CUSTOMER_AGENT', purpose: 'Detects high-value customers going quiet', threshold: `LTV ≥ ${options.highLtvThreshold} and ${options.churnDays}+ days inactive`, inputs: ['customers.lifetime_value', 'customers.last_order_at'], impact: 'Customer LTV at risk' },
    { id: 'PRICING_UPLIFT', name: 'Pricing uplift', agent: 'PRICING_AGENT', purpose: 'Spots margin-safe price test candidates', threshold: `margin ≥ ${Math.round(options.minimumMargin * 100)}% with active demand`, inputs: ['products.unit_price', 'products.unit_cost', 'products.average_daily_units'], impact: 'Modeled 30-day uplift' },
    { id: 'REPEAT_PURCHASE', name: 'Repeat purchase', agent: 'CUSTOMER_AGENT', purpose: 'Times reorder nudges for returning customers', threshold: `${options.repeatPurchaseDays}+ days past reorder window`, inputs: ['customers.order_count', 'customers.last_order_at'], impact: 'Modeled next order value' },
    { id: 'CART_ABANDONMENT', name: 'Cart abandonment', agent: 'CUSTOMER_AGENT', purpose: 'Recovers checkouts inside the winnable window', threshold: '1–48 hours old, not recovered', inputs: ['checkouts.total', 'checkouts.created_at'], impact: `Expected recovery at ${Math.round(options.cartRecoveryRate * 100)}%` },
    { id: 'CROSS_SELL', name: 'Cross-sell pairs', agent: 'PRODUCT_AGENT', purpose: 'Pairs products customers already buy together', threshold: `co-purchase rate ≥ ${Math.round(options.crossSellRate * 100)}%`, inputs: ['orders.product_pairs'], impact: 'Modeled basket value' },
    { id: 'NEW_CUSTOMER_WELCOME', name: 'New customer welcome', agent: 'CUSTOMER_AGENT', purpose: 'Welcomes first orders while they are fresh', threshold: `first order within ${options.welcomeDays} days`, inputs: ['customers.order_count', 'customers.last_order_at'], impact: 'First-order value' },
    { id: 'REVENUE_SPIKE', name: 'Revenue spike', agent: 'REVENUE_AGENT', purpose: 'Explains positive revenue momentum so it can be doubled down on', threshold: `30-day revenue up ≥ ${Math.round(options.momentumThreshold * 100)}%`, inputs: ['analytics.last_30d_revenue', 'analytics.previous_30d_revenue'], impact: 'Period-over-period gain' },
    { id: 'REVENUE_DROP', name: 'Revenue drop', agent: 'REVENUE_AGENT', purpose: 'Flags negative revenue momentum before it compounds', threshold: `30-day revenue down ≥ ${Math.round(options.momentumThreshold * 100)}%`, inputs: ['analytics.last_30d_revenue', 'analytics.previous_30d_revenue'], impact: 'Period-over-period loss' },
    { id: 'WEEKLY_HEALTH_DIGEST', name: 'Weekly health digest', agent: 'EXECUTIVE_AGENT', purpose: 'Summarizes the deterministic store health score for the merchant', threshold: 'Health score computable from closed periods', inputs: ['health.score', 'health.components'], impact: 'Store health awareness' },
  ]
}

export function runDeterministicRules(snapshot: StoreSnapshot, config: Partial<RuleConfig> = {}): readonly RuleSignal[] {
  const options = { ...DEFAULTS, ...config }
  const signals = [
    ...stockoutSignals(snapshot, options),
    ...deadStockSignals(snapshot, options),
    ...churnSignals(snapshot, options),
    ...pricingSignals(snapshot, options),
    ...repeatSignals(snapshot, options),
    ...cartSignals(snapshot, options),
    ...crossSellSignals(snapshot, options),
    ...welcomeSignals(snapshot, options),
    ...revenueMomentumSignals(snapshot, options),
    ...healthDigestSignals(snapshot),
  ]
  return signals.sort((left, right) => right.impactValue - left.impactValue)
}

function revenueMomentumSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  if (snapshot.previous30dRevenue <= 0 || snapshot.last30dRevenue < 0) return []
  const change = (snapshot.last30dRevenue - snapshot.previous30dRevenue) / snapshot.previous30dRevenue
  const evidence = [
    { key: 'last_30d_revenue', label: 'Last 30-day revenue', value: round(snapshot.last30dRevenue), source: 'analytics.revenue_daily' },
    { key: 'previous_30d_revenue', label: 'Previous 30-day revenue', value: round(snapshot.previous30dRevenue), source: 'analytics.revenue_daily' },
    { key: 'change_percent', label: 'Period change percent', value: round(change * 100), source: 'analytics.revenue_daily' },
    { key: 'last_30d_orders', label: 'Last 30-day orders', value: snapshot.last30dOrders, source: 'analytics.orders_daily' },
  ] as const
  if (change >= config.momentumThreshold) {
    return [signal('REVENUE_SPIKE', 'REVENUE_AGENT', 'Revenue is accelerating — protect the streak', `Closed-period revenue is up ${format(change * 100)}% versus the previous 30 days.`, snapshot.last30dRevenue - snapshot.previous30dRevenue, 'period-over-period gain', snapshot.currency, .85, 'CREATE_RECOMMENDATION', 'revenue:30d', [...evidence])]
  }
  if (change <= -config.momentumThreshold) {
    return [signal('REVENUE_DROP', 'REVENUE_AGENT', 'Revenue momentum is slipping', `Closed-period revenue is down ${format(Math.abs(change) * 100)}% versus the previous 30 days.`, snapshot.previous30dRevenue - snapshot.last30dRevenue, 'period-over-period loss', snapshot.currency, .85, 'INTERNAL_ALERT', 'revenue:30d', [...evidence])]
  }
  return []
}

function healthDigestSignals(snapshot: StoreSnapshot): RuleSignal[] {
  const health = calculateStoreHealth(snapshot)
  if (health.score === null) return []
  const componentEvidence = health.components.filter((component) => component.score !== null).map((component) => ({ key: component.key, label: component.reason, value: component.score, source: `health.${component.key}` }))
  return [signal('WEEKLY_HEALTH_DIGEST', 'EXECUTIVE_AGENT', 'Weekly store health digest', `The deterministic health score for this store is ${health.score} out of 100.`, health.score, 'health score out of 100', snapshot.currency, .8, 'INTERNAL_ALERT', `health:${weekKey(snapshot.asOf)}`, [{ key: 'health_score', label: 'Store health score', value: health.score, source: 'health.deterministic-v1' }, ...componentEvidence])]
}

function weekKey(asOf: string): string {
  const date = new Date(asOf)
  const day = Number.isFinite(date.valueOf()) ? date : new Date()
  const year = day.getUTCFullYear()
  const start = Date.UTC(year, 0, 1)
  const week = Math.floor((day.valueOf() - start) / (7 * 86_400_000))
  return `${year}-w${week}`
}


function stockoutSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  return snapshot.products.filter((product) => product.averageDailyUnits > 0 && product.inventoryUnits / product.averageDailyUnits <= config.stockoutDays).map((product) => {
    const days = product.inventoryUnits / product.averageDailyUnits
    return signal('STOCKOUT_RISK', 'INVENTORY_AGENT', `Reorder ${product.title} before stockout`, `${product.title} has ${format(days)} days of cover at current velocity.`, Math.max(0, config.stockoutDays - days) * product.averageDailyUnits * product.unitPrice, 'revenue at risk', snapshot.currency, .9, 'CREATE_RECOMMENDATION', product.productId, [{ key: 'days_of_cover', label: 'Days of cover', value: round(days), source: 'products.inventory_units / products.average_daily_units' }, { key: 'average_daily_units', label: 'Average daily units', value: product.averageDailyUnits, source: 'products.average_daily_units' }])
  })
}

function deadStockSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  // Guard against data starvation: a store with no sales evidence at all must
  // not flag its entire catalog as dead stock. Require observed sales history
  // somewhere in the store and units actually on hand for the product.
  const storeHasSalesEvidence = snapshot.products.some((product) => product.unitsSold120d > 0) || snapshot.last30dOrders > 0 || snapshot.previous30dOrders > 0
  if (!storeHasSalesEvidence) return []
  return snapshot.products.filter((product) => product.inventoryUnits > 0 && product.unitsSold120d === 0 && (product.daysSinceLastSale ?? config.deadStockDays) >= config.deadStockDays).map((product) => signal('DEAD_STOCK', 'INVENTORY_AGENT', `Unlock cash in ${product.title}`, `${product.title} has had zero sales across the last ${config.deadStockDays} days.`, product.inventoryUnits * product.unitPrice, 'inventory value at risk', snapshot.currency, .86, 'CREATE_RECOMMENDATION', product.productId, [{ key: 'days_without_sale', label: 'Days without sale', value: product.daysSinceLastSale ?? config.deadStockDays, source: 'products.last_sold_at' }, { key: 'units_on_hand', label: 'Units on hand', value: product.inventoryUnits, source: 'products.inventory_units' }]))
}

function churnSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  return snapshot.customers.filter((customer) => customer.lifetimeValue >= config.highLtvThreshold && customer.daysSinceLastOrder >= config.churnDays).map((customer) => signal('CHURN_RISK', 'CUSTOMER_AGENT', 'Win back a high-value customer', `A high-LTV customer has been inactive for ${customer.daysSinceLastOrder} days.`, customer.lifetimeValue, 'customer LTV at risk', snapshot.currency, .88, 'SEND_EMAIL', customer.customerKey, [{ key: 'lifetime_value', label: 'Lifetime value', value: customer.lifetimeValue, source: 'customers.lifetime_value' }, { key: 'days_inactive', label: 'Days inactive', value: customer.daysSinceLastOrder, source: 'customers.last_order_at' }]))
}

function pricingSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  return snapshot.products.filter((product) => product.unitCost !== null && product.unitPrice > 0 && (product.unitPrice - (product.unitCost ?? 0)) / product.unitPrice >= config.minimumMargin && product.averageDailyUnits > 0).map((product) => {
    const uplift = product.averageDailyUnits * 30 * product.unitPrice * .05
    return signal('PRICING_UPLIFT', 'PRICING_AGENT', `Test a measured uplift on ${product.title}`, `${product.title} clears the configured margin floor with active demand.`, uplift, 'modeled 30-day uplift', snapshot.currency, .64, 'CREATE_RECOMMENDATION', product.productId, [{ key: 'margin', label: 'Current gross margin', value: round((product.unitPrice - (product.unitCost ?? 0)) / product.unitPrice), source: 'products.unit_price - products.unit_cost' }, { key: 'average_daily_units', label: 'Average daily units', value: product.averageDailyUnits, source: 'products.average_daily_units' }])
  })
}

function repeatSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  return snapshot.customers.filter((customer) => customer.orderCount > 1 && customer.daysSinceLastOrder >= config.repeatPurchaseDays).map((customer) => signal('REPEAT_PURCHASE', 'CUSTOMER_AGENT', 'Invite a repeat purchase', `A returning customer is outside their ${config.repeatPurchaseDays}-day reorder window.`, customer.lifetimeValue / customer.orderCount, 'modeled next order value', snapshot.currency, .7, 'SEND_EMAIL', customer.customerKey, [{ key: 'order_count', label: 'Order count', value: customer.orderCount, source: 'customers.order_count' }, { key: 'days_since_order', label: 'Days since order', value: customer.daysSinceLastOrder, source: 'customers.last_order_at' }]))
}

function cartSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  return snapshot.checkouts.filter((checkout) => !checkout.recovered && checkout.ageHours >= 1 && checkout.ageHours <= 48).map((checkout) => signal('CART_ABANDONMENT', 'CUSTOMER_AGENT', 'Recover an abandoned checkout', `A checkout is still within the ${checkout.ageHours}-hour recovery window.`, checkout.total * config.cartRecoveryRate, 'expected recovery', snapshot.currency, .72, 'SEND_EMAIL', checkout.checkoutKey, [{ key: 'checkout_total', label: 'Checkout total', value: checkout.total, source: 'checkouts.total' }, { key: 'age_hours', label: 'Checkout age in hours', value: checkout.ageHours, source: 'checkouts.created_at' }]))
}

function crossSellSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  return snapshot.productPairs.filter((pair) => pair.coPurchaseRate >= config.crossSellRate).map((pair) => signal('CROSS_SELL', 'PRODUCT_AGENT', 'Pair products that already travel together', `The observed co-purchase rate is ${round(pair.coPurchaseRate * 100)}%, above the configured threshold.`, pair.relatedProductPrice * pair.coPurchaseRate, 'modeled basket value', snapshot.currency, .67, 'CREATE_RECOMMENDATION', pair.productId, [{ key: 'co_purchase_rate', label: 'Co-purchase rate', value: pair.coPurchaseRate, source: 'orders.product_pairs' }, { key: 'related_product_id', label: 'Related product', value: pair.relatedProductId, source: 'orders.product_pairs' }]))
}

function welcomeSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  return snapshot.customers.filter((customer) => customer.orderCount === 1 && customer.daysSinceLastOrder <= config.welcomeDays).map((customer) => signal('NEW_CUSTOMER_WELCOME', 'CUSTOMER_AGENT', 'Welcome a new customer', `This customer placed their first order ${customer.daysSinceLastOrder} days ago.`, customer.lifetimeValue, 'first-order value', snapshot.currency, .8, 'SEND_EMAIL', customer.customerKey, [{ key: 'days_since_order', label: 'Days since first order', value: customer.daysSinceLastOrder, source: 'customers.last_order_at' }, { key: 'order_count', label: 'Order count', value: customer.orderCount, source: 'customers.order_count' }]))
}

function signal(ruleId: RuleSignal['ruleId'], agent: RuleSignal['agent'], title: string, reason: string, impactValue: number, impactLabel: string, currency: string, confidence: number, actionType: RuleSignal['actionType'], entityKey: string | null, evidence: RuleSignal['evidence']): RuleSignal {
  return { ruleId, ruleVersion: RULE_VERSION, agent, title, reason, impactValue: round(Math.max(0, impactValue)), impactLabel, currency, confidence, actionType, actionRisk: actionRisk(actionType), evidence, entityKey }
}

function round(value: number): number { return Math.round(value * 100) / 100 }
function format(value: number): string { return round(value).toString() }
