import './jsdom-polaris-setup.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  AISuggestionCard,
  AutoReorderCard,
  DeadStockCard,
  HistoricalInventoryChart,
  OverstockAlertsCard,
  PredictiveRestockingCard,
  ReorderRecommendationsCard,
  SeasonalTrendsCard,
  StockTurnoverCard,
} from './inventory-insights.js'
import { EMPTY_INVENTORY_INSIGHTS, awaitingMessage, formatCurrency, formatDay, insightByFeature, lockedInsightByFeature, usageLabel } from './inventory-insights-model.js'
import type { InventoryInsightsResult } from './inventory-insights-model.js'

function insights(overrides: Partial<InventoryInsightsResult> = {}): InventoryInsightsResult {
  return { ...EMPTY_INVENTORY_INSIGHTS, plan: 'growth', planLabel: 'Growth', skuCount: 4, usage: { feature: 'inventory_ai_insights_day', used: 3, limit: 20, remaining: 17, limitReached: false }, salesHistory: { days: 120, sufficient: true, missingDays: 0, minimumDays: 30, firstDay: '2026-04-18' }, ...overrides }
}

function withFeature(feature: string, data: unknown, overrides: Partial<InventoryInsightsResult> = {}): InventoryInsightsResult {
  return insights({ available: [{ feature, name: feature, data }], ...overrides })
}

function locked(feature: string, name: string, plan: 'growth' | 'commander'): InventoryInsightsResult {
  return insights({ plan: plan === 'commander' ? 'growth' : 'trial', available: [], locked: [{ locked: true, feature, name, required_plan: plan }] })
}

const noop = vi.fn()

describe('Dead stock card', () => {
  it('renders real frozen products and the stuck value', () => {
    const html = renderToStaticMarkup(createElement(DeadStockCard, {
      insights: withFeature('dead_stock', { status: 'available', items: [{ productId: '7003', title: 'Frozen Item', value: 1000, currency: 'INR', quantity: 40 }], totalStuckValue: 1000, currency: 'INR', windowDays: 90, message: '1 product held stock' }),
      onUpgrade: noop,
    }))
    expect(html).toContain('1 frozen')
    expect(html).toContain('INR 1,000.00')
    expect(html).toContain('Frozen Item')
  })

  it('frames a clean store positively rather than showing an empty list', () => {
    const html = renderToStaticMarkup(createElement(DeadStockCard, { insights: withFeature('dead_stock', { status: 'available', items: [], totalStuckValue: null, windowDays: 90, message: 'All items moving well — every stocked product sold in this window.' }), onUpgrade: noop }))
    expect(html).toContain('All items moving well')
  })

  it('shows the honest awaiting state instead of inventing dead stock', () => {
    const html = renderToStaticMarkup(createElement(DeadStockCard, { insights: withFeature('dead_stock', { status: 'insufficient_data', message: 'Awaiting 28 more days of sales history (2 of 30 recorded).' }), onUpgrade: noop }))
    expect(html).toContain('Awaiting 28 more days of sales history')
    expect(html).not.toMatch(/\d+ frozen/)
  })

  it('renders the locked upgrade CTA for Trial and Start', () => {
    const html = renderToStaticMarkup(createElement(DeadStockCard, { insights: locked('dead_stock', 'Dead Stock Detector', 'growth'), onUpgrade: noop }))
    expect(html).toContain('Dead Stock Detector')
    expect(html).toContain('Upgrade to unlock')
    expect(html).toContain('plan-locked-blur')
  })
})

describe('Reorder, overstock, and turnover cards', () => {
  it('lists reorder quantities from the API', () => {
    const html = renderToStaticMarkup(createElement(ReorderRecommendationsCard, {
      insights: withFeature('reorder_recommendations', { status: 'available', items: [{ productId: '7001', title: 'Fast Mover', suggestedQuantity: 88, currentStock: 20 }], leadTimeDays: 14, message: '1 product' }),
      onUpgrade: noop,
    }))
    expect(html).toContain('1 to reorder')
    expect(html).toContain('+88 units')
    expect(html).toContain('14-day lead time')
  })

  it('says stock is healthy when nothing needs a reorder', () => {
    expect(renderToStaticMarkup(createElement(ReorderRecommendationsCard, { insights: withFeature('reorder_recommendations', { status: 'available', items: [], message: 'Stock levels healthy — nothing is at or below its reorder point.' }), onUpgrade: noop }))).toContain('Stock levels healthy')
  })

  it('quantifies overstock and suggests a promotion', () => {
    const html = renderToStaticMarkup(createElement(OverstockAlertsCard, {
      insights: withFeature('overstock_alerts', { status: 'available', items: [{ productId: '7002', title: 'Slow Mover', excessUnits: 493, excessValue: 19_720 }], totalExcessValue: 19_720, currency: 'INR', message: '1 product' }),
      onUpgrade: noop,
    }))
    expect(html).toContain('1 overstocked')
    expect(html).toContain('INR 19,720.00')
    expect(html).toContain('493 excess')
    expect(html).toContain('promotion')
  })

  it('reports no excess inventory positively', () => {
    expect(renderToStaticMarkup(createElement(OverstockAlertsCard, { insights: withFeature('overstock_alerts', { status: 'available', items: [], message: 'No excess inventory detected — nothing carries more than 90 days of cover.' }), onUpgrade: noop }))).toContain('No excess inventory detected')
  })

  it('splits turnover into fast, medium, and slow movers', () => {
    const html = renderToStaticMarkup(createElement(StockTurnoverCard, {
      insights: withFeature('stock_turnover', { status: 'available', fast: 1, medium: 0, slow: 2, windowDays: 120, topMovers: [{ productId: '7001', title: 'Fast Mover', turnover: 54.75 }], slowMovers: [{ productId: '7002', title: 'Slow Mover', turnover: 0.04 }] }),
      onUpgrade: noop,
    }))
    expect(html).toContain('1 fast')
    expect(html).toContain('2 slow')
    expect(html).toContain('Fast Mover')
    expect(html).toContain('120 days of sales')
  })
})

describe('AI suggestion card', () => {
  it('renders the grounded model text with the PII disclosure', () => {
    const html = renderToStaticMarkup(createElement(AISuggestionCard, { insights: withFeature('ai_suggestion', { status: 'generated', text: 'You have 3 items overstocked. Consider running a promotion.', model: 'free/model' }), onUpgrade: noop }))
    expect(html).toContain('You have 3 items overstocked')
    expect(html).toContain('no product names, customers, or orders are sent to the model')
  })

  it('states that AI is unavailable rather than fabricating advice', () => {
    expect(renderToStaticMarkup(createElement(AISuggestionCard, { insights: withFeature('ai_suggestion', { status: 'unavailable', message: 'AI inventory intelligence is temporarily unavailable.' }), onUpgrade: noop }))).toContain('temporarily unavailable')
  })

  it('reports the daily limit honestly', () => {
    expect(renderToStaticMarkup(createElement(AISuggestionCard, { insights: withFeature('ai_suggestion', { status: 'limit_reached', message: 'Daily AI limit reached. Upgrade your plan or try again tomorrow.' }), onUpgrade: noop }))).toContain('Daily AI limit reached')
  })
})

describe('Commander cards', () => {
  it('shows predicted reorder dates with a confidence level', () => {
    const html = renderToStaticMarkup(createElement(PredictiveRestockingCard, {
      insights: withFeature('predictive_restocking', { status: 'available', method: 'velocity_trend_projection', items: [{ productId: '7001', title: 'Fast Mover', predictedReorderDate: '2026-08-20', confidence: 'high' }] }),
      onUpgrade: noop,
    }))
    expect(html).toContain('1 projected')
    expect(html).toContain('high')
  })

  it('keeps predictive restocking locked for Growth with a Commander CTA', () => {
    const html = renderToStaticMarkup(createElement(PredictiveRestockingCard, { insights: locked('predictive_restocking', 'Predictive Restocking', 'commander'), onUpgrade: noop }))
    expect(html).toContain('Upgrade to Commander to unlock')
  })

  it('explains that seasonality needs twelve months of snapshots', () => {
    expect(renderToStaticMarkup(createElement(SeasonalTrendsCard, { insights: withFeature('seasonal_trends', { status: 'insufficient_data', message: 'Available after 12 months of data.' }), onUpgrade: noop }))).toContain('Available after 12 months of data')
  })

  it('presents auto-reorder as manual review only', () => {
    const html = renderToStaticMarkup(createElement(AutoReorderCard, {
      storeId: 'store-1',
      insights: withFeature('auto_reorder', { status: 'available', execution: 'manual_review_only', autonomous: false, items: [{ productId: '7001', title: 'Fast Mover', suggestedQuantity: 88 }], message: '1 product ready for your review.' }),
      onUpgrade: noop,
      onToast: noop,
    }))
    expect(html).toContain('1 awaiting review')
    expect(html).toContain('ProfitPilot never places an order for you')
    expect(html).toContain('Approve reorder for Fast Mover')
    expect(html).toContain('Dismiss reorder for Fast Mover')
  })
})

describe('Historical inventory chart', () => {
  it('locks the chart below Growth', () => {
    const html = renderToStaticMarkup(createElement(HistoricalInventoryChart, { storeId: 'store-1', insights: locked('stock_history', 'Stock History Chart', 'growth'), onUpgrade: noop, onToast: noop }))
    expect(html).toContain('Stock History Chart')
    expect(html).toContain('Upgrade to unlock')
  })

  it('explains the empty chart before any snapshot exists', () => {
    const html = renderToStaticMarkup(createElement(HistoricalInventoryChart, { storeId: 'store-1', insights: withFeature('stock_history', { status: 'insufficient_data' }), onUpgrade: noop, onToast: noop }))
    expect(html).toContain('Building your inventory history')
    expect(html).toContain('Stock history range')
  })
})

describe('insight view helpers', () => {
  it('resolves available and locked features by name', () => {
    const result = withFeature('dead_stock', { status: 'available' }, { locked: [{ locked: true, feature: 'auto_reorder', name: 'Auto-Reorder Suggestions', required_plan: 'commander' }] })
    expect(insightByFeature(result, 'dead_stock')?.feature).toBe('dead_stock')
    expect(lockedInsightByFeature(result, 'auto_reorder')?.required_plan).toBe('commander')
    expect(lockedInsightByFeature(result, 'dead_stock')).toBeNull()
  })

  it('formats money, days, and usage without inventing values', () => {
    expect(formatCurrency(1234.5, 'INR')).toBe('INR 1,234.50')
    expect(formatCurrency(null, 'INR')).toBe('—')
    expect(formatDay(null)).toBe('—')
    expect(usageLabel(insights())).toBe('3 of 20 AI insights used today')
    expect(usageLabel(insights({ plan: 'commander', usage: { feature: 'inventory_ai_insights_day', used: 42, limit: null, remaining: null, limitReached: false } }))).toBe('Unlimited AI insights')
    expect(awaitingMessage({ message: 'Awaiting more sales history.' }, 'fallback')).toBe('Awaiting more sales history.')
    expect(awaitingMessage(null, 'fallback')).toBe('fallback')
  })
})
