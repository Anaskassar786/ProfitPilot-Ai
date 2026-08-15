import type { OrderFact, OrderLineFact } from './analytics.js'
import type { SyncRecord } from './sync.js'

/**
 * Reads both the normalized resource shape and the legacy
 * `{ id, payload: JSON.stringify(resource) }` shape. The latter keeps existing
 * order rows usable while a fresh sync repairs them in place.
 */
export function normalizePersistedShopifyRecord(value: unknown): SyncRecord {
  if (!isRecord(value)) throw new RangeError('Persisted Shopify record must be an object')
  if (typeof value.payload !== 'string') return value
  try {
    const parsed: unknown = JSON.parse(value.payload)
    if (isRecord(parsed)) return { ...parsed, id: parsed.id ?? value.id }
  } catch {
    // A genuine Shopify resource may itself have a string field named payload.
  }
  return value
}

/** Converts one normalized Shopify REST order into analytics input. */
export function shopifyOrderToFact(value: unknown): OrderFact {
  const order = normalizePersistedShopifyRecord(value)
  const orderId = requiredId(order.id, 'Shopify order')
  const day = isoDay(order.processed_at ?? order.created_at, 'Shopify order processed_at')
  const grossRevenue = money(order.current_total_price ?? order.total_price, 'Shopify order total_price')
  const discounts = optionalMoney(order.current_total_discounts ?? order.total_discounts)
  const lines = Array.isArray(order.line_items) ? order.line_items.flatMap(toLineFact) : []
  const customer = isRecord(order.customer) ? order.customer : null
  const customerId = optionalId(customer?.id)
  const customerCohortDay = customerId && customer?.created_at ? isoDay(customer.created_at, 'Shopify customer created_at') : undefined

  return {
    orderId,
    day,
    grossRevenue,
    discounts,
    fulfilled: order.fulfillment_status === 'fulfilled',
    cancelled: Boolean(order.cancelled_at),
    lines,
    ...(customerId ? { customerId } : {}),
    ...(customerCohortDay ? { customerCohortDay } : {}),
  }
}

function toLineFact(value: unknown): readonly OrderLineFact[] {
  if (!isRecord(value)) return []
  const productId = optionalId(value.product_id)
  if (!productId) return [] // Shopify permits custom line items without a product.
  const units = integer(value.quantity, 'Shopify line item quantity')
  const price = money(value.price, 'Shopify line item price')
  return [{ productId, units, grossRevenue: price * units }]
}

function requiredId(value: unknown, label: string): string {
  const id = optionalId(value)
  if (!id) throw new RangeError(`${label} is missing a stable id`)
  return id
}

function optionalId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const id = String(value).trim()
  return id || undefined
}

function isoDay(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new RangeError(`${label} is invalid`)
  const day = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0]
  if (!day) throw new RangeError(`${label} is invalid`)
  return day
}

function money(value: unknown, label: string): number {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`${label} must be finite and non-negative`)
  return amount
}

function optionalMoney(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0
  return money(value, 'Shopify order total_discounts')
}

function integer(value: unknown, label: string): number {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`${label} must be a non-negative integer`)
  return amount
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
