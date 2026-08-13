export type MethodStamp = Readonly<{ method: string; version: string }>
export type StockoutRisk = 'high' | 'medium' | 'low' | 'unknown'
export type RevenueForecast = Readonly<{ value: number; lower: number; upper: number; method: MethodStamp }>

export const STOCKOUT_METHOD: MethodStamp = { method: 'days-of-cover', version: '1.0.0' }
export const REVENUE_METHOD: MethodStamp = { method: 'weekly-mean-plus-uncertainty-band', version: '1.0.0' }

export function daysOfCover(onHand: number, averageDailyUnits: number): number | null {
  if (!Number.isFinite(onHand) || onHand < 0 || !Number.isFinite(averageDailyUnits) || averageDailyUnits < 0) throw new RangeError('Inventory values must be finite and non-negative')
  if (averageDailyUnits === 0) return null
  return onHand / averageDailyUnits
}

export function stockoutRisk(onHand: number, averageDailyUnits: number): StockoutRisk {
  const days = daysOfCover(onHand, averageDailyUnits)
  if (days === null) return 'unknown'
  if (days <= 7) return 'high'
  if (days <= 14) return 'medium'
  return 'low'
}

export function blendedDailyVelocity(units14d: number, units30d: number): number {
  if (units14d < 0 || units30d < 0) throw new RangeError('Velocity values must be non-negative')
  return (units14d / 14) * 0.6 + (units30d / 30) * 0.4
}

export function forecastRevenue(closedWeeklyRevenue: readonly number[]): RevenueForecast {
  if (closedWeeklyRevenue.length < 2 || closedWeeklyRevenue.some((value) => !Number.isFinite(value) || value < 0)) throw new RangeError('At least two closed non-negative weeks are required')
  const mean = closedWeeklyRevenue.reduce((sum, value) => sum + value, 0) / closedWeeklyRevenue.length
  const variance = closedWeeklyRevenue.reduce((sum, value) => sum + (value - mean) ** 2, 0) / closedWeeklyRevenue.length
  const deviation = Math.sqrt(variance)
  return { value: mean, lower: Math.max(0, mean - deviation), upper: mean + deviation, method: REVENUE_METHOD }
}
