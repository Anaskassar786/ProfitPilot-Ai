import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
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

/**
 * Regression guards for two bugs found while testing the Data Exports page:
 * the XLSX download could not be opened by any spreadsheet app, and the PDF
 * put every row on one overflowing line.
 */
describe('XLSX archive is a spec-valid zip', () => {
  const rows = [{ id: 1, title: 'Everyday Hoodie, \"Black\"' }, { id: 2, title: 'Trail Cap & Visor' }]

  it('writes 30-byte local headers and 46-byte central directory records', () => {
    const body = writeXlsx('catalog.xlsx', rows).body
    expect(body.readUInt32LE(0)).toBe(0x04034b50)
    expect(body.readUInt16LE(8)).toBe(8) // deflate lives in the method field, not the flags
    expect(body.readUInt16LE(6)).toBe(0) // general purpose flags are clear
    const nameLength = body.readUInt16LE(26)
    expect(body.subarray(30, 30 + nameLength).toString('utf8')).toBe('[Content_Types].xml')

    const centralOffset = body.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    expect(centralOffset).toBeGreaterThan(0)
    expect(body.readUInt16LE(centralOffset + 10)).toBe(8) // method
    expect(body.readUInt32LE(centralOffset + 42)).toBe(0) // first local header offset

    const end = body.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    expect(body.length - end).toBe(22)
    expect(body.readUInt16LE(end + 10)).toBe(5) // five parts in the workbook
  })

  it('round-trips every part so the sheet can be read back', () => {
    const body = writeXlsx('catalog.xlsx', rows).body
    const parts = new Map<string, string>()
    let cursor = 0
    while (body.readUInt32LE(cursor) === 0x04034b50) {
      const compressedSize = body.readUInt32LE(cursor + 18)
      const nameLength = body.readUInt16LE(cursor + 26)
      const extraLength = body.readUInt16LE(cursor + 28)
      const name = body.subarray(cursor + 30, cursor + 30 + nameLength).toString('utf8')
      const dataStart = cursor + 30 + nameLength + extraLength
      parts.set(name, inflateRawSync(body.subarray(dataStart, dataStart + compressedSize)).toString('utf8'))
      cursor = dataStart + compressedSize
    }
    expect([...parts.keys()]).toContain('xl/worksheets/sheet1.xml')
    const sheet = parts.get('xl/worksheets/sheet1.xml') ?? ''
    expect(sheet).toContain('Everyday Hoodie, &quot;Black&quot;')
    expect(sheet).toContain('Trail Cap &amp; Visor')
  })

  it('opens with an independent zip reader', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xlsx-'))
    const path = join(directory, 'catalog.xlsx')
    writeFileSync(path, writeXlsx('catalog.xlsx', rows).body)
    const output = execFileSync('python3', ['-c', `import zipfile;z=zipfile.ZipFile(${JSON.stringify(path)});print(len(z.namelist()));z.close()`]).toString().trim()
    expect(output).toBe('5')
  })
})

describe('PDF lays rows out as readable lines', () => {
  it('emits one positioned text run per row instead of a single overflowing line', () => {
    const body = writePdf('revenue.pdf', [{ day: '2026-08-17', revenue: 829.35 }, { day: '2026-08-18', revenue: 1176 }]).body.toString('latin1')
    const runs = body.match(/Tj ET/g) ?? []
    expect(runs).toHaveLength(3) // header + two rows
    expect(body).not.toContain('\\\\n') // no literal escape standing in for a line break
    const positions = [...body.matchAll(/Td/g)]
    expect(positions).toHaveLength(3)
    expect(body).toContain('829.35')
    expect(body).toContain('1176')
  })

  it('paginates instead of running off the bottom of one page', () => {
    const rows = Array.from({ length: 140 }, (_, index) => ({ day: `row-${index}`, revenue: index }))
    const body = writePdf('big.pdf', rows).body.toString('latin1')
    expect(/\/Count (\d+)/.exec(body)?.[1]).toBe('3')
    expect((body.match(/\/Type \/Page /g) ?? [])).toHaveLength(3)
    expect(body).toContain('Page 1 of 3')
  })

  it('keeps a valid xref table as the object count grows', () => {
    const body = writePdf('big.pdf', Array.from({ length: 200 }, (_, index) => ({ n: index }))).body.toString('latin1')
    const size = Number(/\/Size (\d+)/.exec(body)?.[1])
    const entries = (body.slice(body.indexOf('xref')).match(/00000 n /g) ?? []).length
    expect(entries).toBe(size - 1)
    expect(body.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('escapes parentheses and backslashes so the content stream cannot break', () => {
    const body = writePdf('escape.pdf', [{ note: 'Sale (50% off) \\ today' }]).body.toString('latin1')
    expect(body).toContain('\\(50% off\\)')
    expect(body).toContain('\\\\ today')
  })
})
