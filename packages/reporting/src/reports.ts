import { PhaseNotImplementedError } from '@profitpilot/types'

export type ReportFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY'
export type ClosedPeriod = Readonly<{ start: string; end: string }>

export function assertClosedPeriod(period: ClosedPeriod, now = new Date()): void {
  const start = new Date(period.start)
  const end = new Date(period.end)
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start >= end) throw new RangeError('Report period must contain valid ordered dates')
  if (end > now) throw new Error('Reports only support closed periods')
}

export function reportFileName(storeDomain: string, frequency: ReportFrequency, period: ClosedPeriod): string {
  assertClosedPeriod(period)
  const safeStore = storeDomain.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `${safeStore}-${frequency.toLowerCase()}-${period.start.slice(0, 10)}-${period.end.slice(0, 10)}.pdf`
}

export function reportObjectKey(storeDomain: string, frequency: ReportFrequency, period: ClosedPeriod): string {
  return `reports/${storeDomain}/${reportFileName(storeDomain, frequency, period)}`
}

export function generatePdfReport(): never {
  throw new PhaseNotImplementedError('F8', 'PDF report generation')
}
