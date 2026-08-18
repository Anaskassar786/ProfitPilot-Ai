/**
 * PR #49 — industry benchmark position service.
 *
 * The percentile ladders live in `ai_executive_benchmarks` (curated public
 * sources in Phase 1). This module turns the merchant's REAL store metrics
 * into a position: your value, the industry median, the top-10% target, the
 * interpolated percentile rank, and the gap to the next tier.
 *
 * The merchant's own values are computed from synced store rows — when a
 * metric cannot be measured (no orders, no customers, no catalog) it is
 * reported as missing instead of being invented.
 */
import type { AnalyticsSnapshot, CatalogProduct } from '@profitpilot/db'
import type { StoreSnapshot } from '@profitpilot/ai'
import type { StoreId } from '@profitpilot/types'
import {
  EXECUTIVE_BENCHMARK_CATEGORIES,
  EXECUTIVE_BENCHMARK_METRICS,
} from './executive-model.js'
import type {
  BenchmarkLadder,
  BenchmarkMetricPosition,
  BenchmarkPosition,
  ExecutiveBenchmarkCategory,
  ExecutiveBenchmarkMetric,
  ExecutiveBenchmarkRow,
} from './executive-model.js'
import { benchmarkPercentile } from './executive-analytics.js'

export const BENCHMARK_METRIC_LABELS: Readonly<Record<ExecutiveBenchmarkMetric, string>> = {
  REVENUE: 'Monthly revenue per store',
  AOV: 'Average order value',
  CONVERSION: 'Conversion rate',
  REPEAT_PURCHASE: 'Repeat purchase rate',
  CAC: 'Customer acquisition cost',
  INVENTORY_TURNOVER: 'Inventory turnover',
  RETURN_RATE: 'Return rate',
}

/** Groups benchmark rows into per-metric percentile ladders. */
export function laddersFromRows(rows: readonly ExecutiveBenchmarkRow[]): readonly BenchmarkLadder[] {
  const byMetric = new Map<string, ExecutiveBenchmarkRow[]>()
  for (const row of rows) {
    const key = row.metric
    const list = byMetric.get(key) ?? []
    list.push(row)
    byMetric.set(key, list)
  }
  return EXECUTIVE_BENCHMARK_METRICS
    .filter((metric) => byMetric.has(metric))
    .map((metric) => {
      const rowsForMetric = (byMetric.get(metric) ?? []).sort((left, right) => left.value - right.value)
      return {
        metric,
        points: rowsForMetric.map((row) => ({ percentile: row.percentile, value: row.value })),
        currency: rowsForMetric.find((row) => row.currency !== null)?.currency ?? null,
        sourceLabel: rowsForMetric[0]?.sourceLabel ?? '',
      }
    })
}

/** The merchant's own measured value for each benchmark metric. */
export function merchantMetricValues(snapshot: StoreSnapshot, analytics: AnalyticsSnapshot, catalog: readonly CatalogProduct[]): Readonly<Record<string, number>> {
  const values: Record<string, number> = {}
  const last30Revenue = Math.max(snapshot.last30dRevenue, 0)
  const last30Orders = Math.max(snapshot.last30dOrders, 0)
  const totalOrders = analytics.orders.reduce((sum, row) => sum + row.orderCount, 0)
  const totalRevenue = analytics.revenue.reduce((sum, row) => sum + row.grossRevenue, 0)

  if (last30Revenue > 0) values.REVENUE = last30Revenue
  if (last30Orders > 0 && last30Revenue > 0) values.AOV = last30Revenue / last30Orders
  if (totalOrders > 0) {
    const cancellations = analytics.orders.reduce((sum, row) => sum + row.cancelledCount, 0)
    const returnsProxy = cancellations / totalOrders
    values.RETURN_RATE = returnsProxy * 100
  }
  if (snapshot.customers.length > 0) {
    const repeats = snapshot.customers.filter((customer) => customer.orderCount >= 2).length
    values.REPEAT_PURCHASE = (repeats / snapshot.customers.length) * 100
  }
  if (analytics.productSales.length > 0 && snapshot.products.length > 0) {
    let cogs = 0
    let inventoryValue = 0
    for (const product of snapshot.products) {
      const cost = product.unitCost ?? product.unitPrice
      const sold = analytics.productSales.filter((row) => row.productId === product.productId).reduce((sum, row) => sum + row.unitsSold, 0)
      cogs += sold * cost
      inventoryValue += product.inventoryUnits * cost
    }
    if (cogs > 0 && inventoryValue > 0) values.INVENTORY_TURNOVER = (cogs * 12) / inventoryValue
  }
  if (catalog.length > 0 && totalRevenue > 0) {
    // Conversion cannot be measured without sessions. It is deliberately
    // omitted rather than estimated from unrelated data.
    void catalog
  }
  // CAC and CONVERSION require traffic/ad-spend data the sync does not hold;
  // they stay missing until such data exists.
  return values
}

/** Maps Shopify product_type values to a benchmark category. */
export function detectBenchmarkCategory(catalog: readonly CatalogProduct[]): ExecutiveBenchmarkCategory | null {
  const keywords: Readonly<Record<string, ExecutiveBenchmarkCategory>> = {
    apparel: 'Fashion & Apparel', clothing: 'Fashion & Apparel', fashion: 'Fashion & Apparel', shoes: 'Fashion & Apparel',
    electronic: 'Electronics', tech: 'Electronics', gadget: 'Electronics', audio: 'Electronics',
    home: 'Home & Garden', garden: 'Home & Garden', furniture: 'Home & Garden', decor: 'Home & Garden', kitchen: 'Home & Garden',
    beauty: 'Beauty & Health', health: 'Beauty & Health', skincare: 'Beauty & Health', cosmetics: 'Beauty & Health', wellness: 'Beauty & Health',
    food: 'Food & Beverages', beverage: 'Food & Beverages', coffee: 'Food & Beverages', snack: 'Food & Beverages', drink: 'Food & Beverages',
    sport: 'Sports & Outdoor', outdoor: 'Sports & Outdoor', fitness: 'Sports & Outdoor',
    toy: 'Toys & Games', game: 'Toys & Games', puzzle: 'Toys & Games',
    book: 'Books & Media', media: 'Books & Media', magazine: 'Books & Media',
    jewelry: 'Jewelry & Accessories', jewellery: 'Jewelry & Accessories', accessory: 'Jewelry & Accessories', watch: 'Jewelry & Accessories',
  }
  const counts = new Map<ExecutiveBenchmarkCategory, number>()
  for (const product of catalog) {
    const type = typeof product.payload.product_type === 'string' ? product.payload.product_type.toLowerCase() : ''
    if (!type) continue
    for (const [keyword, category] of Object.entries(keywords)) {
      if (type.includes(keyword)) counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }
  if (counts.size === 0) return null
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]![0]
}

/**
 * Computes the merchant's percentile position per metric. `visibleMetrics`
 * is the plan's metric allowance; trial/start see a prefix of the ladder
 * (the most universal metrics first) and the rest is reported as locked
 * via the returned total count.
 */
export function buildBenchmarkPosition(input: {
  storeId: StoreId
  category: ExecutiveBenchmarkCategory
  categorySource: BenchmarkPosition['categorySource']
  ladders: readonly BenchmarkLadder[]
  merchantValues: Readonly<Record<string, number>>
  visibleMetrics: number
  now?: Date
}): BenchmarkPosition {
  const order = ['REVENUE', 'AOV', 'CONVERSION', 'REPEAT_PURCHASE', 'CAC', 'INVENTORY_TURNOVER', 'RETURN_RATE'] as const
  const sortedLadders = [...input.ladders].sort((left, right) => order.indexOf(left.metric) - order.indexOf(right.metric))
  const visible = sortedLadders.slice(0, Math.max(input.visibleMetrics, 0))
  const positions = visible.map((ladder): BenchmarkMetricPosition => {
    const value = input.merchantValues[ladder.metric]
    const median = ladder.points.find((point) => point.percentile === 50)?.value ?? null
    const top10 = ladder.points.find((point) => point.percentile === 90)?.value ?? null
    const missing = value === undefined || value === null
    const percentile = missing ? null : benchmarkPercentile(ladder.points, value)
    const gapToTop10 = missing || top10 === null || value === undefined || value <= 0 ? null : Math.max(0, (top10 / value - 1) * 100)
    return {
      metric: ladder.metric,
      label: BENCHMARK_METRIC_LABELS[ladder.metric],
      yourValue: missing ? null : value,
      currency: ladder.currency,
      industryMedian: median,
      top10Target: top10,
      percentile: percentile === null ? null : Math.round(percentile),
      gapToTop10Pct: gapToTop10 === null ? null : Math.round(gapToTop10),
      sourceLabel: ladder.sourceLabel,
      yourValueMissing: missing,
    }
  })
  return {
    storeId: input.storeId,
    category: input.category,
    categorySource: input.categorySource,
    positions,
    visibleMetrics: positions.length,
    totalMetrics: sortedLadders.length,
    asOf: (input.now ?? new Date()).toISOString(),
  }
}

export function isBenchmarkCategory(value: string): value is ExecutiveBenchmarkCategory {
  return (EXECUTIVE_BENCHMARK_CATEGORIES as readonly string[]).includes(value)
}
