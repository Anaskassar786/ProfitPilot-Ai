import type { RuleSignal, StoreSnapshot } from './domain.js'
import { actionRisk } from './domain.js'

export const RULE_VERSION = '1.0.0'
export type RuleConfig = Readonly<{ stockoutDays: number; deadStockDays: number; highLtvThreshold: number; churnDays: number; repeatPurchaseDays: number; cartRecoveryRate: number; crossSellRate: number; welcomeDays: number; minimumMargin: number }>

const DEFAULTS: RuleConfig = { stockoutDays: 7, deadStockDays: 120, highLtvThreshold: 250, churnDays: 75, repeatPurchaseDays: 45, cartRecoveryRate: .11, crossSellRate: .08, welcomeDays: 7, minimumMargin: .55 }

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
  ]
  return signals.sort((left, right) => right.impactValue - left.impactValue)
}

function stockoutSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  return snapshot.products.filter((product) => product.averageDailyUnits > 0 && product.inventoryUnits / product.averageDailyUnits <= config.stockoutDays).map((product) => {
    const days = product.inventoryUnits / product.averageDailyUnits
    return signal('STOCKOUT_RISK', 'INVENTORY_AGENT', `Reorder ${product.title} before stockout`, `${product.title} has ${format(days)} days of cover at current velocity.`, Math.max(0, config.stockoutDays - days) * product.averageDailyUnits * product.unitPrice, 'revenue at risk', snapshot.currency, .9, 'CREATE_RECOMMENDATION', product.productId, [{ key: 'days_of_cover', label: 'Days of cover', value: round(days), source: 'products.inventory_units / products.average_daily_units' }, { key: 'average_daily_units', label: 'Average daily units', value: product.averageDailyUnits, source: 'products.average_daily_units' }])
  })
}

function deadStockSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  return snapshot.products.filter((product) => product.unitsSold120d === 0 && (product.daysSinceLastSale ?? config.deadStockDays) >= config.deadStockDays).map((product) => signal('DEAD_STOCK', 'INVENTORY_AGENT', `Unlock cash in ${product.title}`, `${product.title} has had zero sales across the last ${config.deadStockDays} days.`, product.inventoryUnits * product.unitPrice, 'inventory value at risk', snapshot.currency, .86, 'CREATE_RECOMMENDATION', product.productId, [{ key: 'days_without_sale', label: 'Days without sale', value: product.daysSinceLastSale ?? config.deadStockDays, source: 'products.last_sold_at' }, { key: 'units_on_hand', label: 'Units on hand', value: product.inventoryUnits, source: 'products.inventory_units' }]))
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
  return snapshot.checkouts.filter((checkout) => !checkout.recovered && checkout.ageHours >= 1 && checkout.ageHours <= 48).map((checkout) => signal('CART_ABANDONMENT', 'CAMPAIGN_AGENT', 'Recover an abandoned checkout', `A checkout is still within the ${checkout.ageHours}-hour recovery window.`, checkout.total * config.cartRecoveryRate, 'expected recovery', snapshot.currency, .72, 'SEND_EMAIL', checkout.checkoutKey, [{ key: 'checkout_total', label: 'Checkout total', value: checkout.total, source: 'checkouts.total' }, { key: 'age_hours', label: 'Checkout age in hours', value: checkout.ageHours, source: 'checkouts.created_at' }]))
}

function crossSellSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  return snapshot.productPairs.filter((pair) => pair.coPurchaseRate >= config.crossSellRate).map((pair) => signal('CROSS_SELL', 'PRODUCT_AGENT', 'Pair products that already travel together', `The observed co-purchase rate is ${round(pair.coPurchaseRate * 100)}%, above the configured threshold.`, pair.relatedProductPrice * pair.coPurchaseRate, 'modeled basket value', snapshot.currency, .67, 'CREATE_RECOMMENDATION', pair.productId, [{ key: 'co_purchase_rate', label: 'Co-purchase rate', value: pair.coPurchaseRate, source: 'orders.product_pairs' }, { key: 'related_product_id', label: 'Related product', value: pair.relatedProductId, source: 'orders.product_pairs' }]))
}

function welcomeSignals(snapshot: StoreSnapshot, config: RuleConfig): RuleSignal[] {
  return snapshot.customers.filter((customer) => customer.orderCount === 1 && customer.daysSinceLastOrder <= config.welcomeDays).map((customer) => signal('NEW_CUSTOMER_WELCOME', 'CAMPAIGN_AGENT', 'Welcome a new customer', `This customer placed their first order ${customer.daysSinceLastOrder} days ago.`, customer.lifetimeValue, 'first-order value', snapshot.currency, .8, 'SEND_EMAIL', customer.customerKey, [{ key: 'days_since_order', label: 'Days since first order', value: customer.daysSinceLastOrder, source: 'customers.last_order_at' }, { key: 'order_count', label: 'Order count', value: customer.orderCount, source: 'customers.order_count' }]))
}

function signal(ruleId: RuleSignal['ruleId'], agent: RuleSignal['agent'], title: string, reason: string, impactValue: number, impactLabel: string, currency: string, confidence: number, actionType: RuleSignal['actionType'], entityKey: string | null, evidence: RuleSignal['evidence']): RuleSignal {
  return { ruleId, ruleVersion: RULE_VERSION, agent, title, reason, impactValue: round(Math.max(0, impactValue)), impactLabel, currency, confidence, actionType, actionRisk: actionRisk(actionType), evidence, entityKey }
}

function round(value: number): number { return Math.round(value * 100) / 100 }
function format(value: number): string { return round(value).toString() }
