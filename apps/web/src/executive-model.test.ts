import { describe, expect, it } from 'vitest'
import { EXECUTIVE_FEATURE_NAMES, executiveDateLabel, executiveMonthLabel, executiveRoadmapTypeLabel, executiveStatusTone, executiveTimelineLabel, formatExecutiveMoney, formatExecutiveNumber, formatExecutivePct } from './executive-model.js'

describe('PR49 executive client model helpers', () => {
  it('formats money with the store currency and nulls as dashes', () => {
    expect(formatExecutiveMoney(8400, 'USD', 0)).toBe('$8,400')
    expect(formatExecutiveMoney(8400.5, 'EUR', 2)).toBe('€8,400.5')
    expect(formatExecutiveMoney(null, 'USD', 0)).toBe('—')
  })

  it('formats numbers and percentages without inventing values', () => {
    expect(formatExecutiveNumber(1234.567, 1)).toBe('1,234.6')
    expect(formatExecutiveNumber(null)).toBe('—')
    expect(formatExecutivePct(27.4, 0)).toBe('27%')
    expect(formatExecutivePct(null)).toBe('—')
  })

  it('maps statuses and labels to display values', () => {
    expect(executiveStatusTone('STRONG')).toBe('positive')
    expect(executiveStatusTone('AT_RISK')).toBe('warning')
    expect(executiveStatusTone('CRITICAL')).toBe('danger')
    expect(executiveTimelineLabel('30_DAYS')).toBe('30 days')
    expect(executiveTimelineLabel('LONG_TERM')).toBe('Long term')
    expect(executiveRoadmapTypeLabel('QUARTERLY')).toBe('Quarterly plan')
    expect(EXECUTIVE_FEATURE_NAMES.pdf).toBe('Investor PDF reports')
  })

  it('formats dates in UTC consistently', () => {
    expect(executiveDateLabel('2026-08-01')).toBe('Aug 1, 2026')
    expect(executiveMonthLabel('2026-08-01')).toBe('August 2026')
  })
})
