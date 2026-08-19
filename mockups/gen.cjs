/**
 * Design mockup generator — Recommendations Overview + Activity chart.
 * Renders pixel-accurate SVG mockups of CURRENT (from recommendations.tsx/css)
 * vs PROPOSED designs, then rasterizes them with @resvg/resvg-js.
 *
 * Run: node mockups/gen.js   (needs /tmp/svgtest/node_modules for resvg)
 */
const { Resvg } = require('/tmp/svgtest/node_modules/@resvg/resvg-js')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, 'out')
fs.mkdirSync(OUT, { recursive: true })

// ---------- palette (from apps/web/src/styles.css) ----------
const C = {
  bg: '#0F1117',
  card: '#1A1D27',
  card2: '#181B24',
  border: '#2A2E38',
  borderSoft: 'rgba(120,133,157,.16)',
  text: '#F9FAFB',
  text2: '#9CA3AF',
  text3: '#6B7280',
  green: '#10B981',
  greenD: '#059669',
  amber: '#F59E0B',
  red: '#EF4444',
  purple: '#9B7CF6',
  purpleD: '#7C3AED',
  blue: '#57C6E9',
}

const FONT = 'DejaVu Sans, sans-serif'
const MONO = 'DejaVu Sans Mono, monospace'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---------- svg helpers ----------
function svgTag(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
}
const rrect = (x, y, w, h, rx, fill, stroke, sw = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill || 'none'}" ${stroke ? `stroke="${stroke}" stroke-width="${sw}"` : ''}/>`
const circle = (cx, cy, r, fill, stroke, sw = 1) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill || 'none'}" ${stroke ? `stroke="${stroke}" stroke-width="${sw}"` : ''}/>`
const line = (x1, y1, x2, y2, stroke, sw = 1, dash) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`
const txt = (x, y, s, size, fill, anchor = 'start', weight = 'normal', family = FONT, spacing = 0) =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" ${spacing ? `letter-spacing="${spacing}"` : ''}>${esc(s)}</text>`

// ---------- lucide-ish icons as minimal SVG paths ----------
const ICONS = {
  gauge: '<path d="M4 14a8 8 0 1 1 16 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 14l4-4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  checkCircle: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8.5 12l2.3 2.3 4.7-4.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7h6v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  wand: '<path d="M15 4V2m0 8V8m4-4h-2M7 12l7-7 3 3-7 7-3-3z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 21c2.5 0 3.5-1.5 5-3 1-1 2-3 2-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 11v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="8" r="1.3" fill="currentColor"/>',
  zap: '<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" fill="currentColor"/>',
  target: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  activity: '<path d="M3 12h4l2.5-7 5 14 2.5-7h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  heart: '<path d="M12 20s-7-4.6-9.3-9C1.2 8 3 4.5 6.5 4.5c2 0 3.4 1 4.5 2.6 1.1-1.6 2.5-2.6 4.5-2.6C19 4.5 20.8 8 19.3 11c-2.3 4.4-7.3 9-7.3 9z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
}
function icon(name, x, y, size, color) {
  const s = size
  const scale = s / 24
  return `<g transform="translate(${x} ${y}) scale(${scale})" color="${color}">${ICONS[name]}</g>`
}

// =============================================================
// CURRENT cards (accurate replication of recommendations.tsx)
// =============================================================

/** Current card 1 — Revenue opportunity pending */
function currentCard1(x, y, w) {
  const h = 118
  let s = ''
  s += rrect(x, y, w, h, 14, C.card, C.border)
  // label row
  s += icon('gauge', x + 16, y + 13, 13, C.text3)
  s += txt(x + 33, y + 24, 'REVENUE OPPORTUNITY PENDING', 10, C.text3, 'start', 'normal', FONT, 0.5)
  s += icon('info', x + w - 26, y + 13, 11, C.text3)
  // value row
  s += circle(x + 52, y + 62, 18, 'none', C.borderSoft, 4)
  s += `<path d="M 34 62 A 18 18 0 0 1 70 62" fill="none" stroke="${C.green}" stroke-width="4" stroke-linecap="round"/>`
  s += icon('trend', x + 45, y + 55, 14, C.green)
  s += txt(x + 84, y + 63, '$12,480', 22, C.green, 'start', 'bold', MONO)
  s += txt(x + 84, y + 80, '6 pending recommendations', 10, C.text3)
  s += txt(x + 84, y + 94, 'awaiting your call', 10, C.text3)
  s += txt(x + w - 16, y + 96, '', 10, C.text3)
  return s
}

/** Current card 2 — Approved this month */
function currentCard2(x, y, w) {
  const h = 118
  let s = ''
  s += rrect(x, y, w, h, 14, C.card, C.border)
  s += icon('checkCircle', x + 16, y + 13, 13, C.text3)
  s += txt(x + 33, y + 24, 'APPROVED THIS MONTH', 10, C.text3, 'start', 'normal', FONT, 0.5)
  s += icon('info', x + w - 26, y + 13, 11, C.text3)
  s += txt(x + 16, y + 63, '8', 22, C.text, 'start', 'bold', MONO)
  s += txt(x + 16, y + 80, '8 approvals this month', 10, C.text3)
  s += txt(x + 16, y + 94, '· $3,240 modeled', 10, C.text3)
  // bars (right)
  const bx = x + w - 16 - 84
  const heights = [10, 16, 8, 24, 14, 30, 22]
  heights.forEach((hv, i) => {
    const bw = 8
    const bh = (hv / 30) * 38
    const color = hv > 0 ? 'url(#gbar)' : C.border
    s += rrect(bx + i * (bw + 3.5), y + 62 - bh, bw, bh, 2, hv > 0 ? '#34D399' : C.border)
    if (hv > 0) s += `<rect x="${bx + i * (bw + 3.5)}" y="${y + 62 - bh}" width="${bw}" height="${bh}" rx="2" fill="url(#gbar)"/>`
  })
  return s
}

/** Current card 3 — Approval rate */
function currentCard3(x, y, w) {
  const h = 118
  let s = ''
  s += rrect(x, y, w, h, 14, C.card, C.border)
  s += icon('trend', x + 16, y + 13, 13, C.text3)
  s += txt(x + 33, y + 24, 'APPROVAL RATE', 10, C.text3, 'start', 'normal', FONT, 0.5)
  s += icon('info', x + w - 26, y + 13, 11, C.text3)
  s += txt(x + 16, y + 56, '71.4%', 24, C.text, 'start', 'bold', MONO)
  s += txt(x + 16, y + 72, 'of decisions approved · last 30 days', 10, C.text3)
  s += txt(x + 16, y + 86, '▲ vs all-time', 10, C.green)
  // zones track — marker at 71.4% (stuck, cramped)
  const tx = x + 16, tw = w - 32, ty = y + 97
  s += rrect(tx, ty, tw, 8, 4, C.borderSoft)
  s += rrect(tx, ty, tw * 0.4, 8, 4, 'rgba(239,68,68,.55)')
  s += rrect(tx + tw * 0.4, ty, tw * 0.3, 8, 0, 'rgba(245,158,11,.6)')
  s += rrect(tx + tw * 0.7, ty, tw * 0.3, 8, 4, 'rgba(16,185,129,.6)')
  const mx = tx + tw * 0.714
  s += line(mx, ty - 3, mx, ty + 11, C.text, 3)
  s += circle(mx, ty - 4, 3.5, C.text)
  return s
}

/** Current card 4 — Avg time to decide */
function currentCard4(x, y, w) {
  const h = 118
  let s = ''
  s += rrect(x, y, w, h, 14, C.card, C.border)
  s += icon('clock', x + 16, y + 13, 13, C.text3)
  s += txt(x + 33, y + 24, 'AVG TIME TO DECIDE', 10, C.text3, 'start', 'normal', FONT, 0.5)
  s += icon('info', x + w - 26, y + 13, 11, C.text3)
  // speedometer 96x56
  const sx = x + 16, sy = y + 38
  s += `<path d="M ${sx + 10},${sy + 46} A 40,40 0 0,1 ${sx + 90},${sy + 46}" fill="none" stroke="${C.borderSoft}" stroke-width="6" stroke-linecap="round"/>`
  s += `<path d="M ${sx + 10},${sy + 46} A 40,40 0 0,1 ${sx + 27},${sy + 30}" fill="none" stroke="${C.green}" stroke-width="6" stroke-linecap="round"/>`
  s += `<path d="M ${sx + 27},${sy + 30} A 40,40 0 0,1 ${sx + 50},${sy + 20}" fill="none" stroke="${C.amber}" stroke-width="6"/>`
  s += `<path d="M ${sx + 50},${sy + 20} A 40,40 0 0,1 ${sx + 90},${sy + 46}" fill="none" stroke="${C.red}" stroke-width="6" stroke-linecap="round"/>`
  s += `<line x1="${sx + 50}" y1="${sy + 46}" x2="${sx + 50}" y2="${sy + 16}" stroke="${C.text}" stroke-width="2.5"/>`
  s += circle(sx + 50, sy + 46, 3.5, C.text)
  s += txt(sx + 50, sy + 62, 'FAST', 9, C.green, 'middle', 'bold', MONO, 0.4)
  s += txt(x + 116, y + 63, '42m', 22, C.text, 'start', 'bold', MONO)
  s += txt(x + 116, y + 80, 'How fast you review', 10, C.text3)
  s += txt(x + 116, y + 94, 'new findings', 10, C.text3)
  return s
}

/** Current card 5 — Monthly usage (kept as-is in proposal) */
function currentCard5(x, y, w) {
  const h = 118
  let s = ''
  s += rrect(x, y, w, h, 14, C.card, C.border)
  s += icon('wand', x + 16, y + 13, 13, C.text3)
  s += txt(x + 33, y + 24, 'MONTHLY USAGE', 10, C.text3, 'start', 'normal', FONT, 0.5)
  s += icon('info', x + w - 26, y + 13, 11, C.text3)
  // ring
  s += circle(x + 34, y + 62, 15, 'none', C.border, 3.5)
  s += `<path d="M ${x + 34} ${y + 47} A 15 15 0 0 1 ${x + 45.6} ${y + 71.4}" fill="none" stroke="${C.purple}" stroke-width="3.5" stroke-linecap="round"/>`
  s += txt(x + 56, y + 63, '4/10', 17, C.text, 'start', 'bold', MONO)
  s += txt(x + 56, y + 80, 'Growth plan · 6 left', 10, C.text3)
  s += txt(x + 16, y + 104, 'Upgrade Plan  →', 10, C.purple)
  return s
}

// =============================================================
// PROPOSED cards — professional, roomier, distinct identities
// =============================================================

/** shared header for proposed cards */
function proposedHeader(x, y, w, chipColor, chipTint, iconName, label, labelColor) {
  let s = ''
  s += rrect(x, y, 24, 24, 7, chipTint)
  s += icon(iconName, x + 5.5, y + 5.5, 13, chipColor)
  s += txt(x + 32, y + 16, label, 12, labelColor || C.text2, 'start', 'bold', FONT)
  s += icon('info', x + w - 22, y + 6, 12, C.text3)
  return s
}

/** Proposed card 1 — Revenue opportunity pending (bigger, hero) */
function proposedCard1(x, y, w) {
  const h = 152
  let s = ''
  s += rrect(x, y, w, h, 14, C.card, C.border)
  // top accent
  s += `<rect x="${x}" y="${y}" width="${w}" height="3" rx="1.5" fill="url(#accentRev)"/>`
  s += proposedHeader(x + 16, y + 15, w - 16, C.green, 'rgba(16,185,129,.13)', 'gauge', 'Revenue opportunity pending')
  // big value
  s += txt(x + 16, y + 66, '$12,480', 28, C.green, 'start', 'bold', MONO)
  s += txt(x + 16, y + 84, '6 pending · awaiting your call', 11, C.text2)
  // footer visual — ring + teammates strip
  const fy = y + 106
  s += circle(x + 28, fy + 16, 13, 'none', C.borderSoft, 3)
  s += `<path d="M ${x + 28} ${fy + 3} A 13 13 0 0 1 ${x + 39.2} ${fy + 25.2}" fill="none" stroke="${C.green}" stroke-width="3" stroke-linecap="round"/>`
  s += txt(x + 28, fy + 21, '6', 11, C.text, 'middle', 'bold', MONO)
  s += txt(x + 50, fy + 11, 'Across 4 teammates', 10.5, C.text3)
  // stacked share bar by agent (counts from summary.byAgent)
  const segs = [
    [2, C.blue], [2, C.green], [1, C.amber], [1, C.purple],
  ]
  const total = segs.reduce((a, b) => a + b[0], 0)
  const bw0 = w - 66
  let bx0 = x + 50
  segs.forEach(([count, col]) => {
    const segW = (count / total) * bw0
    s += rrect(bx0, fy + 24, segW - 2, 5, 2.5, col)
    bx0 += segW
  })
  s += txt(x + 50, fy + 42, 'Inventory · Revenue · Pricing · Campaign', 8.5, C.text3)
  return s
}

/** Proposed card 2 — Approved this month (single green identity + month progress) */
function proposedCard2(x, y, w) {
  const h = 152
  let s = ''
  s += rrect(x, y, w, h, 14, C.card, C.border)
  s += proposedHeader(x + 16, y + 15, w - 16, C.green, 'rgba(16,185,129,.13)', 'checkCircle', 'Approved this month')
  s += txt(x + 16, y + 68, '8', 28, C.text, 'start', 'bold', MONO)
  s += txt(x + 46, y + 66, 'approved', 12, C.text2)
  s += rrect(x + 16, y + 78, 190, 20, 10, 'rgba(16,185,129,.12)')
  s += txt(x + 28, y + 92, '≈ $3,240 modeled impact', 10.5, C.green, 'start', 'bold', MONO)
  // weekly bars with day letters (single green identity)
  const bx = x + 16, bw = 12, gap = 4, baseY = y + 138
  const days = [
    ['M', 8], ['T', 14], ['W', 6], ['T', 22], ['F', 12], ['S', 28], ['S', 20],
  ]
  days.forEach(([d, hv], i) => {
    const bh = (hv / 30) * 30
    const xx = bx + i * (bw + gap)
    s += rrect(xx, baseY - bh, bw, bh, 3, '#34D399')
    s += txt(xx + bw / 2, baseY + 10, d, 8.5, C.text3, 'middle', 'normal', FONT)
  })
  s += txt(bx, baseY + 21, 'Last 7 days', 8.5, C.text3)
  // month progress (unique identity)
  s += txt(x + 138, y + 116, 'AUGUST · DAY 19', 8.5, C.text3, 'start', 'bold', FONT, 0.8)
  s += rrect(x + 138, y + 122, 96, 6, 3, C.borderSoft)
  s += rrect(x + 138, y + 122, 96 * 0.61, 6, 3, C.green)
  s += txt(x + 138, y + 136, '61% of month elapsed', 9, C.text2)
  return s
}

/** Proposed card 3 — Approval rate (breathing room, target, clean marker) */
function proposedCard3(x, y, w) {
  const h = 152
  let s = ''
  s += rrect(x, y, w, h, 14, C.card, C.border)
  s += proposedHeader(x + 16, y + 15, w - 16, C.purple, 'rgba(155,124,246,.13)', 'trend', 'Approval rate')
  s += txt(x + 16, y + 66, '71.4%', 28, C.text, 'start', 'bold', MONO, 0.5)
  // delta pill
  s += rrect(x + 112, y + 52, 112, 20, 10, 'rgba(16,185,129,.13)')
  s += txt(x + 122, y + 66, '▲ 4.2% vs all-time', 9.5, C.green, 'start', 'bold', MONO)
  s += txt(x + 16, y + 84, 'of decisions approved · last 30 days', 10.5, C.text2)
  // progress with generous padding + clean marker
  const tx = x + 16, tw = w - 32, ty = y + 106, th = 10
  s += rrect(tx, ty, tw, th, 5, C.borderSoft)
  s += rrect(tx, ty, tw * 0.4, th, 5, 'rgba(239,68,68,.45)')
  s += rrect(tx + tw * 0.4, ty, tw * 0.3, th, 0, 'rgba(245,158,11,.5)')
  s += rrect(tx + tw * 0.7, ty, tw * 0.3, th, 5, 'rgba(16,185,129,.55)')
  s += rrect(tx, ty, tw * 0.714, th, 5, 'url(#accentRate)')
  // marker — white-ringed dot, floats over the fill, never touches the edges
  const mx = tx + tw * 0.714
  s += circle(mx, ty + th / 2, 6.5, C.card, C.green, 2.5)
  s += circle(mx, ty + th / 2, 2.5, C.green)
  // target notch at 80% + caption
  const gx = tx + tw * 0.8
  s += line(gx, ty - 6, gx, ty - 1, C.purple, 2)
  s += txt(gx, ty - 10, '80%', 8, C.purple, 'middle', 'bold', MONO)
  // zone captions — spaced, not glued
  s += txt(tx, ty + th + 15, 'Low', 9, C.text3)
  s += txt(tx + tw * 0.5, ty + th + 15, 'OK', 9, C.text3, 'middle')
  s += txt(tx + tw, ty + th + 15, 'Strong', 9, C.text3, 'end')
  return s
}

/** Proposed card 4 — Avg time to decide (enlarged gauge + thresholds) */
function proposedCard4(x, y, w) {
  const h = 152
  let s = ''
  s += rrect(x, y, w, h, 14, C.card, C.border)
  s += proposedHeader(x + 16, y + 15, w - 16, C.green, 'rgba(16,185,129,.13)', 'clock', 'Avg time to decide')
  // speedometer, larger, with real thresholds
  const sx = x + 20, sy = y + 32
  const R = 44
  const cx0 = sx + R, cy0 = sy + 50
  s += `<path d="M ${cx0 - R},${cy0} A ${R},${R} 0 0,1 ${cx0 + R},${cy0}" fill="none" stroke="${C.borderSoft}" stroke-width="7" stroke-linecap="round"/>`
  const pt = (deg) => {
    const rad = (deg * Math.PI) / 180
    return [cx0 + R * Math.sin(rad), cy0 - R * Math.cos(rad)]
  }
  const arc = (a1, a2, color) => {
    const [x1, y1] = pt(a1)
    const [x2, y2] = pt(a2)
    return `<path d="M ${x1},${y1} A ${R},${R} 0 0,1 ${x2},${y2}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/>`
  }
  s += arc(-90, -60, C.green)
  s += arc(-60, 10, C.amber)
  s += arc(10, 90, C.red)
  const ang = (42 / 480) * 180 - 90
  const [nx, ny] = pt(ang)
  s += `<line x1="${cx0}" y1="${cy0}" x2="${nx}" y2="${ny}" stroke="${C.text}" stroke-width="2.5" stroke-linecap="round"/>`
  s += circle(cx0, cy0, 4, C.text)
  s += txt(cx0 - R, cy0 + 14, '0m', 8.5, C.text3, 'middle')
  s += txt(cx0, cy0 + 14, '1h', 8.5, C.text3, 'middle')
  s += txt(cx0 + R, cy0 + 14, '8h+', 8.5, C.text3, 'middle')
  s += rrect(cx0 - 26, cy0 - 14, 52, 18, 9, 'rgba(16,185,129,.14)')
  s += circle(cx0 - 18, cy0 - 5, 3, C.green)
  s += txt(cx0 + 5, cy0 - 1, 'Fast', 10, C.green, 'middle', 'bold', FONT)
  // value + caption
  const vx = sx + R + R + 22
  s += txt(vx, y + 62, '42m', 28, C.text, 'start', 'bold', MONO)
  s += txt(vx, y + 82, 'avg time to review', 10.5, C.text2)
  s += txt(vx, y + 96, 'new findings', 10.5, C.text2)
  // thresholds legend — full width under the row
  s += circle(x + 22, y + 134, 3.5, C.green)
  s += txt(x + 29, y + 138, 'Fast <1h', 9, C.text3)
  s += circle(x + 88, y + 134, 3.5, C.amber)
  s += txt(x + 95, y + 138, 'OK 1–4h', 9, C.text3)
  s += circle(x + 156, y + 134, 3.5, C.red)
  s += txt(x + 163, y + 138, 'Slow >4h', 9, C.text3)
  return s
}

/** Proposed card 5 — Monthly usage (unchanged design, aligned) */
function proposedCard5(x, y, w) {
  const h = 152
  let s = ''
  s += rrect(x, y, w, h, 14, C.card, C.border)
  s += proposedHeader(x + 16, y + 15, w - 16, C.purple, 'rgba(155,124,246,.13)', 'wand', 'Monthly usage')
  s += circle(x + 34, y + 62, 15, 'none', C.border, 3.5)
  s += `<path d="M ${x + 34} ${y + 47} A 15 15 0 0 1 ${x + 45.6} ${y + 71.4}" fill="none" stroke="${C.purple}" stroke-width="3.5" stroke-linecap="round"/>`
  s += txt(x + 56, y + 63, '4/10', 20, C.text, 'start', 'bold', MONO)
  s += txt(x + 56, y + 80, 'Growth plan · 6 left', 10.5, C.text2)
  s += txt(x + 56, y + 94, 'Come back next month or', 10, C.text3)
  s += txt(x + 16, y + 118, 'Upgrade Plan  →', 10.5, C.purple)
  return s
}

// =============================================================
// Timeline — current vs proposed
// =============================================================

function currentTimeline(x, y, w) {
  const h = 210
  let s = ''
  s += rrect(x, y, w, h, 14, C.card, C.border)
  s += icon('activity', x + 15, y + 13, 14, C.text2)
  s += txt(x + 33, y + 24, 'YOUR ACTIVITY TIMELINE', 11, C.text2, 'start', 'bold', FONT, 0.3)
  // 30 thin bars
  const heights = [8, 22, 14, 34, 12, 26, 44, 18, 30, 24, 10, 38, 20, 28, 16, 42, 24, 12, 34, 26, 18, 46, 22, 14, 30, 20, 36, 16, 28, 40]
  const bw = 5, gap = 1.5, baseY = y + 96
  const maxH = 46
  heights.forEach((hv, i) => {
    const xx = x + 15 + i * (bw + gap)
    s += `<rect x="${xx}" y="${baseY - (hv / maxH) * 58}" width="${bw}" height="${(hv / maxH) * 58}" rx="1.5" fill="rgba(155,124,246,.3)"/>`
    if (i % 3 === 0) s += `<rect x="${xx}" y="${baseY - (hv / maxH) * 58}" width="${bw}" height="${Math.max(2, (hv / maxH) * 58 * 0.28)}" rx="1.5" fill="${C.green}" opacity=".85"/>`
  })
  s += txt(x + 15, y + 112, '128 found', 10, C.text, 'start', 'bold', MONO)
  s += txt(x + 70, y + 112, '41 approved', 10, C.text, 'start', 'bold', MONO)
  s += txt(x + w - 15, y + 112, 'last 30 days', 9, C.text3, 'end')
  s += txt(x + 15, y + 124, '■ Found    ■ Approved', 9.5, C.text3)
  s += txt(x + 15, y + 144, 'Your timeline fills in as your AI team', 10, C.text3)
  s += txt(x + 15, y + 157, 'works — generated vs approved, day by day.', 10, C.text3)
  s += txt(x + 15, y + 176, 'See sample activity  →', 10.5, C.purple)
  return s
}

function proposedTimeline(x, y, w) {
  const h = 210
  let s = ''
  s += rrect(x, y, w, h, 14, C.card, C.border)
  s += icon('activity', x + 15, y + 13, 14, C.green)
  s += txt(x + 33, y + 24, 'Activity — Last 30 Days', 12, C.text, 'start', 'bold', FONT)
  // area chart
  const ax = x + 15, aw = w - 30, ay = y + 34, ah = 74
  const gen = [12, 20, 15, 30, 22, 34, 28, 42, 26, 18, 36, 30, 46, 24, 32, 20, 40, 34, 26, 44, 30, 38, 22, 34, 42, 26, 36, 20, 30, 38]
  const app = [4, 8, 6, 12, 9, 14, 11, 18, 10, 8, 15, 12, 20, 9, 13, 7, 17, 14, 10, 18, 12, 16, 9, 13, 17, 10, 14, 8, 12, 15]
  const n = gen.length
  const maxV = 46
  const X = (i) => ax + (i / (n - 1)) * aw
  const Y = (v) => ay + ah - (v / maxV) * ah
  // gridlines
  ;[0.25, 0.5, 0.75].forEach((f) => {
    s += line(ax, ay + ah * f, ax + aw, ay + ah * f, 'rgba(120,133,157,.18)', 1, '3,3')
  })
  // area path (found)
  let d = `M ${X(0)} ${Y(gen[0])}`
  for (let i = 1; i < n; i++) d += ` L ${X(i).toFixed(1)} ${Y(gen[i]).toFixed(1)}`
  d += ` L ${X(n - 1)} ${ay + ah} L ${X(0)} ${ay + ah} Z`
  s += `<path d="${d}" fill="url(#areaGen)"/>`
  // approved line
  let dl = `M ${X(0)} ${Y(app[0])}`
  for (let i = 1; i < n; i++) dl += ` L ${X(i).toFixed(1)} ${Y(app[i]).toFixed(1)}`
  s += `<path d="${dl}" fill="none" stroke="${C.green}" stroke-width="2" stroke-linecap="round"/>`
  // endpoints dots
  const li = n - 1
  s += circle(X(li), Y(app[li]), 3, C.green, '#0F1117', 1.5)
  s += circle(X(li), Y(gen[li]), 3, C.purple, '#0F1117', 1.5)
  // x labels
  s += txt(ax, ay + ah + 12, 'Aug 1', 8.5, C.text3)
  s += txt(ax + aw * 0.33, ay + ah + 12, 'Aug 8', 8.5, C.text3, 'middle')
  s += txt(ax + aw * 0.66, ay + ah + 12, 'Aug 15', 8.5, C.text3, 'middle')
  s += txt(ax + aw, ay + ah + 12, 'Aug 19', 8.5, C.text3, 'end')
  // legend
  s += circle(ax, ay + ah + 26, 3.5, C.purple)
  s += txt(ax + 8, ay + ah + 30, 'Found', 9.5, C.text2)
  s += circle(ax + 52, ay + ah + 26, 3.5, C.green)
  s += txt(ax + 60, ay + ah + 30, 'Approved', 9.5, C.text2)
  // stats row
  s += rrect(ax, ay + ah + 38, aw, 34, 8, 'rgba(15,17,23,.4)', C.borderSoft)
  s += txt(ax + 10, ay + ah + 53, '128', 13, C.text, 'start', 'bold', MONO)
  s += txt(ax + 10, ay + ah + 65, 'found', 8.5, C.text3)
  s += txt(ax + 52, ay + ah + 53, '41', 13, C.text, 'start', 'bold', MONO)
  s += txt(ax + 52, ay + ah + 65, 'approved', 8.5, C.text3)
  s += rrect(ax + aw - 76, ay + ah + 45, 66, 20, 10, 'rgba(16,185,129,.14)')
  s += txt(ax + aw - 43, ay + ah + 59, '32% conversion', 9.5, C.green, 'middle', 'bold', MONO)
  s += txt(ax + 100, ay + ah + 65, 'hover a day for details', 8.5, C.text3)
  return s
}

// =============================================================
// Compositions
// =============================================================

const labelBand = (x, y, w, text, color) => {
  let s = ''
  s += rrect(x, y, 24, 24, 6, color)
  s += `<path d="M 8 17 L 16 7" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>` // arrow
  s += txt(x + 32, y + 17, text, 14, C.text, 'start', 'bold', FONT)
  return s
}

// ---- Image 1: overview current vs proposed ----
function imageOverview() {
  const W = 1360
  const cardW = 256
  const gap = 12
  const pad = 28
  const H = 150 + 300
  let s = ''
  s += rrect(0, 0, W, H, 0, C.bg)
  // headline
  s += txt(28, 44, 'Recommendations · Overview', 20, C.text, 'start', 'bold', FONT)
  s += txt(28, 64, 'Current (top) → Proposed (bottom) — four KPI cards, redesigned', 12.5, C.text2)
  // CURRENT row
  s += labelBand(28, 84, 150, 'CURRENT', 'rgba(120,133,157,.25)')
  const cy = 122
  const cxs = [pad]
  for (let i = 1; i < 5; i++) cxs.push(cxs[i - 1] + cardW + gap)
  s += currentCard1(cxs[0], cy, cardW)
  s += currentCard2(cxs[1], cy, cardW)
  s += currentCard3(cxs[2], cy, cardW)
  s += currentCard4(cxs[3], cy, cardW)
  s += currentCard5(cxs[4], cy, cardW)
  // PROPOSED row
  s += labelBand(28, cy + 118 + 24, 150, 'PROPOSED', 'rgba(16,185,129,.3)')
  const py = cy + 118 + 24 + 34
  s += proposedCard1(cxs[0], py, cardW)
  s += proposedCard2(cxs[1], py, cardW)
  s += proposedCard3(cxs[2], py, cardW)
  s += proposedCard4(cxs[3], py, cardW)
  s += proposedCard5(cxs[4], py, cardW)
  // defs
  s = `<defs>
    <linearGradient id="gbar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#059669"/><stop offset="1" stop-color="#34D399"/></linearGradient>
    <linearGradient id="accentRev" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#10B981"/><stop offset="1" stop-color="#9B7CF6"/></linearGradient>
    <linearGradient id="accentRate" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#059669"/><stop offset="1" stop-color="#34D399"/></linearGradient>
    <linearGradient id="areaGen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(155,124,246,.5)"/><stop offset="1" stop-color="rgba(155,124,246,.03)"/></linearGradient>
  </defs>` + s
  return svgTag(W, H, s)
}

// ---- Images 2-5: per-card zoom (current vs proposed) ----
function imageCardPair(title, note, currentFn, proposedFn, note2) {
  const W = 1060
  const cw = 280
  const cy = 130
  const py = 340
  const H = py + 190
  let s = ''
  s += rrect(0, 0, W, H, 0, C.bg)
  s += txt(28, 46, title, 20, C.text, 'start', 'bold', FONT)
  s += txt(28, 66, note, 12.5, C.text2)
  s += labelBand(28, 86, 150, 'CURRENT', 'rgba(120,133,157,.25)')
  s += currentFn(28, cy, cw)
  // annotation box
  s += rrect(340, cy + 6, W - 368, 96, 10, 'rgba(239,68,68,.06)', 'rgba(239,68,68,.28)')
  s += txt(356, cy + 26, 'What feels off', 11, C.red, 'start', 'bold', FONT)
  s += txt(356, cy + 46, note2, 11.5, C.text2)
  s += labelBand(28, py - 26, 150, 'PROPOSED', 'rgba(16,185,129,.3)')
  s += proposedFn(28, py, cw)
  s += rrect(340, py + 6, W - 368, 96, 10, 'rgba(16,185,129,.07)', 'rgba(16,185,129,.3)')
  s += txt(356, py + 26, 'What changes', 11, C.green, 'start', 'bold', FONT)
  s += txt(356, py + 46, note, 11.5, C.text2)
  return svgTag(W, H, s)
}

// ---- Image 6: timeline compare ----
function imageTimeline() {
  const W = 1060
  const cw = 300
  const H = 520
  let s = ''
  s += rrect(0, 0, W, H, 0, C.bg)
  s += txt(28, 46, 'Insights sidebar — Activity chart', 20, C.text, 'start', 'bold', FONT)
  s += txt(28, 66, 'Replacing the 30 stacked micro-bars with a real analytics-style area chart (recharts is already in the app)', 12.5, C.text2)
  s += labelBand(28, 86, 150, 'CURRENT', 'rgba(120,133,157,.25)')
  s += currentTimeline(28, 122, cw)
  s += rrect(360, 128, W - 388, 96, 10, 'rgba(239,68,68,.06)', 'rgba(239,68,68,.28)')
  s += txt(376, 148, 'What feels off', 11, C.red, 'start', 'bold', FONT)
  s += txt(376, 168, '• 30 paper-thin bars read as noise, no axis, no dates', 11.5, C.text2)
  s += txt(376, 186, '• Purple/green stacking is hard to compare at a glance', 11.5, C.text2)
  s += txt(376, 204, '• No trend or conversion signal', 11.5, C.text2)
  s += labelBand(28, 288, 150, 'PROPOSED', 'rgba(16,185,129,.3)')
  s += proposedTimeline(28, 326, cw)
  s += rrect(360, 332, W - 388, 128, 10, 'rgba(16,185,129,.07)', 'rgba(16,185,129,.3)')
  s += txt(376, 352, 'What changes', 11, C.green, 'start', 'bold', FONT)
  s += txt(376, 372, '• Smooth area chart: purple “Found” gradient + green “Approved” line', 11.5, C.text2)
  s += txt(376, 390, '• Dashed gridlines + real date labels (Aug 1 … Aug 19)', 11.5, C.text2)
  s += txt(376, 408, '• Legend and stats strip: found / approved / conversion %', 11.5, C.text2)
  s += txt(376, 426, '• Hover tooltips per day (interactive in the real build)', 11.5, C.text2)
  s += txt(376, 444, '• Empty state: same “see sample” toggle, now with axes', 11.5, C.text2)
  s = `<defs>
    <linearGradient id="areaGen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(155,124,246,.5)"/><stop offset="1" stop-color="rgba(155,124,246,.03)"/></linearGradient>
  </defs>` + s
  return svgTag(W, H, s)
}

// =============================================================
// Render
// =============================================================

const imgs = {
  '01-overview-current-vs-proposed.png': imageOverview(),
  '02-card-revenue-opportunity.png': imageCardPair(
    'Card 1 — Revenue Opportunity Pending',
    'Bigger number, clear hierarchy, teammates strip — the card stops feeling tiny.',
    currentCard1, proposedCard1,
    'Small 10px label + 22px value crammed into a 118px card; ring reads as decoration.',
  ),
  '03-card-approved-this-month.png': imageCardPair(
    'Card 2 — Approved This Month',
    'One clean green identity: count, modeled impact pill, weekly bars with day letters, month progress.',
    currentCard2, proposedCard2,
    'Green bars that turn purple on hover — no axis, no context, unclear accent.',
  ),
  '04-card-approval-rate.png': imageCardPair(
    'Card 3 — Approval Rate',
    'Value and marker get breathing room; floating marker, 80% target tick, delta pill, zone captions.',
    currentCard3, proposedCard3,
    '71.4% sits glued to the caption/progress bar with the marker hard against the zones; no space around it.',
  ),
  '05-card-avg-time-to-decide.png': imageCardPair(
    'Card 4 — Average Time to Decide',
    'Enlarged gauge with real thresholds (0m / 1h / 8h+), center status chip, legend under the value.',
    currentCard4, proposedCard4,
    'Tiny 96px gauge with no scale ticks; needle and “FAST” label feel detached from the value.',
  ),
  '06-timeline-current-vs-proposed.png': imageTimeline(),
}

for (const [name, svg] of Object.entries(imgs)) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1600 } })
  const png = resvg.render().asPng()
  fs.writeFileSync(path.join(OUT, name), png)
  console.log('wrote', name, png.length, 'bytes')
}
