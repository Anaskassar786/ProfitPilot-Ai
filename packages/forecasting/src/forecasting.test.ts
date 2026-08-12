import { describe, expect, it } from 'vitest'
import { blendedDailyVelocity, daysOfCover, forecastRevenue, stockoutRisk } from './index.js'

describe('honest forecasting formulas', () => {
  it('computes days of cover', () => expect(daysOfCover(20, 4)).toBe(5))
  it('returns unknown cover for zero velocity', () => expect(daysOfCover(20, 0)).toBeNull())
  it('rejects negative inventory inputs', () => expect(() => daysOfCover(-1, 2)).toThrow('non-negative'))
  it('classifies high stockout risk', () => expect(stockoutRisk(7, 1)).toBe('high'))
  it('classifies medium stockout risk', () => expect(stockoutRisk(10, 1)).toBe('medium'))
  it('classifies low and unknown risk', () => {
    expect(stockoutRisk(30, 1)).toBe('low')
    expect(stockoutRisk(30, 0)).toBe('unknown')
  })
  it('blends 14-day and 30-day velocity with stated weights', () => expect(blendedDailyVelocity(14, 30)).toBeCloseTo(1))
  it('returns a method-stamped revenue band', () => {
    const forecast = forecastRevenue([100, 120, 140])
    expect(forecast.value).toBe(120)
    expect(forecast.method.version).toBe('1.0.0')
    expect(forecast.lower).toBeLessThan(forecast.value)
  })
  it('requires at least two closed periods', () => expect(() => forecastRevenue([100])).toThrow('two'))
})
