import { describe, expect, it } from 'vitest'
import { forecastDemand, forecastRfm, forecastStockout, forecastWeeklySeasonality } from './index.js'

describe('F8 deterministic forecast formulas', () => {
  it('applies weekly seasonality with uncertainty bands and method stamp', () => {
    const result = forecastWeeklySeasonality([100, 120, 140])
    expect(result.value).toBe(140)
    expect(result.upper).toBeGreaterThanOrEqual(result.value)
    expect(result.method.method).toContain('seasonality')
    expect(result.seasonalityIndex).toBeGreaterThan(1)
  })
  it('blends demand velocity for a 14-day horizon', () => {
    const result = forecastDemand(14, 30, 14)
    expect(result.value).toBe(14)
    expect(result.lower).toBeLessThanOrEqual(result.value)
    expect(result.method.version).toBe('1.0.0')
    expect(() => forecastDemand(1, 1, 0)).toThrow('positive')
  })
  it('calculates stockout risk without inventing zero-velocity demand', () => {
    expect(forecastStockout(10, 14, 30).risk).toBe('medium')
    expect(forecastStockout(20, 0, 0).daysOfCover).toBeNull()
  })
  it('segments RFM customers deterministically', () => {
    expect(forecastRfm({ customerKey: 'c1', recencyDays: 10, frequency: 4, monetaryValue: 300 }).segment).toBe('CHAMPION')
    expect(forecastRfm({ customerKey: 'c2', recencyDays: 130, frequency: 1, monetaryValue: 20 }).segment).toBe('DORMANT')
    expect(forecastRfm({ customerKey: 'c3', recencyDays: 90, frequency: 2, monetaryValue: 80 }).segment).toBe('AT_RISK')
    expect(() => forecastRfm({ customerKey: 'c4', recencyDays: -1, frequency: 1, monetaryValue: 1 })).toThrow('non-negative')
  })
})
