import type { StoreId } from '@profitpilot/types'
import type { AnalyticsSnapshot, CustomerCohortMetric, OrdersMetric, ProductSalesMetric, RevenueMetric } from '@profitpilot/db'

export type OrderLineFact = Readonly<{ productId: string; units: number; grossRevenue: number }>
export type OrderFact = Readonly<{ orderId: string; day: string; grossRevenue: number; discounts: number; fulfilled: boolean; cancelled: boolean; lines: readonly OrderLineFact[]; customerId?: string; customerCohortDay?: string }>

export function aggregateOrderFacts(storeId: StoreId, facts: readonly OrderFact[]): AnalyticsSnapshot {
  const revenue = new Map<string, { grossRevenue: number; discounts: number; orderCount: number }>()
  const orders = new Map<string, { orderCount: number; fulfilledCount: number; cancelledCount: number; grossRevenue: number }>()
  const productSales = new Map<string, { day: string; productId: string; unitsSold: number; grossRevenue: number }>()
  const cohorts = new Map<string, { cohortDay: string; activityDay: string; customers: Set<string>; grossRevenue: number }>()
  const orderIds = new Set<string>()

  for (const fact of facts) {
    validateFact(fact)
    if (orderIds.has(fact.orderId)) continue
    orderIds.add(fact.orderId)
    const revenueRow = revenue.get(fact.day) ?? { grossRevenue: 0, discounts: 0, orderCount: 0 }
    revenue.set(fact.day, { grossRevenue: revenueRow.grossRevenue + fact.grossRevenue, discounts: revenueRow.discounts + fact.discounts, orderCount: revenueRow.orderCount + 1 })
    const orderRow = orders.get(fact.day) ?? { orderCount: 0, fulfilledCount: 0, cancelledCount: 0, grossRevenue: 0 }
    orders.set(fact.day, { orderCount: orderRow.orderCount + 1, fulfilledCount: orderRow.fulfilledCount + (fact.fulfilled ? 1 : 0), cancelledCount: orderRow.cancelledCount + (fact.cancelled ? 1 : 0), grossRevenue: orderRow.grossRevenue + fact.grossRevenue })
    for (const line of fact.lines) {
      const key = `${fact.day}:${line.productId}`
      const productRow = productSales.get(key) ?? { day: fact.day, productId: line.productId, unitsSold: 0, grossRevenue: 0 }
      productSales.set(key, { ...productRow, unitsSold: productRow.unitsSold + line.units, grossRevenue: productRow.grossRevenue + line.grossRevenue })
    }
    if (fact.customerId && fact.customerCohortDay) {
      const key = `${fact.customerCohortDay}:${fact.day}`
      const cohort = cohorts.get(key) ?? { cohortDay: fact.customerCohortDay, activityDay: fact.day, customers: new Set<string>(), grossRevenue: 0 }
      cohort.customers.add(fact.customerId)
      cohort.grossRevenue += fact.grossRevenue
      cohorts.set(key, cohort)
    }
  }

  const revenueRows: readonly RevenueMetric[] = [...revenue.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, row]) => ({ storeId, day, ...row }))
  const orderRows: readonly OrdersMetric[] = [...orders.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, row]) => ({ storeId, day, orderCount: row.orderCount, fulfilledCount: row.fulfilledCount, cancelledCount: row.cancelledCount, averageOrderValue: row.grossRevenue / row.orderCount }))
  const productRows: readonly ProductSalesMetric[] = [...productSales.values()].sort((left, right) => `${left.day}:${left.productId}`.localeCompare(`${right.day}:${right.productId}`)).map((row) => ({ storeId, ...row }))
  const cohortRows: readonly CustomerCohortMetric[] = [...cohorts.values()].sort((left, right) => `${left.activityDay}:${left.cohortDay}`.localeCompare(`${right.activityDay}:${right.cohortDay}`)).map((row) => ({ storeId, cohortDay: row.cohortDay, activityDay: row.activityDay, customerCount: row.customers.size, grossRevenue: row.grossRevenue }))
  return { revenue: revenueRows, orders: orderRows, productSales: productRows, customerCohorts: cohortRows }
}

function validateFact(fact: OrderFact): void {
  if (!fact.orderId.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(fact.day)) throw new RangeError('Order fact requires an id and ISO day')
  if (!Number.isFinite(fact.grossRevenue) || fact.grossRevenue < 0 || !Number.isFinite(fact.discounts) || fact.discounts < 0) throw new RangeError('Order revenue values must be finite and non-negative')
  for (const line of fact.lines) {
    if (!line.productId.trim() || !Number.isInteger(line.units) || line.units < 0 || !Number.isFinite(line.grossRevenue) || line.grossRevenue < 0) throw new RangeError('Order line values are invalid')
  }
}
