import { describe, expect, it } from 'vitest'
import { writeCsv, writePdf, writeXlsx } from './exporters.js'

describe('F6 custom export writers', () => {
  const rows = [{ id: 1, name: 'A, B', active: true }]
  it('writes escaped UTF-8 CSV', () => { const file = writeCsv('orders.csv', rows); expect(file.contentType).toContain('text/csv'); expect(file.body.toString()).toContain('"A, B"') })
  it('writes a valid XLSX zip signature without a heavy library', () => { const file = writeXlsx('orders.xlsx', rows); expect(file.body[0]).toBe(0x50); expect(file.body[1]).toBe(0x4b); expect(file.contentType).toContain('spreadsheetml') })
  it('writes a PDF document', () => { const file = writePdf('orders.pdf', rows); expect(file.body.toString('utf8', 0, 8)).toContain('%PDF-1.4') })
  it('rejects more than 50k rows', () => expect(() => writeCsv('large.csv', Array.from({ length: 50_001 }, () => ({ id: 1 })))).toThrow('50,000'))
  it('respects selected columns', () => { const file = writeCsv('custom.csv', rows, ['name']); expect(file.body.toString()).toContain('name'); expect(file.body.toString()).not.toContain('active') })
})
