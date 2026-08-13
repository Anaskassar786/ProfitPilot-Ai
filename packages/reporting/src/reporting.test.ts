import { describe, expect, it } from 'vitest'
import { assertClosedPeriod, generatePdfReport, reportFileName, reportObjectKey } from './index.js'

describe('deterministic report boundaries', () => {
  const period = { start: '2024-05-01T00:00:00.000Z', end: '2024-05-31T23:59:59.000Z' }
  it('accepts a closed ordered period', () => expect(() => assertClosedPeriod(period, new Date('2024-06-01T00:00:00.000Z'))).not.toThrow())
  it('rejects a future period', () => expect(() => assertClosedPeriod({ start: '2024-06-01', end: '2024-06-30' }, new Date('2024-06-02'))).toThrow('closed'))
  it('rejects reversed periods', () => expect(() => assertClosedPeriod({ start: '2024-06-30', end: '2024-06-01' }, new Date('2024-07-01'))).toThrow('ordered'))
  it('builds deterministic safe filenames', () => expect(reportFileName('Demo Store.myshopify.com', 'WEEKLY', period)).toBe('demo-store-myshopify-com-weekly-2024-05-01-2024-05-31.pdf'))
  it('builds an R2 object key', () => expect(reportObjectKey('demo.myshopify.com', 'MONTHLY', period)).toContain('reports/demo.myshopify.com/'))
  it('generates a real PDF file', () => expect(generatePdfReport('report.pdf', [{ metric: 'revenue', value: 189 }]).body.subarray(0, 8).toString()).toBe('%PDF-1.4'))
})
