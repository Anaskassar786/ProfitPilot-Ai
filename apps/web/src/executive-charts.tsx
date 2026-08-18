/**
 * GrowthIQ (formerly "AI Executive") — chart library.
 *
 * Hand-rolled SVG charts that read colors from CSS custom properties, so
 * every chart adapts automatically to the dark and light themes. Deliberate
 * chart vocabulary per the PR spec: area charts with gradient fills, radial
 * gauges, sparklines, stacked bars, waterfalls, horizontal bars, bubble
 * (risk) maps, bullet (goal vs actual) charts, and heatmaps. No line and no
 * donut charts.
 */
import { useCallback, useId, useMemo, useRef, useState } from 'react'

// ────────────────────────────────────────────────────────────────────────────
// Radial health gauge
// ────────────────────────────────────────────────────────────────────────────

export function ExecutiveRadialGauge({ score, label, sublabel, size = 180 }: { score: number; label: string; sublabel?: string; size?: number }) {
  const radius = size / 2 - 16
  const circumference = 2 * Math.PI * radius
  // 270° sweep starting at 135°.
  const sweep = circumference * 0.75
  const filled = Math.min(Math.max(score / 100, 0), 1) * sweep
  return (
    <div className="exec-gauge" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${score} out of 100`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle className="exec-gauge-track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={13} strokeDasharray={`${sweep} ${circumference}`} transform={`rotate(135 ${size / 2} ${size / 2})`} strokeLinecap="round" />
        <circle className="exec-gauge-fill" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={13} strokeDasharray={`${Math.max(filled, 1)} ${circumference}`} transform={`rotate(135 ${size / 2} ${size / 2})`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 700ms ease' }} />
      </svg>
      <div className="exec-gauge-center">
        <strong>{score}<small>/100</small></strong>
        <span>{label}</span>
        {sublabel ? <em>{sublabel}</em> : null}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Area chart with gradient fill
// ────────────────────────────────────────────────────────────────────────────

export function ExecutiveAreaChart({ points, height = 180, formatValue, label }: { points: readonly Readonly<{ day: string; value: number }>[]; height?: number; formatValue?: (value: number) => string; label: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const width = 720
  const padX = 8
  const padY = 18
  const values = points.map((point) => point.value)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  const step = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0
  const coords = points.map((point, index) => ({ x: padX + index * step, y: padY + (1 - (point.value - min) / span) * (height - padY * 2), point }))
  const line = coords.map((coord) => `${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(' ')
  const active = hover !== null ? coords[hover] ?? null : null
  return (
    <div className="exec-area-chart" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        <defs>
          <linearGradient id="exec-area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--exec-accent)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--exec-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((fraction) => <line key={fraction} x1={padX} x2={width - padX} y1={padY + fraction * (height - padY * 2)} y2={padY + fraction * (height - padY * 2)} className="exec-chart-gridline" />)}
        {points.length > 1 && <polygon points={`${padX},${height - padY} ${line} ${width - padX},${height - padY}`} fill="url(#exec-area-fill)" />}
        {points.length > 1 && <polyline points={line} fill="none" className="exec-area-stroke" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {coords.map((coord, index) => <circle key={coord.point.day} cx={coord.x} cy={coord.y} r={hover === index ? 4 : 2.4} className="exec-area-dot" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} />)}
        {active && <g><line x1={active.x} x2={active.x} y1={padY} y2={height - padY} className="exec-chart-cursor" /><circle cx={active.x} cy={active.y} r={4.5} className="exec-area-dot" /></g>}
      </svg>
      <div className="exec-chart-legend">
        <span>{points[0]?.day.slice(5) ?? ''}</span>
        <span>{active ? `${active.point.day} · ${formatValue ? formatValue(active.point.value) : active.point.value}` : (formatValue ? formatValue(points.at(-1)?.value ?? 0) : String(points.at(-1)?.value ?? 0))}</span>
        <span>{points.at(-1)?.day.slice(5) ?? ''}</span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Sparkline (inline on metric cards)
// ────────────────────────────────────────────────────────────────────────────

export function ExecutiveSparkline({ points, width = 96, height = 26, tone = 'var(--exec-accent)' }: { points: readonly number[]; width?: number; height?: number; tone?: string }) {
  if (points.length < 2) return <div className="exec-sparkline-empty" style={{ width, height }} />
  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const span = Math.max(max - min, 1)
  const step = (width - 4) / (points.length - 1)
  const coords = points.map((value, index) => `${(2 + index * step).toFixed(1)},${(height - 4 - ((value - min) / span) * (height - 8)).toFixed(1)}`).join(' ')
  return (
    <svg className="exec-sparkline" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <polyline points={coords} fill="none" stroke={tone} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={width - 2} cy={Number(coords.split(' ').at(-1)!.split(',')[1])} r={2} fill={tone} />
    </svg>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Stacked bar chart
// ────────────────────────────────────────────────────────────────────────────

export type StackedBarSegment = Readonly<{ key: string; label: string; value: number; tone: string }>

export function ExecutiveStackedBars({ groups, height = 150, formatValue }: { groups: readonly Readonly<{ label: string; segments: readonly StackedBarSegment[] }>[]; height?: number; formatValue?: (value: number) => string }) {
  const [hover, setHover] = useState<Readonly<{ group: number; segment: number }> | null>(null)
  const width = 720
  const padX = 12
  const padY = 20
  const totals = groups.map((group) => group.segments.reduce((sum, segment) => sum + segment.value, 0))
  const max = Math.max(...totals, 1)
  const groupWidth = (width - padX * 2) / Math.max(groups.length, 1)
  return (
    <div className="exec-stacked" role="img" aria-label="Stacked comparison">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }}>
        {[0.25, 0.5, 0.75].map((fraction) => <line key={fraction} x1={padX} x2={width - padX} y1={padY + fraction * (height - padY * 2)} y2={padY + fraction * (height - padY * 2)} className="exec-chart-gridline" />)}
        {groups.map((group, groupIndex) => {
          const x = padX + groupIndex * groupWidth + groupWidth * 0.12
          const barWidth = groupWidth * 0.62
          let cursor = height - padY
          return (
            <g key={group.label}>
              {group.segments.map((segment, segmentIndex) => {
                const barHeight = totals[groupIndex]! > 0 ? (segment.value / max) * (height - padY * 2) : 0
                cursor -= barHeight
                const bar = <rect key={segment.key} x={x} y={cursor} width={barWidth} height={Math.max(barHeight, 0)} className={`exec-stack-segment tone-${segment.tone}`} onMouseEnter={() => setHover({ group: groupIndex, segment: segmentIndex })} onMouseLeave={() => setHover(null)} rx={segmentIndex === group.segments.length - 1 ? 3 : 0} />
                return bar
              })}
              <text x={x + barWidth / 2} y={height - padY + 12} textAnchor="middle" className="exec-chart-label">{group.label}</text>
            </g>
          )
        })}
        {hover && (
          <g>
            <rect x={width - 190} y={8} width={180} height={34} rx={6} className="exec-chart-tooltip-box" />
            <text x={width - 180} y={29} className="exec-chart-tooltip-text">
              {groups[hover.group]!.segments[hover.segment]!.label}: {formatValue ? formatValue(groups[hover.group]!.segments[hover.segment]!.value) : groups[hover.group]!.segments[hover.segment]!.value}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Waterfall chart (financial impact)
// ────────────────────────────────────────────────────────────────────────────

export type WaterfallStep = Readonly<{ label: string; value: number; kind: 'start' | 'up' | 'down' | 'total' }>

export function ExecutiveWaterfall({ steps, height = 170, formatValue }: { steps: readonly WaterfallStep[]; height?: number; formatValue?: (value: number) => string }) {
  const width = 720
  const padX = 12
  const padY = 22
  let cumulative = 0
  const anchors = steps.map((step) => {
    const start = cumulative
    cumulative = step.kind === 'down' ? cumulative - Math.abs(step.value) : cumulative + Math.abs(step.value)
    return { step, start, end: cumulative }
  })
  const values = anchors.flatMap((anchor) => [anchor.start, anchor.end])
  const max = Math.max(...values.map((value) => Math.abs(value)), 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  const groupWidth = (width - padX * 2) / Math.max(steps.length, 1)
  const yAt = (value: number): number => padY + (1 - (value - min) / span) * (height - padY * 2)
  return (
    <div className="exec-waterfall" role="img" aria-label="Financial impact waterfall">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }}>
        <line x1={padX} x2={width - padX} y1={yAt(0)} y2={yAt(0)} className="exec-chart-baseline" />
        {anchors.map((anchor, index) => {
          const x = padX + index * groupWidth + groupWidth * 0.2
          const barWidth = groupWidth * 0.5
          const top = Math.min(yAt(anchor.start), yAt(anchor.end))
          const barHeight = Math.max(Math.abs(yAt(anchor.start) - yAt(anchor.end)), 1.5)
          const tone = anchor.step.kind === 'down' ? 'exec-waterfall-down' : anchor.step.kind === 'total' ? 'exec-waterfall-total' : 'exec-waterfall-up'
          return (
            <g key={anchor.step.label}>
              {index > 0 && <line x1={x - groupWidth * 0.25} x2={x} y1={yAt(anchors[index - 1]!.end)} y2={yAt(anchors[index - 1]!.end)} className="exec-chart-connector" strokeDasharray="3 3" />}
              <rect x={x} y={top} width={barWidth} height={barHeight} className={tone} rx={2} />
              <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" className="exec-chart-label">{anchor.step.label}</text>
              <text x={x + barWidth / 2} y={top - 5} textAnchor="middle" className="exec-chart-label">{formatValue ? formatValue(anchor.step.value) : anchor.step.value}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Horizontal bar chart (rankings)
// ────────────────────────────────────────────────────────────────────────────

export type HorizontalBarRow = Readonly<{ label: string; value: number; display: string; tone?: string }>

export function ExecutiveHorizontalBars({ rows, formatValue }: { rows: readonly HorizontalBarRow[]; formatValue?: (value: number) => string }) {
  const max = Math.max(...rows.map((row) => Math.max(row.value, 0)), 1)
  return (
    <div className="exec-hbars" role="img" aria-label="Horizontal ranking">
      {rows.map((row) => (
        <div className="exec-hbar-row" key={row.label}>
          <span className="exec-hbar-label" title={row.label}>{row.label}</span>
          <div className="exec-hbar-track">
            <span className={`exec-hbar-fill ${row.tone ? `tone-${row.tone}` : ''}`} style={{ width: `${Math.min(Math.max((row.value / max) * 100, 0), 100)}%` }} />
          </div>
          <span className="exec-hbar-value">{row.display || (formatValue ? formatValue(row.value) : String(row.value))}</span>
        </div>
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Bubble chart (risk map)
// ────────────────────────────────────────────────────────────────────────────

export type BubblePoint = Readonly<{ id: string; label: string; x: number; y: number; size: number; tone: string; detail: string }>

export function ExecutiveBubbleMap({ points, xLabel, yLabel, height = 260 }: { points: readonly BubblePoint[]; xLabel: string; yLabel: string; height?: number }) {
  const [hover, setHover] = useState<string | null>(null)
  const width = 720
  const pad = 40
  const plotW = width - pad * 2
  const plotH = height - pad * 2
  const active = points.find((point) => point.id === hover) ?? null
  return (
    <div className="exec-bubble-map" role="img" aria-label={`${yLabel} vs ${xLabel} risk map`}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }}>
        {[0.25, 0.5, 0.75].map((fraction) => <line key={fraction} x1={pad} x2={width - pad} y1={pad + fraction * plotH} y2={pad + fraction * plotH} className="exec-chart-gridline" />)}
        {[0.25, 0.5, 0.75].map((fraction) => <line key={`v${fraction}`} x1={pad + fraction * plotW} x2={pad + fraction * plotW} y1={pad} y2={height - pad} className="exec-chart-gridline" />)}
        {points.map((point) => (
          <circle key={point.id} cx={pad + point.x * plotW} cy={height - pad - point.y * plotH} r={Math.max(7, point.size)} className={`exec-bubble tone-${point.tone}`} onMouseEnter={() => setHover(point.id)} onMouseLeave={() => setHover(null)} />
        ))}
        <text x={width / 2} y={height - 6} textAnchor="middle" className="exec-chart-label">{xLabel}</text>
        <text x={12} y={height / 2} textAnchor="middle" className="exec-chart-label" transform={`rotate(-90 12 ${height / 2})`}>{yLabel}</text>
        {active && (
          <g>
            <rect x={width - 240} y={10} width={230} height={40} rx={6} className="exec-chart-tooltip-box" />
            <text x={width - 228} y={30} className="exec-chart-tooltip-text">{active.label} · {active.detail}</text>
          </g>
        )}
      </svg>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Bullet chart (goal vs actual)
// ────────────────────────────────────────────────────────────────────────────

export function ExecutiveBullet({ actual, target, display, targetDisplay }: { actual: number; target: number; display: string; targetDisplay: string }) {
  const max = Math.max(actual, target, 1) * 1.25
  const actualWidth = Math.min((actual / max) * 100, 100)
  const targetPosition = Math.min((target / max) * 100, 98)
  return (
    <div className="exec-bullet" role="img" aria-label={`Actual ${display}, target ${targetDisplay}`}>
      <div className="exec-bullet-track">
        <span className="exec-bullet-actual" style={{ width: `${actualWidth}%` }} />
        <span className="exec-bullet-target" style={{ left: `${targetPosition}%` }} />
      </div>
      <div className="exec-bullet-legend">
        <span>Actual: <strong>{display}</strong></span>
        <span>Target: <strong>{targetDisplay}</strong></span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Percentile bar (benchmark position)
// ────────────────────────────────────────────────────────────────────────────

export function ExecutivePercentileBar({ percentile, topLabel, medianLabel }: { percentile: number | null; topLabel: string; medianLabel: string }) {
  if (percentile === null) {
    return <div className="exec-percentile empty">Not measurable yet — sync more history.</div>
  }
  const quartiles = [10, 25, 50, 75, 90].map((tick) => ({ tick, label: tick === 50 ? 'Median' : tick === 90 ? 'Top 10%' : tick === 75 ? 'Top 25%' : tick === 10 ? 'Bottom' : '' }))
  return (
    <div className="exec-percentile" role="img" aria-label={`${percentile}th percentile`}>
      <div className="exec-percentile-track">
        <span className="exec-percentile-fill" style={{ width: `${Math.min(Math.max(percentile, 1), 99)}%` }} />
        {quartiles.map(({ tick, label }) => <span key={tick} className="exec-percentile-tick" style={{ left: `${tick}%` }} title={label} />)}
        <span className="exec-percentile-marker" style={{ left: `${Math.min(Math.max(percentile, 1), 99)}%` }} />
      </div>
      <div className="exec-percentile-labels">
        <span>{medianLabel}</span>
        <span>{topLabel}</span>
      </div>
      <span className="exec-percentile-badge">{percentile}th percentile</span>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Heatmap (risk matrix)
// ────────────────────────────────────────────────────────────────────────────

export type HeatmapCell = Readonly<{ x: number; y: number; value: number; label: string }>

export function ExecutiveHeatmap({ cells, xLabels, yLabels, height = 190 }: { cells: readonly HeatmapCell[]; xLabels: readonly string[]; yLabels: readonly string[]; height?: number }) {
  const width = 720
  const padX = 90
  const padY = 22
  const cellW = (width - padX - 14) / Math.max(xLabels.length, 1)
  const cellH = (height - padY - 12) / Math.max(yLabels.length, 1)
  const max = Math.max(...cells.map((cell) => cell.value), 1)
  return (
    <div className="exec-heatmap" role="img" aria-label="Risk heatmap">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }}>
        {yLabels.map((label, index) => <text key={label} x={padX - 8} y={padY + index * cellH + cellH / 2 + 3} textAnchor="end" className="exec-chart-label">{label}</text>)}
        {xLabels.map((label, index) => <text key={label} x={padX + index * cellW + cellW / 2} y={height - 4} textAnchor="middle" className="exec-chart-label">{label}</text>)}
        {cells.map((cell) => (
          <rect key={`${cell.x}-${cell.y}-${cell.label}`} x={padX + cell.x * cellW + 1.5} y={padY + cell.y * cellH + 1.5} width={cellW - 3} height={cellH - 3} rx={4} className="exec-heat-cell" style={{ opacity: 0.12 + 0.88 * (cell.value / max) }} />
        ))}
        {cells.filter((cell) => cell.value > 0).map((cell) => (
          <text key={`v-${cell.x}-${cell.y}`} x={padX + cell.x * cellW + cellW / 2} y={padY + cell.y * cellH + cellH / 2 + 3} textAnchor="middle" className="exec-heat-value">{cell.label}</text>
        ))}
      </svg>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Business trajectory — real history + dashed trend projection + band
// ────────────────────────────────────────────────────────────────────────────

export type TrajectoryChartData = Readonly<{
  historical: readonly Readonly<{ day: string; value: number }>[]
  projected: readonly Readonly<{ day: string; value: number }>[]
  band: readonly Readonly<{ day: string; low: number; high: number }>[]
}>

export type TrajectoryHoverKind = 'Real' | 'Projected'

export type TrajectoryHoverPoint = Readonly<{
  index: number
  x: number
  y: number
  day: string
  value: number
  kind: TrajectoryHoverKind
}>

export const TRAJECTORY_CHART_WIDTH = 760

/** Formats a YYYY-MM-DD chart day without timezone shifts. */
export function formatTrajectoryDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day)
  if (!match) return day
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`
}

/**
 * Builds the hoverable plot points for the trajectory chart. Historical days
 * are labeled Real; the 30-day trend extension is labeled Projected.
 */
export function buildTrajectoryHoverPoints(data: TrajectoryChartData, height = 200, padX = 10, padTop = 16, padBottom = 22, width = TRAJECTORY_CHART_WIDTH): readonly TrajectoryHoverPoint[] {
  const all = [...data.historical, ...data.projected]
  if (all.length < 2) return []
  const max = Math.max(...all.map((point) => point.value), ...data.band.map((point) => point.high), 1)
  const step = (width - padX * 2) / (all.length - 1)
  const yAt = (value: number): number => padTop + (1 - Math.max(value, 0) / max) * (height - padTop - padBottom)
  return all.map((point, index) => ({
    index,
    x: padX + index * step,
    y: yAt(point.value),
    day: point.day,
    value: point.value,
    kind: index < data.historical.length ? 'Real' : 'Projected',
  }))
}

/** Maps a viewBox X coordinate to the nearest real or projected day. */
export function nearestTrajectoryPoint(points: readonly TrajectoryHoverPoint[], viewX: number): TrajectoryHoverPoint | null {
  if (points.length === 0) return null
  let best = points[0]!
  let bestDist = Math.abs(best.x - viewX)
  for (const point of points) {
    const dist = Math.abs(point.x - viewX)
    if (dist < bestDist) {
      best = point
      bestDist = dist
    }
  }
  return best
}

/**
 * Renders REAL synced revenue as a solid area, the measured trend extension
 * as a dashed line, and the residual-based confidence band as a soft wash.
 * Pointer/touch tracking shows a crosshair + tooltip (date, value, Real /
 * Projected) so the chart is interactive in both themes.
 */
export function ExecutiveTrajectoryChart({ data, height = 200, formatValue, label }: { data: TrajectoryChartData; height?: number; formatValue?: (value: number) => string; label: string }) {
  const gradientId = useId()
  const bandId = useId()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hover, setHover] = useState<TrajectoryHoverPoint | null>(null)
  const width = TRAJECTORY_CHART_WIDTH
  const padX = 10
  const padTop = 16
  const padBottom = 22
  const all = [...data.historical, ...data.projected]
  const highs = data.band.map((point) => point.high)
  const max = Math.max(...all.map((point) => point.value), ...highs, 1)
  const n = all.length
  const hoverPoints = useMemo(() => buildTrajectoryHoverPoints(data, height, padX, padTop, padBottom, width), [data, height])
  const pointFromClient = useCallback((clientX: number): TrajectoryHoverPoint | null => {
    const svg = svgRef.current
    if (!svg) return nearestTrajectoryPoint(hoverPoints, clientX)
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0) return nearestTrajectoryPoint(hoverPoints, 0)
    const viewX = ((clientX - rect.left) / rect.width) * width
    return nearestTrajectoryPoint(hoverPoints, viewX)
  }, [hoverPoints, width])
  const onPointer = useCallback((event: { clientX: number }) => {
    setHover(pointFromClient(event.clientX))
  }, [pointFromClient])
  if (n < 2) return null
  const step = (width - padX * 2) / (n - 1)
  const yAt = (value: number): number => padTop + (1 - Math.max(value, 0) / max) * (height - padTop - padBottom)
  const xAt = (index: number): number => padX + index * step
  const histCount = data.historical.length
  const histLine = data.historical.map((point, index) => `${xAt(index).toFixed(1)},${yAt(point.value).toFixed(1)}`).join(' ')
  // The projection stroke starts at the last REAL point so the dashed line
  // reads as a continuation, not a separate series.
  const projectionPoints = [{ day: data.historical.at(-1)!.day, value: data.historical.at(-1)!.value }, ...data.projected]
  const projLine = projectionPoints.map((point, index) => `${xAt(histCount - 1 + index).toFixed(1)},${yAt(point.value).toFixed(1)}`).join(' ')
  const bandTop = data.band.map((point, index) => `${xAt(histCount + index).toFixed(1)},${yAt(point.high).toFixed(1)}`)
  const bandBottom = data.band.map((point, index) => `${xAt(histCount + index).toFixed(1)},${yAt(point.low).toFixed(1)}`).reverse()
  const todayX = xAt(histCount - 1)
  const lastProjected = data.projected.at(-1)

  return (
    <div className="exec-area-chart gq-trajectory" role="img" aria-label={label}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--exec-accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--exec-accent)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={bandId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--exec-purple-deep)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--exec-purple-deep)" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((fraction) => <line key={fraction} x1={padX} x2={width - padX} y1={padTop + fraction * (height - padTop - padBottom)} y2={padTop + fraction * (height - padTop - padBottom)} className="exec-chart-gridline" />)}
        {/* Confidence band (projection only — history is fact, not a range). */}
        {bandTop.length > 1 && <polygon points={`${xAt(histCount).toFixed(1)},${yAt(data.projected[0]!.value).toFixed(1)} ${bandTop.join(' ')} ${bandBottom.join(' ')}`} fill={`url(#${bandId})`} />}
        {/* Real history: gradient area + solid stroke. */}
        <polygon points={`${xAt(0).toFixed(1)},${yAt(0).toFixed(1)} ${histLine} ${xAt(histCount - 1).toFixed(1)},${yAt(0).toFixed(1)}`} fill={`url(#${gradientId})`} />
        {histCount > 1 && <polyline points={histLine} fill="none" className="exec-area-stroke" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {/* Trend extension: clearly dashed so it can never pass for fact. */}
        <polyline points={projLine} fill="none" className="gq-trajectory-projection" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="7 5" vectorEffect="non-scaling-stroke" />
        {/* "Today" divider and endpoint markers. */}
        <line x1={todayX} x2={todayX} y1={padTop} y2={height - padBottom} className="gq-trajectory-today" />
        <circle cx={todayX} cy={yAt(data.historical.at(-1)!.value)} r={4} className="exec-area-dot" />
        {lastProjected ? <circle cx={xAt(n - 1)} cy={yAt(lastProjected.value)} r={4} className="gq-trajectory-end" /> : null}
        {hover && (
          <g className="gq-trajectory-hover" pointerEvents="none">
            <line x1={hover.x} x2={hover.x} y1={padTop} y2={height - padBottom} className="exec-chart-cursor gq-trajectory-cursor" />
            <circle cx={hover.x} cy={hover.y} r={6} className="gq-trajectory-active-ring" />
            <circle cx={hover.x} cy={hover.y} r={4.2} className="gq-trajectory-active-dot" />
          </g>
        )}
        <rect
          className="gq-trajectory-hit"
          data-testid="gq-trajectory-hit"
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setHover(null)}
          onPointerCancel={() => setHover(null)}
          onMouseMove={onPointer}
          onMouseLeave={() => setHover(null)}
          onMouseOut={() => setHover(null)}
        />
      </svg>
      {hover && (
        <div
          className="gq-trajectory-tooltip"
          data-testid="gq-trajectory-tooltip"
          data-kind={hover.kind}
          role="status"
          style={{ left: `${(hover.x / width) * 100}%` }}
        >
          <span className="gq-trajectory-tooltip-kind">{hover.kind}</span>
          <strong>{formatValue ? formatValue(hover.value) : String(Math.round(hover.value))}</strong>
          <em>{formatTrajectoryDay(hover.day)}</em>
        </div>
      )}
      <div className="exec-chart-legend">
        <span>{data.historical[0]?.day.slice(5) ?? ''}</span>
        <span className="gq-trajectory-legend-mid">{lastProjected && formatValue ? `Projected ${formatValue(lastProjected.value)} / day in 30d` : 'today'}</span>
        <span>{lastProjected ? `+30d` : ''}</span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Strategic position matrix (2×2 quadrant with the store's real position)
// ────────────────────────────────────────────────────────────────────────────

export function ExecutivePositionMatrix({ x, y, xLabel, yLabel, height = 240 }: { x: number; y: number; xLabel: string; yLabel: string; height?: number }) {
  const width = 340
  const pad = 30
  const plotW = width - pad * 2
  const plotH = height - pad * 2
  const dotX = pad + Math.min(Math.max(x, 0), 100) / 100 * plotW
  const dotY = pad + (1 - Math.min(Math.max(y, 0), 100) / 100) * plotH
  return (
    <div className="gq-matrix" role="img" aria-label={`Strategic position: ${xLabel.toLowerCase()} ${Math.round(x)} of 100, ${yLabel.toLowerCase()} ${Math.round(y)} of 100`}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }}>
        <rect x={pad} y={pad} width={plotW / 2} height={plotH / 2} className="gq-matrix-quad q3" />
        <rect x={pad + plotW / 2} y={pad} width={plotW / 2} height={plotH / 2} className="gq-matrix-quad q4" />
        <rect x={pad} y={pad + plotH / 2} width={plotW / 2} height={plotH / 2} className="gq-matrix-quad q1" />
        <rect x={pad + plotW / 2} y={pad + plotH / 2} width={plotW / 2} height={plotH / 2} className="gq-matrix-quad q2" />
        <line x1={width / 2} x2={width / 2} y1={pad} y2={height - pad} className="exec-chart-gridline" />
        <line x1={pad} x2={width - pad} y1={height / 2} y2={height / 2} className="exec-chart-gridline" />
        <text x={pad + 6} y={pad + 15} className="exec-chart-label">Momentum</text>
        <text x={width - pad - 6} y={pad + 15} textAnchor="end" className="exec-chart-label">Scale</text>
        <text x={pad + 6} y={height - pad - 7} className="exec-chart-label">Foundation</text>
        <text x={width - pad - 6} y={height - pad - 7} textAnchor="end" className="exec-chart-label">Established</text>
        <text x={width / 2} y={height - 5} textAnchor="middle" className="exec-chart-label">{xLabel} →</text>
        <text x={13} y={height / 2} textAnchor="middle" className="exec-chart-label" transform={`rotate(-90 13 ${height / 2})`}>{yLabel} →</text>
        <circle cx={dotX} cy={dotY} r={7} className="gq-matrix-pulse" />
        <circle cx={dotX} cy={dotY} r={5} className="gq-matrix-dot" />
      </svg>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Confidence bar
// ────────────────────────────────────────────────────────────────────────────

export function ExecutiveConfidenceBar({ value }: { value: number }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100)
  return (
    <div className="exec-confidence" title={`${percent}% confidence`}>
      <div className="exec-confidence-track"><span style={{ width: `${percent}%` }} /></div>
      <small>{percent}% confidence</small>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Trend arrow
// ────────────────────────────────────────────────────────────────────────────

export function ExecutiveTrendArrow({ trend }: { trend: 'up' | 'down' | 'flat' | 'unknown' }) {
  if (trend === 'unknown') return <span className="exec-trend unknown" title="No trend data">—</span>
  return (
    <span className={`exec-trend ${trend}`} title={trend === 'up' ? 'Improving' : trend === 'down' ? 'Declining' : 'Stable'}>
      {trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→'}
    </span>
  )
}

export function useExecutiveSeriesTone(points: readonly number[]): 'up' | 'down' | 'flat' {
  return useMemo(() => {
    if (points.length < 2) return 'flat'
    const delta = (points.at(-1) ?? 0) - (points[0] ?? 0)
    if (delta > 0) return 'up'
    if (delta < 0) return 'down'
    return 'flat'
  }, [points])
}
