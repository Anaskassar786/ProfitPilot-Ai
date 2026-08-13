import { blendedDailyVelocity, daysOfCover, forecastRevenue, STOCKOUT_METHOD } from './formulas.js'
import type { MethodStamp, RevenueForecast, StockoutRisk } from './formulas.js'

export type DemandForecast = Readonly<{ horizonDays: number; value: number; lower: number; upper: number; dailyVelocity: number; method: MethodStamp }>
export type StockoutForecast = Readonly<{ daysOfCover: number | null; risk: StockoutRisk; method: MethodStamp }>
export type RfmSegment = 'CHAMPION' | 'LOYAL' | 'NEW' | 'AT_RISK' | 'DORMANT' | 'NEEDS_ATTENTION'
export type RfmInput = Readonly<{ customerKey: string; recencyDays: number; frequency: number; monetaryValue: number }>
export type RfmForecast = Readonly<{ customerKey: string; segment: RfmSegment; churnRisk: number; method: MethodStamp }>
export type RevenueSeasonalityForecast = RevenueForecast & Readonly<{ seasonalityIndex: number }>

export const DEMAND_METHOD: MethodStamp = { method: '14d-30d-velocity-blend', version: '1.0.0' }
export const RFM_METHOD: MethodStamp = { method: 'rfm-recency-frequency-monetary-segmentation', version: '1.0.0' }
export const CHURN_METHOD: MethodStamp = { method: 'recency-decay-churn-risk', version: '1.0.0' }

export function forecastWeeklySeasonality(closedWeeklyRevenue: readonly number[]): RevenueSeasonalityForecast {
  const base = forecastRevenue(closedWeeklyRevenue)
  const mean = base.value
  const last = closedWeeklyRevenue[closedWeeklyRevenue.length - 1] ?? mean
  const seasonalityIndex = mean === 0 ? 1 : last / mean
  return { ...base, value: round(mean * seasonalityIndex), lower: round(Math.max(0, base.lower * seasonalityIndex)), upper: round(base.upper * seasonalityIndex), method: { method: 'weekly-seasonality-plus-uncertainty-band', version: '1.0.0' }, seasonalityIndex: round(seasonalityIndex) }
}

export function forecastDemand(units14d: number, units30d: number, horizonDays: number): DemandForecast {
  if (!Number.isInteger(horizonDays) || horizonDays < 1) throw new RangeError('Demand horizon must be a positive integer')
  const dailyVelocity = blendedDailyVelocity(units14d, units30d)
  const shortVelocity = units14d / 14
  const longVelocity = units30d / 30
  const uncertainty = Math.abs(shortVelocity - longVelocity) * horizonDays
  return { horizonDays, value: round(dailyVelocity * horizonDays), lower: round(Math.max(0, dailyVelocity * horizonDays - uncertainty)), upper: round(dailyVelocity * horizonDays + uncertainty), dailyVelocity: round(dailyVelocity), method: DEMAND_METHOD }
}

export function forecastStockout(onHand: number, units14d: number, units30d: number): StockoutForecast {
  const velocity = blendedDailyVelocity(units14d, units30d)
  const cover = daysOfCover(onHand, velocity)
  const risk: StockoutRisk = cover === null ? 'unknown' : cover <= 7 ? 'high' : cover <= 14 ? 'medium' : 'low'
  return { daysOfCover: cover === null ? null : round(cover), risk, method: STOCKOUT_METHOD }
}

export function forecastRfm(input: RfmInput): RfmForecast {
  if (!Number.isFinite(input.recencyDays) || input.recencyDays < 0 || !Number.isFinite(input.frequency) || input.frequency < 0 || !Number.isFinite(input.monetaryValue) || input.monetaryValue < 0) throw new RangeError('RFM inputs must be finite and non-negative')
  const segment = input.recencyDays <= 30 && input.frequency >= 3 && input.monetaryValue > 250 ? 'CHAMPION' : input.recencyDays <= 45 && input.frequency >= 2 ? 'LOYAL' : input.frequency <= 1 && input.recencyDays <= 14 ? 'NEW' : input.recencyDays >= 120 ? 'DORMANT' : input.recencyDays >= 75 ? 'AT_RISK' : 'NEEDS_ATTENTION'
  const churnRisk = round(Math.min(1, Math.max(0, (input.recencyDays - 30) / 120)))
  return { customerKey: input.customerKey, segment, churnRisk, method: CHURN_METHOD }
}

function round(value: number): number { return Math.round(value * 100) / 100 }
