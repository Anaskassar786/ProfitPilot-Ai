import { deflateRawSync } from 'node:zlib'
import { AppError } from '@profitpilot/types'

export type ExportFormat = 'CSV' | 'XLSX' | 'PDF'
export type ExportRow = Readonly<Record<string, string | number | boolean | null>>
export type ExportFile = Readonly<{ filename: string; contentType: string; body: Buffer }>

export function writeCsv(filename: string, rows: readonly ExportRow[], columns?: readonly string[]): ExportFile { assertRows(rows); const keys = columns ?? Object.keys(rows[0] ?? {}); const lines = [keys.map(csvValue).join(',')]; for (const row of rows) lines.push(keys.map((key) => csvValue(row[key] ?? null)).join(',')); return { filename, contentType: 'text/csv; charset=utf-8', body: Buffer.from(`\ufeff${lines.join('\r\n')}\r\n`, 'utf8') } }

export function writeXlsx(filename: string, rows: readonly ExportRow[], columns?: readonly string[]): ExportFile { assertRows(rows); const keys = columns ?? Object.keys(rows[0] ?? {}); const sheetRows = [keys, ...rows.map((row) => keys.map((key) => row[key] ?? null))].map((row) => `<row>${row.map((value) => `<c t="inlineStr"><is><t>${xmlValue(value)}</t></is></c>`).join('')}</row>`).join(''); const files: Readonly<Record<string, string>> = { '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>', '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>', 'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Export" sheetId="1" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` }; return { filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: zip(files) } }

/**
 * Writes a readable, paginated PDF table.
 *
 * Bug fix: the previous implementation concatenated every row into ONE text
 * string separated by a literal `\n` escape. PDF string literals do not treat
 * `\n` as a line break, so a multi-row export rendered as a single line that
 * ran off the right edge of the page — the Revenue Report was effectively
 * unreadable. Each row is now its own positioned text run (`Td` per line) and
 * the content flows onto additional pages instead of overflowing one.
 */
export function writePdf(filename: string, rows: readonly ExportRow[], columns?: readonly string[]): ExportFile {
  assertRows(rows)
  const keys = columns ?? Object.keys(rows[0] ?? {})
  const header = keys.join('  |  ')
  const body = rows.map((row) => keys.map((key) => String(row[key] ?? '')).join('  |  '))

  const pageHeight = 792
  const top = 744
  const bottom = 54
  const leading = 13
  const linesPerPage = Math.max(1, Math.floor((top - bottom) / leading) - 2)
  const pages: string[][] = []
  for (let index = 0; index < body.length; index += linesPerPage) pages.push(body.slice(index, index + linesPerPage))
  if (pages.length === 0) pages.push([])

  // Object ids: 1 catalog, 2 pages, 3 font, then (page, content) per page.
  const pageIds = pages.map((_, index) => 4 + index * 2)
  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ]
  pages.forEach((pageLines, pageIndex) => {
    const contentId = pageIds[pageIndex]! + 1
    const stream = pdfTextStream([header, ...pageLines], top, leading, pages.length > 1 ? `Page ${pageIndex + 1} of ${pages.length}` : null, bottom)
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${pageHeight}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`)
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`)
  })

  let document = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(document, 'utf8'))
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xref = Buffer.byteLength(document, 'utf8')
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return { filename, contentType: 'application/pdf', body: Buffer.from(document, 'utf8') }
}

/** One positioned text run per line, so rows actually stack down the page. */
function pdfTextStream(lines: readonly string[], top: number, leading: number, footer: string | null, bottom: number): string {
  const runs = lines.map((line, index) => `BT /F1 9 Tf 36 ${top - index * leading} Td (${pdfValue(line)}) Tj ET`)
  if (footer) runs.push(`BT /F1 8 Tf 36 ${bottom - 18} Td (${pdfValue(footer)}) Tj ET`)
  return runs.join('\n')
}

function assertRows(rows: readonly ExportRow[]): void { if (rows.length > 50_000) throw new AppError('VALIDATION_ERROR', 'Exports are limited to 50,000 rows', 400, { rows: rows.length }) }
function csvValue(value: string | number | boolean | null): string { const text = value === null ? '' : String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text }
function xmlValue(value: string | number | boolean | null): string { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;') }
function pdfValue(value: string): string { return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' ') }
/**
 * Minimal ZIP (deflate) writer for the XLSX export.
 *
 * Bug fix: the previous implementation emitted a 26-byte local header and a
 * 40-byte central directory record — both short of the PKZIP spec (30 and 46)
 * because the DOS modified time/date fields were missing and the flag/method
 * pair was transposed. Every field after the gap was therefore misread, and
 * Excel, Numbers, LibreOffice, and Python's `zipfile` all rejected the
 * download with "bad magic number for central directory". Offsets below are
 * annotated against APPNOTE 4.3.7 (local) and 4.3.12 (central) so the layout
 * stays verifiable.
 *
 * Timestamps are pinned to the DOS epoch (1980-01-01) so the same rows always
 * produce byte-identical files.
 */
function zip(files: Readonly<Record<string, string>>): Buffer {
  const DOS_TIME = 0
  const DOS_DATE = 0x0021 // 1980-01-01
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8')
    const compressed = deflateRawSync(data)
    const crc = crc32(data)
    const nameBytes = Buffer.from(name, 'utf8')

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)   // signature
    localHeader.writeUInt16LE(20, 4)           // version needed
    localHeader.writeUInt16LE(0, 6)            // general purpose flags
    localHeader.writeUInt16LE(8, 8)            // method: deflate
    localHeader.writeUInt16LE(DOS_TIME, 10)    // modified time
    localHeader.writeUInt16LE(DOS_DATE, 12)    // modified date
    localHeader.writeUInt32LE(crc, 14)         // crc-32
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    localHeader.writeUInt16LE(0, 28)           // extra field length
    locals.push(localHeader, nameBytes, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0) // signature
    centralHeader.writeUInt16LE(20, 4)         // version made by
    centralHeader.writeUInt16LE(20, 6)         // version needed
    centralHeader.writeUInt16LE(0, 8)          // general purpose flags
    centralHeader.writeUInt16LE(8, 10)         // method: deflate
    centralHeader.writeUInt16LE(DOS_TIME, 12)
    centralHeader.writeUInt16LE(DOS_DATE, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(nameBytes.length, 28)
    centralHeader.writeUInt16LE(0, 30)         // extra field length
    centralHeader.writeUInt16LE(0, 32)         // comment length
    centralHeader.writeUInt16LE(0, 34)         // disk number start
    centralHeader.writeUInt16LE(0, 36)         // internal attributes
    centralHeader.writeUInt32LE(0, 38)         // external attributes
    centralHeader.writeUInt32LE(offset, 42)    // local header offset
    central.push(centralHeader, nameBytes)

    offset += localHeader.length + nameBytes.length + compressed.length
  }
  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)             // end of central directory
  end.writeUInt16LE(0, 4)                      // this disk
  end.writeUInt16LE(0, 6)                      // disk with central directory
  end.writeUInt16LE(central.length / 2, 8)     // entries on this disk
  end.writeUInt16LE(central.length / 2, 10)    // total entries
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)                     // comment length
  return Buffer.concat([...locals, centralBuffer, end])
}
function crc32(buffer: Buffer): number { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) } return (crc ^ 0xffffffff) >>> 0 }