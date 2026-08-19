/**
 * PatternAI value visuals — the shapes that exist only in this module.
 *
 * House rules honoured here:
 *  - UNIQUE to PatternAI. Nothing in this file repeats a chart another module
 *    already owns: no KPI sparklines (AI Command Center), no radial progress
 *    rings styled like Recommendations/GrowthIQ, no mini bar charts
 *    (Recommendations), no semi-circular gauges / stacked or segmented bars /
 *    approval dot grids (Automation), no trajectory area charts (GrowthIQ).
 *    What lives here instead: bubble clusters, node webs, persona cohorts,
 *    answer meters, arrow clusters, probability waves, a horizontal discovery
 *    funnel, before/after momentum bars, a pattern-strength ladder, a
 *    dashed-segment discovery ring and a merchant-feedback balance beam.
 *  - Zero invented data. Every component renders numbers it is handed and
 *    nothing else; when there is no data it draws an explicitly empty outline
 *    with an honest caption instead of a plausible-looking shape.
 *  - Both themes. Colour flows through the `--pa-*` custom properties defined
 *    in patternai.css, so dark and light are equally first-class.
 *  - SSR-safe and dependency-free: plain SVG, no refs, no `document` at render
 *    time, so every component renders through renderToStaticMarkup in tests.
 */

import { useId } from 'react'
import type { ReactNode } from 'react'
import {
  formatInsightMoney,
  formatInsightNumber,
  formatMomentumValue,
  formatPlainPercent,
  momentumWidths,
} from './patternai-model.js'
import type {
  CauseNode,
  DiscoveryFunnel,
  DiscoveryFunnelStage,
  DiscoveryMomentum,
  DivergingRow,
  MonthlyDiscoveryProgress,
  PatternStrengthRow,
  PersonaRadarTrait,
  WavePoint,
} from './patternai-model.js'

/* ══ 1. Hero KPI micro-visualizations — six different shapes ═══════════ */

export type StatVizProps = Readonly<{ count: number | null; pending: string; label: string }>

const VIEW = { w: 72, h: 26 }

function VizFrame({ children, empty, pending, title }: { children: ReactNode; empty: boolean; pending: string; title: string }) {
  return (
    <span className={`pa-statviz ${empty ? 'is-empty' : ''}`} title={empty ? pending : title}>
      <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} role="img" aria-label={empty ? `${title} — ${pending}` : title} focusable="false">{children}</svg>
      {empty && <em className="pa-statviz-pending">{pending}</em>}
    </span>
  )
}

/** Deterministic bubble geometry so the same count always draws the same cluster. */
const BUBBLE_SLOTS: readonly Readonly<{ cx: number; cy: number; r: number }>[] = [
  { cx: 12, cy: 13, r: 7 },
  { cx: 27, cy: 9, r: 5 },
  { cx: 27, cy: 20, r: 3.4 },
  { cx: 40, cy: 14, r: 5.6 },
  { cx: 52, cy: 8.5, r: 3.8 },
  { cx: 53, cy: 19, r: 4.6 },
  { cx: 64, cy: 13, r: 3 },
]

/** Stat 1 — discoveries as a cluster of bubbles (size = order of arrival). */
export function StatBubbleCluster({ count, pending, label }: StatVizProps) {
  const shown = Math.min(BUBBLE_SLOTS.length, Math.max(0, count ?? 0))
  const empty = shown === 0
  return (
    <VizFrame empty={empty} pending={pending} title={`${formatInsightNumber(count ?? 0)} ${label.toLowerCase()}`}>
      {BUBBLE_SLOTS.map((slot, index) => (
        <circle
          key={index}
          className={index < shown ? `pa-viz-bubble filled slot-${index % 3}` : 'pa-viz-bubble ghost'}
          cx={slot.cx}
          cy={slot.cy}
          r={slot.r}
        />
      ))}
    </VizFrame>
  )
}

const NET_NODES: readonly Readonly<{ x: number; y: number }>[] = [
  { x: 9, y: 18 }, { x: 22, y: 7 }, { x: 34, y: 19 }, { x: 47, y: 8 }, { x: 59, y: 17 }, { x: 66, y: 7 },
]
const NET_EDGES: readonly (readonly [number, number])[] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [1, 3]]

/** Stat 2 — active patterns as a tiny node web (edges = relationships). */
export function StatNetworkSpark({ count, pending, label }: StatVizProps) {
  const shown = Math.min(NET_NODES.length, Math.max(0, count ?? 0))
  const empty = shown === 0
  return (
    <VizFrame empty={empty} pending={pending} title={`${formatInsightNumber(count ?? 0)} ${label.toLowerCase()}`}>
      {NET_EDGES.map(([from, to], index) => {
        const a = NET_NODES[from]!
        const b = NET_NODES[to]!
        const live = from < shown && to < shown
        return <line key={index} className={live ? 'pa-viz-edge live' : 'pa-viz-edge'} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      })}
      {NET_NODES.map((node, index) => (
        <circle key={index} className={index < shown ? 'pa-viz-node live' : 'pa-viz-node'} cx={node.x} cy={node.y} r={index < shown ? 3.1 : 2.1} />
      ))}
    </VizFrame>
  )
}

/** Stat 3 — personas as a small cohort of silhouettes. */
export function StatPersonaCohort({ count, pending, label }: StatVizProps) {
  const slots = 5
  const shown = Math.min(slots, Math.max(0, count ?? 0))
  const empty = shown === 0
  const overflow = Math.max(0, (count ?? 0) - slots)
  return (
    <VizFrame empty={empty} pending={pending} title={`${formatInsightNumber(count ?? 0)} ${label.toLowerCase()}`}>
      {Array.from({ length: slots }, (_, index) => {
        const x = 8 + index * 13
        const live = index < shown
        return (
          <g key={index} className={live ? `pa-viz-person live tone-${index % 3}` : 'pa-viz-person'}>
            <circle cx={x} cy={9} r={3.2} />
            <path d={`M ${x - 5} 21 a 5 5 0 0 1 10 0 z`} />
          </g>
        )
      })}
      {overflow > 0 && <text className="pa-viz-overflow" x={VIEW.w - 2} y={21} textAnchor="end">+{overflow}</text>}
    </VizFrame>
  )
}

/** Stat 4 — investigations: a question mark that becomes a check when answered. */
export function StatAnswerMeter({ count, pending, label }: StatVizProps) {
  const answered = Math.max(0, count ?? 0)
  const empty = answered === 0
  const filled = Math.min(1, answered / 3)
  return (
    <VizFrame empty={empty} pending={pending} title={`${formatInsightNumber(answered)} ${label.toLowerCase()}`}>
      <text className="pa-viz-glyph question" x={8} y={16} textAnchor="middle">?</text>
      <line className="pa-viz-track" x1={17} y1={13} x2={54} y2={13} />
      <line className="pa-viz-track fill" x1={17} y1={13} x2={17 + 37 * filled} y2={13} />
      <path className={empty ? 'pa-viz-check' : 'pa-viz-check done'} d="M 58 13 l 3.4 3.6 L 68 7" />
    </VizFrame>
  )
}

/** Stat 5 — trends under watch as a cluster of watch arrows. */
export function StatArrowCluster({ count, pending, label }: StatVizProps) {
  const slots = 6
  const shown = Math.min(slots, Math.max(0, count ?? 0))
  const empty = shown === 0
  return (
    <VizFrame empty={empty} pending={pending} title={`${formatInsightNumber(count ?? 0)} ${label.toLowerCase()}`}>
      {Array.from({ length: slots }, (_, index) => {
        const x = 8 + index * 11
        const live = index < shown
        return (
          <g key={index} className={live ? 'pa-viz-arrow live' : 'pa-viz-arrow'}>
            <line x1={x} y1={20} x2={x} y2={7} />
            <path d={`M ${x - 3.2} 10.4 L ${x} 6.4 L ${x + 3.2} 10.4`} />
          </g>
        )
      })}
    </VizFrame>
  )
}

/** Stat 6 — predictions as a probability wave with its confidence envelope. */
export function StatProbabilityWave({ count, pending, label }: StatVizProps) {
  const live = Math.max(0, count ?? 0) > 0
  const wave = 'M 4 18 C 14 6, 22 22, 32 13 S 50 6, 60 14 S 66 18, 68 16'
  const band = 'M 4 21 C 14 10, 22 25, 32 17 S 50 10, 68 19 L 68 12 C 50 3, 42 12, 32 9 S 14 3, 4 15 Z'
  return (
    <VizFrame empty={!live} pending={pending} title={`${formatInsightNumber(count ?? 0)} ${label.toLowerCase()}`}>
      {live && <path className="pa-viz-band" d={band} />}
      <path className={live ? 'pa-viz-wave live' : 'pa-viz-wave'} d={wave} />
      {live && <circle className="pa-viz-wave-dot" cx={68} cy={16} r={2.4} />}
    </VizFrame>
  )
}

const STAT_VIZ = {
  bubbles: StatBubbleCluster,
  network: StatNetworkSpark,
  cohort: StatPersonaCohort,
  answers: StatAnswerMeter,
  arrows: StatArrowCluster,
  wave: StatProbabilityWave,
} as const

/** Picks the tile's own micro-visualization; each of the six differs. */
export function StatVisualization({ visual, count, pending, label }: StatVizProps & { visual: keyof typeof STAT_VIZ }) {
  const Component = STAT_VIZ[visual]
  return <Component count={count} pending={pending} label={label} />
}

/* ══ 2. Discovery pipeline funnel (horizontal, interactive) ════════════ */

/**
 * Horizontal funnel. Each stage is a tapering band whose width is its real
 * share of the discovered total; clicking a stage filters the feed. This is
 * the only funnel in the app and it never draws a stage wider than its data.
 */
export function DiscoveryPipelineFunnel({ funnel, activeStage, onSelect, onAction }: {
  funnel: DiscoveryFunnel
  activeStage?: DiscoveryFunnelStage['id'] | null
  onSelect?: (stage: DiscoveryFunnelStage) => void
  onAction?: () => void
}) {
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <div className="pa-funnel">
      <div className="pa-funnel-bands">
        {funnel.stages.map((stage, index) => {
          const percent = Math.round(stage.share * 100)
          const width = funnel.discovered > 0 ? Math.max(stage.value > 0 ? 8 : 3, percent) : 3
          const interactive = Boolean(onSelect)
          const Tag = interactive ? 'button' : 'div'
          return (
            <Tag
              key={stage.id}
              type={interactive ? 'button' : undefined}
              className={`pa-funnel-row depth-${index} ${activeStage === stage.id ? 'active' : ''} ${stage.value === 0 ? 'zero' : ''}`}
              onClick={interactive ? () => onSelect?.(stage) : undefined}
              aria-label={`${stage.label}: ${stage.value}${funnel.discovered > 0 ? ` (${percent}% of discovered)` : ''}`}
            >
              <span className="pa-funnel-label">{stage.label}</span>
              <span className="pa-funnel-track">
                <span className={`pa-funnel-fill grad-${gradientId} depth-${index}`} style={{ width: `${width}%` }} />
              </span>
              <span className="pa-funnel-value">{formatInsightNumber(stage.value)}</span>
              <span className="pa-funnel-share">{funnel.discovered > 0 ? `${percent}%` : '—'}</span>
            </Tag>
          )
        })}
      </div>
      <footer className="pa-funnel-foot">
        <span className="pa-funnel-conversion">
          Conversion <strong>{funnel.conversion === null ? '—' : formatPlainPercent(funnel.conversion)}</strong>
        </span>
        {onAction && funnel.discovered > 0 && funnel.actedOn === 0
          ? <button type="button" className="pa-funnel-action" onClick={onAction}>Take action on a discovery →</button>
          : <span className="pa-funnel-hint">{funnel.hint}</span>}
      </footer>
    </div>
  )
}

/* ══ 3. Before / after momentum bars (discovery cards) ═════════════════ */

/** Two measured values, side by side. Widths scale to the larger of the two. */
export function MomentumCompare({ momentum }: { momentum: DiscoveryMomentum }) {
  const widths = momentumWidths(momentum)
  const rising = momentum.after >= momentum.before
  return (
    <div className={`pa-momentum ${rising ? 'up' : 'down'}`} role="img" aria-label={`${momentum.title}: ${momentum.beforeLabel} ${formatMomentumValue(momentum, momentum.before)}, ${momentum.afterLabel} ${formatMomentumValue(momentum, momentum.after)}`}>
      <div className="pa-momentum-head">
        <span>{momentum.title}</span>
        {momentum.change !== null && <strong className={rising ? 'up' : 'down'}>{momentum.change >= 0 ? '+' : ''}{Math.round(momentum.change * 100)}%</strong>}
      </div>
      <div className="pa-momentum-row before">
        <span className="pa-momentum-label">{momentum.beforeLabel}</span>
        <span className="pa-momentum-track"><span style={{ width: `${widths.before}%` }} /></span>
        <span className="pa-momentum-value">{formatMomentumValue(momentum, momentum.before)}</span>
      </div>
      <div className="pa-momentum-row after">
        <span className="pa-momentum-label">{momentum.afterLabel}</span>
        <span className="pa-momentum-track"><span style={{ width: `${widths.after}%` }} /></span>
        <span className="pa-momentum-value">{formatMomentumValue(momentum, momentum.after)}</span>
      </div>
    </div>
  )
}

/* ══ 4. Pattern strength ladder ════════════════════════════════════════ */

/** Horizontal evidence ladder: have ÷ need per pattern family, with counts. */
export function PatternStrengthMeter({ rows, tip }: { rows: readonly PatternStrengthRow[]; tip?: string }) {
  if (rows.length === 0) return <p className="pa-muted">Pattern strength appears once your store reports its first synced day.</p>
  return (
    <div className="pa-strength">
      {rows.map((row) => (
        <div key={row.id} className={`pa-strength-row state-${row.state}`}>
          <span className="pa-strength-label">{row.label}</span>
          <span className="pa-strength-track" role="img" aria-label={`${row.label}: ${row.stateLabel}, ${row.percent}%`}>
            <span className="pa-strength-fill" style={{ width: `${row.percent}%` }} />
            {[20, 40, 60, 80].map((tick) => <i key={tick} className="pa-strength-tick" style={{ left: `${tick}%` }} />)}
          </span>
          <span className="pa-strength-state">{row.stateLabel} <em>{row.percent}%</em></span>
          <span className="pa-strength-detail">{row.detail}</span>
        </div>
      ))}
      {tip && <p className="pa-strength-tip">{tip}</p>}
    </div>
  )
}

/* ══ 5. Monthly discovery ring ═════════════════════════════════════════ */

/**
 * Discovery allowance ring. Deliberately drawn as a dashed segment arc with a
 * square cap and an inner two-line readout, so it never reads like the smooth
 * radial progress rings other modules use.
 */
export function MonthlyDiscoveryRing({ progress, size = 108 }: { progress: MonthlyDiscoveryProgress; size?: number }) {
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const stroke = 9
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (progress.unlimited ? 1 : progress.percent / 100) * circumference
  return (
    <div className="pa-ring" role="img" aria-label={progress.unlimited ? `${progress.used} discoveries this month, no monthly cap` : `${progress.used} of ${progress.limit} discoveries used this month`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} focusable="false">
        <defs>
          <linearGradient id={`pa-ring-${gradientId}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--pa-ring-from)" />
            <stop offset="100%" stopColor="var(--pa-ring-to)" />
          </linearGradient>
        </defs>
        <circle className="pa-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} strokeDasharray="3 6" />
        <circle
          className={`pa-ring-fill ${progress.atLimit ? 'at-limit' : ''}`}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          stroke={`url(#pa-ring-${gradientId})`}
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="pa-ring-inner">
        <strong>{formatInsightNumber(progress.used)}</strong>
        <span>{progress.unlimited ? 'this month' : `of ${formatInsightNumber(progress.limit ?? 0)} limit`}</span>
      </div>
    </div>
  )
}

/* ══ 6. Explore-card mini visuals — one distinct shape per card ════════ */

const MINI = { w: 132, h: 46 }

function MiniFrame({ children, empty, emptyLabel, title }: { children: ReactNode; empty: boolean; emptyLabel: string; title: string }) {
  return (
    <span className={`pa-mini ${empty ? 'is-empty' : ''}`}>
      <svg viewBox={`0 0 ${MINI.w} ${MINI.h}`} role="img" aria-label={empty ? emptyLabel : title} focusable="false">{children}</svg>
      {empty && <em className="pa-mini-empty">{emptyLabel}</em>}
    </span>
  )
}

/** Learning library — word cloud of the topics the store's lessons cover. */
export function MiniWordCloud({ words, emptyLabel = 'Topics appear with your first lesson' }: { words: readonly Readonly<{ tag: string; weight: number }>[]; emptyLabel?: string }) {
  const shown = words.slice(0, 5)
  const max = Math.max(1, ...shown.map((word) => word.weight))
  return (
    <span className={`pa-mini pa-mini-cloud ${shown.length === 0 ? 'is-empty' : ''}`}>
      {shown.length === 0
        ? <em className="pa-mini-empty">{emptyLabel}</em>
        : shown.map((word, index) => (
          <b key={word.tag} className={`pa-mini-word depth-${index % 3}`} style={{ fontSize: `${9 + Math.round((word.weight / max) * 5)}px` }} title={`${word.tag} — ${word.weight} lesson${word.weight === 1 ? '' : 's'}`}>{word.tag}</b>
        ))}
    </span>
  )
}

/** Pattern lab — scatter of confidence (x) against recurrence (y). */
export function MiniScatter({ points, emptyLabel = 'Patterns plot here once detected' }: { points: readonly Readonly<{ id: string; label: string; x: number; y: number }>[]; emptyLabel?: string }) {
  const shown = points.slice(0, 12)
  return (
    <MiniFrame empty={shown.length === 0} emptyLabel={emptyLabel} title={`${shown.length} patterns by confidence and recurrence`}>
      <line className="pa-mini-axis" x1={6} y1={MINI.h - 7} x2={MINI.w - 6} y2={MINI.h - 7} />
      <line className="pa-mini-axis" x1={6} y1={5} x2={6} y2={MINI.h - 7} />
      {shown.map((point) => (
        <circle key={point.id} className="pa-mini-dot" cx={8 + point.x * (MINI.w - 16)} cy={MINI.h - 9 - point.y * (MINI.h - 18)} r={3}>
          <title>{point.label}</title>
        </circle>
      ))}
    </MiniFrame>
  )
}

/** Customer personas — spider/radar of averaged, measured traits. */
export function MiniRadar({ traits, emptyLabel = 'Traits appear with your first persona' }: { traits: readonly PersonaRadarTrait[]; emptyLabel?: string }) {
  const shown = traits.slice(0, 6)
  const cx = MINI.w / 2
  const cy = MINI.h / 2
  const radius = MINI.h / 2 - 4
  const at = (index: number, scale: number): string => {
    const angle = (Math.PI * 2 * index) / Math.max(3, shown.length) - Math.PI / 2
    return `${cx + Math.cos(angle) * radius * scale},${cy + Math.sin(angle) * radius * scale}`
  }
  const ring = (scale: number): string => Array.from({ length: Math.max(3, shown.length) }, (_, index) => at(index, scale)).join(' ')
  return (
    <MiniFrame empty={shown.length === 0} emptyLabel={emptyLabel} title="Average persona traits">
      <polygon className="pa-mini-ring" points={ring(1)} />
      <polygon className="pa-mini-ring" points={ring(0.55)} />
      {shown.length > 0 && <polygon className="pa-mini-shape" points={shown.map((trait, index) => at(index, Math.max(0.08, Math.min(1, trait.score)))).join(' ')} />}
    </MiniFrame>
  )
}

/** Why? explorer — a root-cause web: one question, ranked causes around it. */
export function MiniCauseWeb({ causes, emptyLabel = 'Ask a question to map its causes' }: { causes: readonly CauseNode[]; emptyLabel?: string }) {
  const shown = causes.slice(0, 5)
  const cx = 22
  const cy = MINI.h / 2
  return (
    <MiniFrame empty={shown.length === 0} emptyLabel={emptyLabel} title="Root causes of your latest question">
      {shown.map((cause, index) => {
        const y = 8 + index * ((MINI.h - 16) / Math.max(1, shown.length - 1 || 1))
        const x = MINI.w - 16
        return (
          <g key={cause.id}>
            <line className="pa-mini-link" x1={cx} y1={cy} x2={x} y2={y} strokeWidth={1 + cause.weight * 2.4} />
            <circle className="pa-mini-cause" cx={x} cy={y} r={2.6 + cause.weight * 3}><title>{`${cause.label} — ${Math.round(cause.weight * 100)}%`}</title></circle>
          </g>
        )
      })}
      <circle className="pa-mini-root" cx={cx} cy={cy} r={7} />
      <text className="pa-mini-root-glyph" x={cx} y={cy + 3.6} textAnchor="middle">?</text>
    </MiniFrame>
  )
}

/** Trend watcher — diverging bars around a centre line (up right, down left). */
export function MiniDivergingBars({ rows, emptyLabel = 'Rises and falls appear here' }: { rows: readonly DivergingRow[]; emptyLabel?: string }) {
  const shown = rows.slice(0, 4)
  const max = Math.max(1, ...shown.map((row) => Math.abs(row.magnitude)))
  const mid = MINI.w / 2
  return (
    <MiniFrame empty={shown.length === 0} emptyLabel={emptyLabel} title="Trends by direction and magnitude">
      <line className="pa-mini-axis" x1={mid} y1={3} x2={mid} y2={MINI.h - 3} />
      {shown.map((row, index) => {
        const height = 6
        const y = 5 + index * ((MINI.h - 12) / Math.max(1, shown.length))
        const width = (Math.abs(row.magnitude) / max) * (mid - 8)
        const down = row.direction === 'DOWN'
        return (
          <rect
            key={row.id}
            className={`pa-mini-diverge ${down ? 'down' : row.direction === 'STABLE' ? 'flat' : 'up'}`}
            x={down ? mid - width : mid}
            y={y}
            width={Math.max(2, width)}
            height={height}
            rx={2}
          >
            <title>{`${row.label}: ${row.magnitude > 0 ? '+' : ''}${row.magnitude}%`}</title>
          </rect>
        )
      })}
    </MiniFrame>
  )
}

/** Predictions — probability wave: the forecast line inside its own range. */
export function MiniProbabilityWave({ points, emptyLabel = 'Forecast ranges appear here' }: { points: readonly WavePoint[]; emptyLabel?: string }) {
  const shown = points.slice(0, 12)
  if (shown.length === 0) return <MiniFrame empty emptyLabel={emptyLabel} title="Forecast">{null}</MiniFrame>
  const highest = Math.max(...shown.map((point) => point.upper))
  const lowest = Math.min(...shown.map((point) => point.lower))
  const span = Math.max(1e-9, highest - lowest)
  const px = (index: number): number => 6 + (index * (MINI.w - 12)) / Math.max(1, shown.length - 1)
  const py = (value: number): number => MINI.h - 6 - ((value - lowest) / span) * (MINI.h - 12)
  const upper = shown.map((point, index) => `${px(index)},${py(point.upper)}`).join(' ')
  const lower = [...shown].reverse().map((point, index) => `${px(shown.length - 1 - index)},${py(point.lower)}`).join(' ')
  const mid = shown.map((point, index) => `${px(index)},${py(point.value)}`).join(' ')
  return (
    <MiniFrame empty={false} emptyLabel={emptyLabel} title="Forecast with its confidence range">
      <polygon className="pa-mini-band" points={`${upper} ${lower}`} />
      <polyline className="pa-mini-line" points={mid} />
    </MiniFrame>
  )
}

/* ══ 7. Merchant feedback balance ══════════════════════════════════════ */

/**
 * A balance beam unique to PatternAI: the heavier side reflects the current
 * count of real signals kept versus dismissed. It is deliberately not a bar,
 * ring, funnel or gauge. With no classified signals it stays level and says so.
 */
export function FeedbackBalance({ kept, dismissed }: { kept: number; dismissed: number }) {
  const total = Math.max(0, kept) + Math.max(0, dismissed)
  const tilt = total > 0 ? ((Math.max(0, kept) - Math.max(0, dismissed)) / total) * 11 : 0
  const keptY = 40 + tilt
  const dismissedY = 40 - tilt
  return (
    <div className={`pa-feedback-balance ${total === 0 ? 'is-empty' : ''}`}>
      <svg viewBox="0 0 220 108" role="img" aria-label={total === 0 ? 'No real signals have a kept or dismissed outcome' : `${kept} kept and ${dismissed} dismissed signals`} focusable="false">
        <line className="pa-feedback-beam" x1="42" y1={keptY} x2="178" y2={dismissedY} />
        <line className="pa-feedback-cord kept" x1="56" y1={keptY + 1} x2="56" y2={keptY + 22} />
        <line className="pa-feedback-cord dismissed" x1="164" y1={dismissedY + 1} x2="164" y2={dismissedY + 22} />
        <path className="pa-feedback-tray kept" d={`M34 ${keptY + 22} Q56 ${keptY + 36} 78 ${keptY + 22} Z`} />
        <path className="pa-feedback-tray dismissed" d={`M142 ${dismissedY + 22} Q164 ${dismissedY + 36} 186 ${dismissedY + 22} Z`} />
        <path className="pa-feedback-pivot" d="M110 39 L92 84 H128 Z" />
        <circle className="pa-feedback-pin" cx="110" cy="40" r="5" />
        {total > 0 && <>
          <text className="pa-feedback-count kept" x="56" y={keptY + 48} textAnchor="middle">{formatInsightNumber(kept)}</text>
          <text className="pa-feedback-count dismissed" x="164" y={dismissedY + 48} textAnchor="middle">{formatInsightNumber(dismissed)}</text>
        </>}
      </svg>
      <div className="pa-feedback-labels"><span><i className="kept" /> Kept</span><span><i className="dismissed" /> Dismissed</span></div>
      {total === 0 && <em>No real signal outcomes yet</em>}
    </div>
  )
}

/* ══ 8. Impact summary helpers ═════════════════════════════════════════ */

/** Money strip used under the impact treemap; renders nothing without money. */
export function MoneyInPlay({ amount, currency }: { amount: number | null; currency: string }) {
  if (amount === null) return null
  return <span className="pa-money-inplay">{formatInsightMoney(amount, currency)} in play across these discoveries</span>
}
