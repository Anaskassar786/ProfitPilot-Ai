/**
 * Insights Hub chart kit (PR #50) — hand-built SVG primitives.
 *
 * House rules honored here:
 *  - NO line charts, NO donut/pie charts. We ship bubble, radar, heatmap,
 *    area-with-gradient, scatter, timeline, word cloud, network, treemap and
 *    diverging comparison bars instead.
 *  - Both themes: every stroke/fill flows through the `--ih-*` CSS custom
 *    properties defined in insights-hub.css (dark default, `.light-mode`
 *    overrides), never a hard-coded page color.
 *  - SSR-safe: components render through renderToStaticMarkup in tests, so
 *    nothing touches `document` at render time. Export does, and is guarded.
 *  - Tooltips: native <title> is always present; the charts also expose
 *    onSelect for interactive drilling.
 */

import { useId } from 'react'
import type { ReactNode } from 'react'

export type ChartPoint = Readonly<{ id: string; label: string; x: number; y: number; r?: number; tone?: string }>

const SVG_NS = 'http://www.w3.org/2000/svg'

function axisGrid(width: number, height: number, pad: { left: number; right: number; top: number; bottom: number }, columns = 4, rows = 4): ReactNode {
  const lines: ReactNode[] = []
  for (let index = 0; index <= columns; index += 1) {
    const x = pad.left + ((width - pad.left - pad.right) * index) / columns
    lines.push(<line key={`v${index}`} className="ih-chart-grid" x1={x} y1={pad.top} x2={x} y2={height - pad.bottom} />)
  }
  for (let index = 0; index <= rows; index += 1) {
    const y = pad.top + ((height - pad.top - pad.bottom) * index) / rows
    lines.push(<line key={`h${index}`} className="ih-chart-grid" x1={pad.left} y1={y} x2={width - pad.right} y2={y} />)
  }
  return <g>{lines}</g>
}

/* ── Bubble chart (pattern lab) ────────────────────────────────────────── */

export function InsightsBubbleChart({ points, width = 560, height = 300, xLabel, yLabel, onSelect }: {
  points: readonly ChartPoint[]
  width?: number
  height?: number
  xLabel: string
  yLabel: string
  onSelect?: (id: string) => void
}) {
  const pad = { left: 44, right: 18, top: 16, bottom: 34 }
  const scaleX = (value: number) => pad.left + (width - pad.left - pad.right) * value
  const scaleY = (value: number) => height - pad.bottom - (height - pad.top - pad.bottom) * value
  return (
    <svg className="ih-chart ih-bubble-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={points.length > 0 ? `${points.length} plotted signals` : 'No signals to plot'}>
      {axisGrid(width, height, pad)}
      <text className="ih-chart-axis-label" x={pad.left} y={height - 8}>{xLabel}</text>
      <text className="ih-chart-axis-label" x={12} y={pad.top + 4} transform={`rotate(-90 12 ${pad.top + 4})`}>{yLabel}</text>
      {points.map((point) => (
        <g key={point.id} className={`ih-bubble tone-${point.tone ?? 'violet'}`} onClick={() => onSelect?.(point.id)} role={onSelect ? 'button' : undefined}>
          <circle cx={scaleX(point.x)} cy={scaleY(point.y)} r={point.r ?? 12}>
            <title>{point.label}</title>
          </circle>
        </g>
      ))}
      {points.length === 0 && <text className="ih-chart-empty" x={width / 2} y={height / 2} textAnchor="middle">Nothing to plot yet</text>}
    </svg>
  )
}

/* ── Radar chart (personas) ────────────────────────────────────────────── */

export function InsightsRadarChart({ traits, size = 260 }: { traits: readonly Readonly<{ trait: string; score: number }>[]; size?: number }) {
  const gradientId = useId()
  const center = size / 2
  const radius = size / 2 - 34
  const count = Math.max(traits.length, 3)
  const pointAt = (index: number, scaleValue: number) => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2
    return `${center + Math.cos(angle) * radius * scaleValue},${center + Math.sin(angle) * radius * scaleValue}`
  }
  const ring = (scaleValue: number) => Array.from({ length: count }, (_, index) => pointAt(index, scaleValue)).join(' ')
  const shape = traits.length > 0 ? traits.map((trait, index) => pointAt(index, Math.max(0, Math.min(1, trait.score)))).join(' ') : ''
  return (
    <svg className="ih-chart ih-radar-chart" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Persona trait radar">
      <defs>
        <radialGradient id={gradientId}>
          <stop offset="0%" className="ih-radar-fill-start" />
          <stop offset="100%" className="ih-radar-fill-end" />
        </radialGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((scaleValue) => <polygon key={scaleValue} className="ih-radar-ring" points={ring(scaleValue)} />)}
      {traits.map((trait, index) => {
        const angle = (Math.PI * 2 * index) / count - Math.PI / 2
        const lx = center + Math.cos(angle) * (radius + 18)
        const ly = center + Math.sin(angle) * (radius + 18)
        return <text key={trait.trait} className="ih-radar-label" x={lx} y={ly} textAnchor="middle" dominantBaseline="middle">{trait.trait}<title>{`${trait.trait}: ${Math.round(trait.score * 100)}%`}</title></text>
      })}
      {shape && <polygon className="ih-radar-shape" points={shape} fill={`url(#${gradientId})`} />}
      {traits.map((trait, index) => {
        const [x, y] = pointAt(index, Math.max(0, Math.min(1, trait.score))).split(',')
        return <circle key={`dot-${trait.trait}`} className="ih-radar-dot" cx={x} cy={y} r={3}><title>{`${trait.trait}: ${Math.round(trait.score * 100)}%`}</title></circle>
      })}
    </svg>
  )
}

/* ── Heatmap (time patterns: weekday × hour) ───────────────────────────── */

export function InsightsHeatmap({ cells, xLabels, yLabels, emptyLabel = 'No cadence data yet' }: {
  cells: readonly Readonly<{ x: number; y: number; value: number; label?: string }>[]
  xLabels: readonly string[]
  yLabels: readonly string[]
  emptyLabel?: string
}) {
  const cell = { w: 34, h: 24 }
  const pad = { left: 46, top: 22 }
  const width = pad.left + xLabels.length * cell.w + 8
  const height = pad.top + yLabels.length * cell.h + 8
  const max = Math.max(1, ...cells.map((entry) => entry.value))
  const lookup = new Map(cells.map((entry) => [`${entry.x}:${entry.y}`, entry]))
  return (
    <svg className="ih-chart ih-heatmap" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Activity heatmap">
      {xLabels.map((label, index) => <text key={`x${label}`} className="ih-heatmap-label" x={pad.left + index * cell.w + cell.w / 2} y={12} textAnchor="middle">{label}</text>)}
      {yLabels.map((label, index) => <text key={`y${label}`} className="ih-heatmap-label" x={pad.left - 6} y={pad.top + index * cell.h + cell.h / 2 + 3} textAnchor="end">{label}</text>)}
      {yLabels.map((_, y) => xLabels.map((__, x) => {
        const entry = lookup.get(`${x}:${y}`)
        const intensity = entry ? entry.value / max : 0
        return (
          <rect key={`${x}-${y}`} className="ih-heatmap-cell" style={{ opacity: entry ? 0.15 + 0.85 * intensity : 0.05 }} x={pad.left + x * cell.w + 1.5} y={pad.top + y * cell.h + 1.5} width={cell.w - 3} height={cell.h - 3} rx={4}>
            <title>{entry?.label ?? `${yLabels[y]} ${xLabels[x]}: ${entry?.value ?? 0}`}</title>
          </rect>
        )
      }))}
      {cells.length === 0 && <text className="ih-chart-empty" x={width / 2} y={height / 2} textAnchor="middle">{emptyLabel}</text>}
    </svg>
  )
}

/* ── Area-with-gradient fan chart (predictions) ────────────────────────── */

export function InsightsAreaBand({ series, width = 560, height = 240, formatValue }: {
  series: readonly Readonly<{ day: string; value: number; lower: number; upper: number }>[]
  width?: number
  height?: number
  formatValue?: (value: number) => string
}) {
  const gradientId = useId()
  const pad = { left: 46, right: 14, top: 14, bottom: 30 }
  if (series.length === 0) {
    return <svg className="ih-chart ih-area-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="No forecast series"><text className="ih-chart-empty" x={width / 2} y={height / 2} textAnchor="middle">Forecast series pending</text></svg>
  }
  const maxValue = Math.max(...series.map((point) => point.upper), 1)
  const minValue = Math.min(...series.map((point) => point.lower), 0)
  const range = Math.max(1e-9, maxValue - minValue)
  const dx = (width - pad.left - pad.right) / Math.max(1, series.length - 1)
  const px = (index: number) => pad.left + dx * index
  const py = (value: number) => pad.top + (height - pad.top - pad.bottom) * (1 - (value - minValue) / range)
  const bandTop = series.map((point, index) => `${px(index)},${py(point.upper)}`).join(' ')
  const bandBottom = [...series].reverse().map((point, index) => `${px(series.length - 1 - index)},${py(point.lower)}`).join(' ')
  const midPoints = series.map((point, index) => ({ x: px(index), y: py(point.value), day: point.day, value: point.value }))
  const midPath = midPoints.map((point) => `${point.x},${point.y}`).join(' ')
  const format = formatValue ?? ((value: number) => String(Math.round(value)))
  return (
    <svg className="ih-chart ih-area-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Prediction band with confidence interval">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="ih-area-stop-start" />
          <stop offset="100%" className="ih-area-stop-end" />
        </linearGradient>
      </defs>
      {axisGrid(width, height, pad, 4, 3)}
      <polygon className="ih-area-band" points={`${bandTop} ${bandBottom}`} fill={`url(#${gradientId})`} />
      <polygon className="ih-area-mid" points={`${midPath} ${px(series.length - 1)},${py(minValue)} ${px(0)},${py(minValue)}`} />
      {midPoints.map((point, index) => (
        <circle key={`${point.day}-${index}`} className="ih-area-dot" cx={point.x} cy={point.y} r={3.4}>
          <title>{`${point.day}: ${format(point.value)} (range ${format(series[index]?.lower ?? 0)}–${format(series[index]?.upper ?? 0)})`}</title>
        </circle>
      ))}
      <text className="ih-chart-axis-label" x={pad.left} y={height - 8}>{series[0]?.day}</text>
      <text className="ih-chart-axis-label" x={width - pad.right - 8} y={height - 8} textAnchor="end">{series[series.length - 1]?.day}</text>
    </svg>
  )
}

/* ── Scatter plot (trend watcher) ──────────────────────────────────────── */

export function InsightsScatter({ points, width = 560, height = 280, xLabel, yLabel, onSelect }: {
  points: readonly ChartPoint[]
  width?: number
  height?: number
  xLabel: string
  yLabel: string
  onSelect?: (id: string) => void
}) {
  const pad = { left: 44, right: 18, top: 16, bottom: 34 }
  const scaleX = (value: number) => pad.left + (width - pad.left - pad.right) * value
  const scaleY = (value: number) => height - pad.bottom - (height - pad.top - pad.bottom) * value
  return (
    <svg className="ih-chart ih-scatter-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trend signal scatter">
      {axisGrid(width, height, pad)}
      <text className="ih-chart-axis-label" x={pad.left} y={height - 8}>{xLabel}</text>
      <text className="ih-chart-axis-label" x={12} y={pad.top + 4} transform={`rotate(-90 12 ${pad.top + 4})`}>{yLabel}</text>
      {points.map((point) => (
        <g key={point.id} className={`ih-scatter-dot tone-${point.tone ?? 'cyan'}`} onClick={() => onSelect?.(point.id)} role={onSelect ? 'button' : undefined}>
          <circle cx={scaleX(point.x)} cy={scaleY(point.y)} r={point.r ?? 5}><title>{point.label}</title></circle>
        </g>
      ))}
      {points.length === 0 && <text className="ih-chart-empty" x={width / 2} y={height / 2} textAnchor="middle">No signals yet</text>}
    </svg>
  )
}

/* ── Word cloud (knowledge tags / lesson themes) ───────────────────────── */

export function InsightsWordCloud({ words, onSelect }: { words: readonly Readonly<{ tag: string; weight: number }>[]; onSelect?: (tag: string) => void }) {
  if (words.length === 0) return <div className="ih-wordcloud empty">Tags appear here as your knowledge base grows.</div>
  const max = Math.max(...words.map((word) => word.weight), 1)
  return (
    <div className="ih-wordcloud" role="list" aria-label="Knowledge tag cloud">
      {words.map((word, index) => (
        <button key={word.tag} role="listitem" className={`ih-word depth-${index % 4}`} style={{ fontSize: `${12 + 12 * (word.weight / max)}px` }} onClick={() => onSelect?.(word.tag)} title={`${word.tag} · ${word.weight} ${word.weight === 1 ? 'entry' : 'entries'}`}>
          {word.tag}
        </button>
      ))}
    </div>
  )
}

/* ── Timeline strip (day buckets on a horizontal axis) ─────────────────── */

export function InsightsTimelineStrip({ events, width = 860, height = 120, onSelect }: {
  events: readonly Readonly<{ id: string; at: string; label: string; tone: string }>[]
  width?: number
  height?: number
  onSelect?: (id: string) => void
}) {
  const pad = { left: 16, right: 16, top: 26, bottom: 30 }
  if (events.length === 0) return <svg className="ih-chart ih-timeline-strip" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Empty timeline"><text className="ih-chart-empty" x={width / 2} y={height / 2} textAnchor="middle">Your insight timeline starts here</text></svg>
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const min = Date.parse(sorted[0]?.at ?? '') || 0
  const max = Date.parse(sorted[sorted.length - 1]?.at ?? '') || 1
  const span = Math.max(1, max - min)
  const lane = (id: string) => {
    let hash = 0
    for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) % 997
    return pad.top + ((height - pad.top - pad.bottom) * (hash % 3)) / 2.4
  }
  return (
    <svg className="ih-chart ih-timeline-strip" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${events.length} timeline events`}>
      <line className="ih-chart-grid" x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} />
      {sorted.map((event) => {
        const x = pad.left + ((Date.parse(event.at) - min) / span) * (width - pad.left - pad.right)
        return (
          <g key={event.id} className={`ih-timeline-node tone-${event.tone}`} onClick={() => onSelect?.(event.id)} role={onSelect ? 'button' : undefined}>
            <line className="ih-timeline-stem" x1={x} y1={lane(event.id)} x2={x} y2={height - pad.bottom} />
            <circle cx={x} cy={lane(event.id)} r={5}><title>{event.label}</title></circle>
          </g>
        )
      })}
      <text className="ih-chart-axis-label" x={pad.left} y={height - 8}>{sorted[0]?.at.slice(0, 10)}</text>
      <text className="ih-chart-axis-label" x={width - pad.right - 8} y={height - 8} textAnchor="end">{sorted[sorted.length - 1]?.at.slice(0, 10)}</text>
    </svg>
  )
}

/* ── Network graph (knowledge link map) ────────────────────────────────── */

export type NetworkNode = Readonly<{ id: string; label: string; kind: string }>
export type NetworkEdge = Readonly<{ from: string; to: string }>

export function InsightsNetworkGraph({ nodes, edges, size = 320, onSelect }: { nodes: readonly NetworkNode[]; edges: readonly NetworkEdge[]; size?: number; onSelect?: (id: string) => void }) {
  const center = size / 2
  const radius = size / 2 - 44
  const positions = new Map(nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, nodes.length) - Math.PI / 2
    return [node.id, { x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius }] as const
  }))
  return (
    <svg className="ih-chart ih-network" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Linked insights network">
      {edges.map((edge, index) => {
        const from = positions.get(edge.from)
        const to = positions.get(edge.to)
        if (!from || !to) return null
        return <line key={`${edge.from}-${edge.to}-${index}`} className="ih-network-edge" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      })}
      {nodes.map((node) => {
        const position = positions.get(node.id)
        if (!position) return null
        return (
          <g key={node.id} className={`ih-network-node kind-${node.kind.toLowerCase()}`} onClick={() => onSelect?.(node.id)} role={onSelect ? 'button' : undefined}>
            <circle cx={position.x} cy={position.y} r={13}><title>{node.label}</title></circle>
            <text className="ih-network-label" x={position.x} y={position.y + 26} textAnchor="middle">{node.label.length > 14 ? `${node.label.slice(0, 14)}…` : node.label}</text>
          </g>
        )
      })}
      {nodes.length === 0 && <text className="ih-chart-empty" x={center} y={center} textAnchor="middle">Link discoveries and lessons to see the graph</text>}
    </svg>
  )
}

/* ── Treemap (revenue concentration) ───────────────────────────────────── */

export function InsightsTreeMap({ blocks, width = 560, height = 240, onSelect }: {
  blocks: readonly Readonly<{ id: string; label: string; value: number }>[]
  width?: number
  height?: number
  onSelect?: (id: string) => void
}) {
  const total = blocks.reduce((sum, block) => sum + Math.max(0, block.value), 0)
  if (blocks.length === 0 || total <= 0) return <svg className="ih-chart ih-treemap" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="No concentration data"><text className="ih-chart-empty" x={width / 2} y={height / 2} textAnchor="middle">Concentration appears once products sell</text></svg>
  // Simple slice-and-dice layout: stable, deterministic, no external deps.
  const sorted = [...blocks].sort((a, b) => b.value - a.value)
  const rects: { id: string; label: string; x: number; y: number; w: number; h: number; share: number }[] = []
  let remaining = sorted.map((block) => ({ ...block }))
  let area = { x: 0, y: 0, w: width, h: height }
  while (remaining.length > 0) {
    const remainingTotal = remaining.reduce((sum, block) => sum + block.value, 0)
    const [head, ...tail] = remaining
    if (!head || remainingTotal <= 0) break
    const share = head.value / remainingTotal
    if (area.w >= area.h) {
      const w = area.w * share
      rects.push({ id: head.id, label: head.label, x: area.x, y: area.y, w, h: area.h, share: head.value / total })
      area = { x: area.x + w, y: area.y, w: area.w - w, h: area.h }
    } else {
      const h = area.h * share
      rects.push({ id: head.id, label: head.label, x: area.x, y: area.y, w: area.w, h, share: head.value / total })
      area = { x: area.x, y: area.y + h, w: area.w, h: area.h - h }
    }
    remaining = tail
  }
  return (
    <svg className="ih-chart ih-treemap" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Revenue concentration treemap">
      {rects.map((rect, index) => (
        <g key={rect.id} className={`ih-treemap-block depth-${index % 5}`} onClick={() => onSelect?.(rect.id)} role={onSelect ? 'button' : undefined}>
          <rect x={rect.x + 1.5} y={rect.y + 1.5} width={Math.max(0, rect.w - 3)} height={Math.max(0, rect.h - 3)} rx={6}>
            <title>{`${rect.label} — ${Math.round(rect.share * 100)}%`}</title>
          </rect>
          {rect.w > 84 && rect.h > 30 && <text className="ih-treemap-label" x={rect.x + 10} y={rect.y + 20}>{rect.label.length > 18 ? `${rect.label.slice(0, 18)}…` : rect.label}</text>}
          {rect.w > 84 && rect.h > 46 && <text className="ih-treemap-value" x={rect.x + 10} y={rect.y + 36}>{Math.round(rect.share * 100)}%</text>}
        </g>
      ))}
    </svg>
  )
}

/* ── Diverging comparison bars ─────────────────────────────────────────── */

export function InsightsComparisonBars({ rows, formatValue }: {
  rows: readonly Readonly<{ metric: string; a: number | null; b: number | null; winner: 'A' | 'B' | 'TIE' }>[]
  formatValue?: (value: number | null) => string
}) {
  const format = formatValue ?? ((value: number | null) => (value === null ? '—' : String(Math.round(value))))
  return (
    <div className="ih-compare-bars" role="img" aria-label="Side-by-side comparison">
      {rows.map((row) => {
        const max = Math.max(Math.abs(row.a ?? 0), Math.abs(row.b ?? 0), 1)
        const aPct = row.a === null ? 0 : (Math.abs(row.a) / max) * 100
        const bPct = row.b === null ? 0 : (Math.abs(row.b) / max) * 100
        return (
          <div key={row.metric} className="ih-compare-row">
            <div className="ih-compare-metric">{row.metric}</div>
            <div className="ih-compare-track">
              <div className={`ih-compare-bar a ${row.winner === 'A' ? 'wins' : ''}`} style={{ width: `${aPct}%` }}><span>{format(row.a)}</span></div>
              <div className={`ih-compare-bar b ${row.winner === 'B' ? 'wins' : ''}`} style={{ width: `${bPct}%` }}><span>{format(row.b)}</span></div>
            </div>
          </div>
        )
      })}
      {rows.length === 0 && <div className="ih-compare-empty">Run a comparison to see metrics side by side.</div>}
    </div>
  )
}

/* ── Sankey-lite flow (discovery → action funnel) ──────────────────────── */

export function InsightsFlowChart({ stages, width = 560, height = 200, onSelect }: {
  stages: readonly Readonly<{ id: string; label: string; value: number }>[]
  width?: number
  height?: number
  onSelect?: (id: string) => void
}) {
  if (stages.length === 0) return <svg className="ih-chart ih-flow" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="No flow data"><text className="ih-chart-empty" x={width / 2} y={height / 2} textAnchor="middle">Funnel appears as discoveries move through review</text></svg>
  const max = Math.max(...stages.map((stage) => stage.value), 1)
  const columnWidth = (width - 24) / stages.length
  return (
    <svg className="ih-chart ih-flow" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Discovery review funnel">
      {stages.map((stage, index) => {
        const barHeight = Math.max(10, ((height - 64) * stage.value) / max)
        const x = 12 + index * columnWidth + columnWidth * 0.18
        const y = height - 30 - barHeight
        const next = stages[index + 1]
        return (
          <g key={stage.id}>
            {next && (
              <path
                className="ih-flow-ribbon"
                d={`M ${x + columnWidth * 0.64} ${y + barHeight / 2} C ${x + columnWidth * 0.9} ${y + barHeight / 2}, ${x + columnWidth} ${height - 30 - Math.max(10, ((height - 64) * next.value) / max) + Math.max(10, ((height - 64) * next.value) / max) / 2}, ${12 + (index + 1) * columnWidth + columnWidth * 0.18} ${height - 30 - Math.max(10, ((height - 64) * next.value) / max) + Math.max(10, ((height - 64) * next.value) / max) / 2}`}
              />
            )}
            <g className="ih-flow-stage" onClick={() => onSelect?.(stage.id)} role={onSelect ? 'button' : undefined}>
              <rect x={x} y={y} width={columnWidth * 0.64} height={barHeight} rx={7}><title>{`${stage.label}: ${stage.value}`}</title></rect>
              <text className="ih-flow-value" x={x + columnWidth * 0.32} y={y - 7} textAnchor="middle">{stage.value}</text>
              <text className="ih-flow-label" x={x + columnWidth * 0.32} y={height - 12} textAnchor="middle">{stage.label}</text>
            </g>
          </g>
        )
      })}
    </svg>
  )
}

/* ── Export helper ─────────────────────────────────────────────────────── */

/**
 * Serializes the first SVG under `container` into a downloadable .svg file.
 * Guarded for SSR/embedded contexts — returns false instead of throwing.
 */
export function downloadChartSvg(container: HTMLElement | null, filename: string): boolean {
  if (!container || typeof document === 'undefined') return false
  const svg = container.querySelector('svg')
  if (!svg) return false
  try {
    const clone = svg.cloneNode(true) as SVGElement
    clone.setAttribute('xmlns', SVG_NS)
    const markup = new XMLSerializer().serializeToString(clone)
    const blob = new Blob([markup], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename.endsWith('.svg') ? filename : `${filename}.svg`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}
