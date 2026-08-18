/**
 * PR #49 — investor-ready PDF writer (Commander plan).
 *
 * A dependency-free PDF 1.4 writer tuned for board reports: cover page,
 * table of contents, serif (Times) headings, Helvetica data tables, page
 * numbers, and vector charts (area, horizontal bars, radial gauge). It is
 * deterministic — every number rendered comes from the report payload built
 * from real store rows — and supports the Commander white-label options
 * (brand name, logo text, primary color, footer text).
 *
 * Storage is pluggable (`ExecutivePdfStore`): in-memory for tests and a
 * local file store with a 30-day retention sweep for production.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExecutiveReport, ExecutiveWhiteLabel } from './executive-model.js'

export const EXECUTIVE_PDF_RETENTION_MS = 30 * 86_400_000

export interface ExecutivePdfStore {
  put(key: string, body: Buffer): Promise<void>
  get(key: string): Promise<Buffer | null>
  delete(key: string): Promise<void>
  sweep(maxAgeMs: number, now?: number): Promise<number>
}

export class InMemoryExecutivePdfStore implements ExecutivePdfStore {
  private readonly files = new Map<string, Readonly<{ body: Buffer; at: number }>>()
  public constructor(private readonly now: () => number = () => Date.now()) {}
  public async put(key: string, body: Buffer): Promise<void> { this.files.set(key, { body, at: this.now() }) }
  public async get(key: string): Promise<Buffer | null> { return this.files.get(key)?.body ?? null }
  public async delete(key: string): Promise<void> { this.files.delete(key) }
  public async sweep(maxAgeMs: number, now = this.now()): Promise<number> {
    let removed = 0
    for (const [key, file] of this.files) {
      if (now - file.at > maxAgeMs) { this.files.delete(key); removed += 1 }
    }
    return removed
  }
}

export class FileExecutivePdfStore implements ExecutivePdfStore {
  private readonly directory: string
  public constructor(directory: string) {
    this.directory = directory
    mkdirSync(directory, { recursive: true })
  }
  private pathFor(key: string): string {
    return join(this.directory, `${createHash('sha256').update(key).digest('hex').slice(0, 40)}.pdf`)
  }
  public async put(key: string, body: Buffer): Promise<void> { writeFileSync(this.pathFor(key), body) }
  public async get(key: string): Promise<Buffer | null> {
    try { return readFileSync(this.pathFor(key)) } catch { return null }
  }
  public async delete(key: string): Promise<void> {
    try { unlinkSync(this.pathFor(key)) } catch { /* already gone */ }
  }
  public async sweep(maxAgeMs: number, now = Date.now()): Promise<number> {
    let removed = 0
    for (const entry of readdirSync(this.directory)) {
      if (!entry.endsWith('.pdf')) continue
      const path = join(this.directory, entry)
      try {
        if (now - statSync(path).mtimeMs > maxAgeMs) { unlinkSync(path); removed += 1 }
      } catch { /* ignore */ }
    }
    return removed
  }
}

export type ExecutivePdfInput = Readonly<{
  report: ExecutiveReport
  storeName: string
  currency: string
  revenueSeries: readonly number[]
  healthScore: number
  healthStatus: string
  benchmarkCategory: string
  revenuePercentile: number | null
  aovPercentile: number | null
  topProducts: readonly Readonly<{ title: string; revenue: number; sharePct: number }>[]
  whiteLabel: ExecutiveWhiteLabel
}>

// ────────────────────────────────────────────────────────────────────────────
// Low-level PDF document
// ────────────────────────────────────────────────────────────────────────────

type PdfFont = 'Times-Roman' | 'Times-Bold' | 'Times-Italic' | 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique'

const FONT_REF: Readonly<Record<PdfFont, number>> = { 'Times-Roman': 0, 'Times-Bold': 1, 'Times-Italic': 2, Helvetica: 3, 'Helvetica-Bold': 4, 'Helvetica-Oblique': 5 }
const FONT_NAMES = Object.keys(FONT_REF) as readonly PdfFont[]
const FONT_WIDTH: Readonly<Record<PdfFont, number>> = { 'Times-Roman': 0.5, 'Times-Bold': 0.52, 'Times-Italic': 0.48, Helvetica: 0.55, 'Helvetica-Bold': 0.57, 'Helvetica-Oblique': 0.55 }

const PAGE_W = 612
const PAGE_H = 792
const MARGIN_X = 64
const MARGIN_Y = 68
const CONTENT_W = PAGE_W - MARGIN_X * 2
const CONTENT_H = PAGE_H - MARGIN_Y * 2

type TextStyle = Readonly<{ font: PdfFont; size: number; color: Readonly<[number, number, number]>; leading: number }>

const INK: Readonly<[number, number, number]> = [0.11, 0.14, 0.22]
const MUTED: Readonly<[number, number, number]> = [0.42, 0.46, 0.55]
const FAINT: Readonly<[number, number, number]> = [0.76, 0.79, 0.85]
const NAVY: Readonly<[number, number, number]> = [0.09, 0.16, 0.34]
const GOLD: Readonly<[number, number, number]> = [0.73, 0.58, 0.25]
const GREEN: Readonly<[number, number, number]> = [0.13, 0.5, 0.35]
const RED: Readonly<[number, number, number]> = [0.66, 0.24, 0.22]
const AMBER: Readonly<[number, number, number]> = [0.79, 0.54, 0.15]
const BLUE: Readonly<[number, number, number]> = [0.21, 0.42, 0.74]

class PdfPage {
  public readonly ops: string[] = []
  public y = PAGE_H - MARGIN_Y
  public add(op: string): void { this.ops.push(op) }
}

class PdfDocument {
  public readonly pages: PdfPage[] = [new PdfPage()]
  public page = 0
  public readonly bookmarks: Readonly<{ title: string; page: number }>[] = []

  public color(color: Readonly<[number, number, number]>): string { return `${color[0]} ${color[1]} ${color[2]} rg` }
  public strokeColor(color: Readonly<[number, number, number]>): string { return `${color[0]} ${color[1]} ${color[2]} RG` }
  public current(): PdfPage { return this.pages[this.page]! }

  public newPage(): void {
    this.pages.push(new PdfPage())
    this.page += 1
  }

  public text(text: string, style: TextStyle, x: number, y: number, maxWidth: number): void {
    const escaped = escapeText(pdfSafe(text))
    this.current().add(`BT ${this.color(style.color)} /F${FONT_REF[style.font]} ${style.size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${escaped}) Tj ET`)
    void maxWidth
  }

  public wrappedText(text: string, style: TextStyle, x: number, maxWidth: number, maxLines = 99): void {
    const words = text.split(/\s+/).filter((word) => word.length > 0)
    const widthPerChar = FONT_WIDTH[style.font] * style.size
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if ((candidate.length + 2) * widthPerChar > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    if (line) lines.push(line)
    for (const entry of lines.slice(0, maxLines)) {
      this.text(entry, style, x, this.current().y, maxWidth)
      this.current().y -= style.leading
      this.ensureSpace(style.leading)
    }
  }

  public heading(text: string): void {
    this.bookmarks.push({ title: text, page: this.page + 1 })
    this.ensureSpace(64)
    this.rect(MARGIN_X, this.current().y - 6, 3, 22, GOLD)
    this.text(text, { font: 'Times-Bold', size: 16, color: NAVY, leading: 20 }, MARGIN_X + 12, this.current().y, CONTENT_W - 12)
    this.current().y -= 26
    this.line(MARGIN_X, this.current().y + 4, MARGIN_X + CONTENT_W, this.current().y + 4, FAINT)
    this.current().y -= 16
  }

  public paragraph(text: string, style: TextStyle = { font: 'Times-Roman', size: 10.5, color: INK, leading: 14.5 }): void {
    this.wrappedText(text, style, MARGIN_X, CONTENT_W)
    this.current().y -= 8
  }

  public bullet(text: string, style: TextStyle = { font: 'Times-Roman', size: 10.5, color: INK, leading: 14.5 }): void {
    this.text('•', { font: 'Helvetica', size: 10, color: GOLD, leading: style.leading }, MARGIN_X, this.current().y, 10)
    this.wrappedText(text, style, MARGIN_X + 14, CONTENT_W - 14)
    this.current().y -= 3
  }

  public line(x1: number, y1: number, x2: number, y2: number, color: Readonly<[number, number, number]>, width = 0.7): void {
    this.current().add(`${this.strokeColor(color)} ${width} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S`)
  }

  public rect(x: number, y: number, w: number, h: number, color: Readonly<[number, number, number]>): void {
    this.current().add(`${this.color(color)} ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`)
  }

  public roundedRect(x: number, y: number, w: number, h: number, radius: number, color: Readonly<[number, number, number]>): void {
    const r = Math.min(radius, w / 2, h / 2)
    const page = this.current()
    page.add(`${this.color(color)} ${x.toFixed(1)} ${(y + r).toFixed(1)} m`)
    page.add(`${x.toFixed(1)} ${(y + h - r).toFixed(1)} l ${(x + r).toFixed(1)} ${(y + h).toFixed(1)} ${x.toFixed(1)} ${(y + h).toFixed(1)} c`)
    page.add(`${(x + w - r).toFixed(1)} ${(y + h).toFixed(1)} l ${(x + w).toFixed(1)} ${(y + h).toFixed(1)} ${(x + w).toFixed(1)} ${(y + h - r).toFixed(1)} c`)
    page.add(`${(x + w).toFixed(1)} ${(y + r).toFixed(1)} l ${(x + w).toFixed(1)} ${y.toFixed(1)} ${(x + w - r).toFixed(1)} ${y.toFixed(1)} c`)
    page.add(`${(x + r).toFixed(1)} ${y.toFixed(1)} l ${x.toFixed(1)} ${y.toFixed(1)} ${x.toFixed(1)} ${(y + r).toFixed(1)} c f`)
  }

  public table(rows: readonly (readonly string[])[], columnWeights: readonly number[], rowHeight = 20): void {
    const header = rows[0]
    if (!header) return
    this.ensureSpace(rowHeight * 2)
    const totalWeight = columnWeights.reduce((sum, weight) => sum + weight, 0)
    const widths = columnWeights.map((weight) => (CONTENT_W * weight) / totalWeight)
    let x = MARGIN_X
    const headerY = this.current().y
    header.forEach((cell, index) => {
      this.text(cell, { font: 'Helvetica-Bold', size: 8.5, color: [1, 1, 1], leading: rowHeight }, x + 6, headerY - 12, widths[index]! - 8)
      x += widths[index]!
    })
    this.rect(MARGIN_X, headerY - rowHeight, CONTENT_W, rowHeight, NAVY)
    this.current().y -= rowHeight
    rows.slice(1).forEach((row, rowIndex) => {
      this.ensureSpace(rowHeight + 4)
      const rowY = this.current().y
      if (rowIndex % 2 === 0) this.rect(MARGIN_X, rowY - rowHeight, CONTENT_W, rowHeight, [0.955, 0.965, 0.98])
      let cellX = MARGIN_X
      row.forEach((cell, index) => {
        this.text(truncate(cell, Math.floor(widths[index]! / 5.2)), { font: 'Helvetica', size: 8.5, color: INK, leading: rowHeight }, cellX + 6, rowY - 12, widths[index]! - 8)
        cellX += widths[index]!
      })
      this.current().y -= rowHeight
    })
    this.current().y -= 10
  }

  /** Horizontal bar chart: label | bar | value. */
  public hBarChart(items: readonly Readonly<{ label: string; value: number; display: string; color: Readonly<[number, number, number]> }>[], maxValue: number): void {
    const barHeight = 18
    this.ensureSpace(items.length * (barHeight + 10) + 10)
    const labelWidth = 170
    const valueWidth = 90
    const chartX = MARGIN_X + labelWidth
    const chartW = CONTENT_W - labelWidth - valueWidth - 12
    const scale = chartW / Math.max(maxValue, 1)
    items.forEach((item) => {
      const y = this.current().y
      this.text(truncate(item.label, 30), { font: 'Helvetica', size: 8.5, color: INK, leading: barHeight }, MARGIN_X, y - 11, labelWidth - 6)
      this.rect(chartX, y - barHeight + 4, Math.max(item.value * scale, 1.5), barHeight - 8, item.color)
      this.text(item.display, { font: 'Helvetica-Bold', size: 8.5, color: INK, leading: barHeight }, chartX + chartW + 4, y - 11, valueWidth)
      this.current().y -= barHeight + 8
    })
    this.current().y -= 6
  }

  /** Area chart from a value series. */
  public areaChart(values: readonly number[], height = 110): void {
    if (values.length < 2) return
    this.ensureSpace(height + 24)
    const top = this.current().y - 6
    const max = Math.max(...values, 1)
    const min = Math.min(...values, 0)
    const span = Math.max(max - min, 1)
    const step = CONTENT_W / (values.length - 1)
    const xAt = (index: number): number => MARGIN_X + index * step
    const yAt = (value: number): number => top - height + ((value - min) / span) * (height - 8) + 2
    const page = this.current()
    const points = values.map((value, index) => `${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`).join(' ')
    page.add(`${this.color([0.21, 0.42, 0.74])} ${MARGIN_X.toFixed(1)} ${(top - height).toFixed(1)} m ${points} l ${(MARGIN_X + CONTENT_W).toFixed(1)} ${(top - height).toFixed(1)} l h f`)
    page.add(`${this.strokeColor([0.21, 0.42, 0.74])} 1.4 w ${points.split(' ')[0]} m`)
    for (const point of points.split(' ').slice(1)) page.add(`${point} l`)
    page.add('S')
    this.line(MARGIN_X, top - height, MARGIN_X + CONTENT_W, top - height, FAINT)
    this.text(`${values[0] ?? 0}`, { font: 'Helvetica', size: 7.5, color: MUTED, leading: 10 }, MARGIN_X, top - height - 10, 60)
    this.text(`${values[values.length - 1] ?? 0}`, { font: 'Helvetica', size: 7.5, color: MUTED, leading: 10 }, MARGIN_X + CONTENT_W - 60, top - height - 10, 60)
    this.current().y = top - height - 20
  }

  /** Radial health gauge (arc segments approximating a circle). */
  public radialGauge(score: number, label: string, centerX: number, top: number, radius = 52): void {
    const cx = centerX
    const cy = top - radius - 10
    const start = Math.PI * 0.75
    const sweep = Math.PI * 1.5
    const colorFor = (value: number): Readonly<[number, number, number]> => (value >= 80 ? GREEN : value >= 62 ? GOLD : value >= 40 ? AMBER : RED)
    const segments = 48
    const page = this.current()
    for (let index = 0; index < segments; index += 1) {
      const angle = start + (sweep * index) / segments
      const next = start + (sweep * (index + 1)) / segments
      const fraction = index / segments
      const active = score >= (fraction * 100)
      const x1 = cx + Math.cos(angle) * radius
      const y1 = cy + Math.sin(angle) * radius
      const x2 = cx + Math.cos(next) * radius
      const y2 = cy + Math.sin(next) * radius
      page.add(`${this.strokeColor(active ? colorFor(score) : FAINT)} ${radius * 0.16} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S`)
    }
    this.text(String(score), { font: 'Times-Bold', size: 30, color: NAVY, leading: 34 }, cx - 26, cy - 8, 60)
    this.text('/ 100', { font: 'Helvetica', size: 9, color: MUTED, leading: 12 }, cx + 12, cy - 3, 40)
    this.text(label, { font: 'Helvetica-Bold', size: 9, color: INK, leading: 12 }, cx - 52, cy - radius - 22, 110)
  }

  public footer(pageNumber: number, totalPages: number, brand: string): void {
    const y = 40
    this.line(MARGIN_X, y + 8, PAGE_W - MARGIN_X, y + 8, FAINT)
    this.text(brand, { font: 'Helvetica', size: 7.5, color: MUTED, leading: 10 }, MARGIN_X, y - 4, 300)
    this.text(`${pageNumber} / ${totalPages}`, { font: 'Helvetica', size: 7.5, color: MUTED, leading: 10 }, PAGE_W - MARGIN_X - 60, y - 4, 60)
  }

  public ensureSpace(height: number): void {
    if (this.current().y - height < MARGIN_Y + 40) this.newPage()
  }

  public serialize(): Buffer {
    // Two-pass footer pagination: total page count is known before writing.
    const total = this.pages.length
    const objects: string[] = []
    objects.push('<< /Type /Catalog /Pages 2 0 R >>')
    objects.push(`<< /Type /Pages /Kids [${this.pages.map((_, index) => `${7 + index * 2} 0 R`).join(' ')}] /Count ${total} >>`)
    objects.push('<< /Type /Info /Title (AI Executive Board Report) /Producer (ProfitPilot AI Executive) >>')
    // Fonts: objects 4-9.
    for (const name of FONT_NAMES) objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} >>`)
    // Each page: page dict + content stream.
    this.pages.forEach((page, index) => {
      const content = page.ops.join('\n')
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << ${FONT_NAMES.map((name) => `/F${FONT_REF[name]} ${4 + FONT_REF[name]} 0 R`).join(' ')} >> >> /Contents ${8 + index * 2} 0 R >>`)
      objects.push(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`)
    })
    let body = '%PDF-1.4\n'
    const offsets: number[] = [0]
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(body, 'utf8'))
      body += `${index + 1} 0 obj\n${object}\nendobj\n`
    })
    const xref = Buffer.byteLength(body, 'utf8')
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF`
    return Buffer.from(body, 'utf8')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Report renderer
// ────────────────────────────────────────────────────────────────────────────

export function renderExecutiveReportPdf(input: ExecutivePdfInput): Buffer {
  const white = input.whiteLabel
  const brand = white.brandName?.trim() || 'ProfitPilot AI Executive'
  const footer = white.footerText?.trim() || 'Generated by ProfitPilot AI Executive from real store data'
  const accent: Readonly<[number, number, number]> = white.primaryColor ? hexToRgb(white.primaryColor) : NAVY
  const doc = new PdfDocument()

  // Cover page.
  const cover = doc.current()
  cover.add(`${doc.color([0.055, 0.075, 0.12])} 0 0 ${PAGE_W} ${PAGE_H} re f`)
  cover.add(`${doc.color(accent)} 0 0 ${PAGE_W} 3.2 re f`)
  const logo = white.logoText?.trim() || brand.slice(0, 2).toUpperCase()
  doc.roundedRect(PAGE_W / 2 - 46, PAGE_H - 260, 92, 92, 10, accent)
  doc.text(logo.slice(0, 2), { font: 'Times-Bold', size: 34, color: [1, 1, 1], leading: 40 }, PAGE_W / 2 - 24, PAGE_H - 212, 80)
  doc.text(brand.toUpperCase(), { font: 'Helvetica-Bold', size: 11, color: [0.82, 0.85, 0.9], leading: 16 }, PAGE_W / 2 - 150, PAGE_H - 300, 300)
  doc.text('AI EXECUTIVE', { font: 'Helvetica', size: 10, color: GOLD, leading: 14 }, PAGE_W / 2 - 150, PAGE_H - 316, 300)
  doc.text('Board Report', { font: 'Times-Bold', size: 34, color: [0.97, 0.98, 1], leading: 42 }, MARGIN_X, 420, CONTENT_W)
  doc.text(input.storeName, { font: 'Times-Roman', size: 16, color: [0.78, 0.82, 0.88], leading: 22 }, MARGIN_X, 396, CONTENT_W)
  doc.text(`${input.report.reportType === 'QUARTERLY' ? 'Quarterly' : input.report.reportType === 'CUSTOM' ? 'Custom' : 'Monthly'} review · ${input.report.periodStart} to ${input.report.periodEnd}`, { font: 'Helvetica', size: 11, color: [0.72, 0.76, 0.84], leading: 16 }, MARGIN_X, 372, CONTENT_W)
  doc.text(footer, { font: 'Helvetica', size: 8, color: [0.5, 0.55, 0.65], leading: 12 }, MARGIN_X, 80, CONTENT_W)
  doc.newPage()

  // TOC (fixed height → stable pagination for the bookmark pass).
  doc.text('Contents', { font: 'Times-Bold', size: 18, color: accent, leading: 24 }, MARGIN_X, doc.current().y, CONTENT_W)
  doc.current().y -= 20
  for (const bookmark of doc.bookmarks) {
    doc.text(truncate(bookmark.title, 70), { font: 'Times-Roman', size: 11, color: INK, leading: 18 }, MARGIN_X, doc.current().y, CONTENT_W - 60)
    doc.text('·', { font: 'Times-Roman', size: 11, color: FAINT, leading: 18 }, MARGIN_X + CONTENT_W - 60, doc.current().y, 20)
    doc.current().y -= 18
  }
  doc.current().y -= 8
  // Health gauge page.
  doc.ensureSpace(320)
  doc.heading('Business Health')
  const gaugeTop = doc.current().y
  doc.radialGauge(input.healthScore, input.healthStatus, PAGE_W / 2 - 60, gaugeTop)
  doc.current().y -= 240
  doc.paragraph(`Overall health score of ${input.healthScore}/100 — ${input.healthStatus.toLowerCase()}. Reviewed as of ${input.report.generatedAt.slice(0, 10)}.`, { font: 'Times-Roman', size: 11, color: INK, leading: 16 })
  doc.hBarChart(
    [
      { label: 'Benchmark category', value: 0, display: input.benchmarkCategory, color: accent },
      { label: 'Revenue percentile', value: input.revenuePercentile ?? 0, display: input.revenuePercentile === null ? 'not measurable' : `${input.revenuePercentile}th`, color: BLUE },
      { label: 'AOV percentile', value: input.aovPercentile ?? 0, display: input.aovPercentile === null ? 'not measurable' : `${input.aovPercentile}th`, color: GOLD },
    ],
    100,
  )
  doc.current().y -= 8
  // Executive summary.
  doc.heading('Executive Summary')
  doc.paragraph(input.report.executiveSummary)
  if (input.report.content.strategicPosition) {
    doc.heading('Strategic Position')
    doc.paragraph(input.report.content.strategicPosition)
  }
  // Insights + decisions.
  doc.heading('Key Strategic Insights')
  for (const insight of input.report.content.keyInsights) doc.bullet(insight)
  doc.heading('Recommended Strategic Decisions')
  for (const decision of input.report.content.recommendedDecisions) doc.bullet(decision)
  // Financial forecast.
  if (input.report.content.financialForecast) {
    doc.heading('Financial Forecast')
    doc.table(
      [['Horizon', 'Low', 'Expected', 'High'], ...input.report.content.financialForecast.projections.map((projection) => [projection.label, fmtMoney(projection.low, input.currency), fmtMoney(projection.expected, input.currency), fmtMoney(projection.high, input.currency)])],
      [2, 2, 2, 2],
    )
  }
  // Revenue trajectory.
  if (input.revenueSeries.length > 1) {
    doc.heading('Revenue Trajectory')
    doc.paragraph(`Daily revenue for the most recent ${input.revenueSeries.length} synced days, in ${input.currency}.`, { font: 'Times-Italic', size: 9.5, color: MUTED, leading: 13 })
    doc.areaChart(input.revenueSeries)
  }
  // Top products.
  if (input.topProducts.length > 0) {
    doc.heading('Revenue Concentration')
    const maxRevenue = Math.max(...input.topProducts.map((product) => product.revenue), 1)
    doc.hBarChart(input.topProducts.map((product) => ({ label: truncate(product.title, 30), value: product.revenue, display: `${fmtMoney(product.revenue, input.currency)} · ${product.sharePct.toFixed(1)}%`, color: BLUE })), maxRevenue)
  }
  // Risk & opportunity appendix.
  doc.heading('Risk and Opportunity Register')
  const risks = input.report.content.appendix.risks ?? {}
  const riskRows = Object.entries(risks)
  if (riskRows.length > 0) {
    doc.table([['Active risk', 'Severity', 'Impact'], ...riskRows.map(([title, detail]) => [truncate(title, 42), String(detail), '—'])], [4, 2, 2])
  } else {
    doc.paragraph('No active risks were detected at generation time.', { font: 'Times-Italic', size: 10, color: MUTED, leading: 14 })
  }
  // Appendix table.
  const metrics = input.report.content.appendix.metrics ?? {}
  const metricRows = Object.entries(metrics)
  if (metricRows.length > 0) {
    doc.heading('Appendix — Detailed Metrics')
    doc.table([['Metric', 'Value'], ...metricRows.map(([key, value]) => [key, value === null ? 'not measurable' : String(value)])], [1, 1])
  }
  doc.ensureSpace(50)
  doc.text('This report contains only values computed from synced store data and public industry benchmarks.', { font: 'Helvetica-Oblique', size: 8, color: MUTED, leading: 12 }, MARGIN_X, doc.current().y, CONTENT_W)

  // Footers (all pages get page numbers).
  const total = doc.pages.length
  doc.pages.forEach((page, index) => {
    page.ops.push(`BT ${doc.color(MUTED)} /F${FONT_REF.Helvetica} 7.5 Tf ${MARGIN_X} 36 Td (${escapeText(footer)}) Tj ET`)
    page.ops.push(`BT ${doc.color(MUTED)} /F${FONT_REF.Helvetica} 7.5 Tf ${PAGE_W - MARGIN_X - 60} 36 Td (${index + 1} / ${total}) Tj ET`)
  })

  return doc.serialize()
}

function fmtMoney(value: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value))}`
}
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/** Type1 base-14 fonts use WinAnsiEncoding: fold non-ASCII into safe ASCII. */
function pdfSafe(text: string): string {
  return text
    .replace(/\u2014|\u2013/g, '-')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/\u2022/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
}
function hexToRgb(hex: string): Readonly<[number, number, number]> {
  const clean = hex.replace('#', '')
  const value = Number.parseInt(clean.length === 3 ? clean.split('').map((character) => character + character).join('') : clean.slice(0, 6), 16)
  if (!Number.isFinite(value)) return NAVY
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}
