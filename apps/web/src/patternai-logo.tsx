/**
 * PatternAI brand mark — "Neural Network Constellation".
 *
 * Five nodes wired into a constellation: the shape of a pattern being found.
 * No lab glassware, no eyes, no magnifiers, no lightbulbs, no bar charts.
 *
 * The mark is pure SVG with a per-instance gradient id (so several marks can
 * share a page safely), scales cleanly from 16px favicons to 48px headers, and
 * reads correctly on both the dark (rgb(11, 13, 20)) and light (rgb(250, 251, 252)) canvases —
 * strokes and nodes use theme-aware currentColor-independent brand values so
 * the constellation never disappears into either background.
 */

import { useId } from 'react'

export type PatternAiMarkProps = Readonly<{
  size?: number
  /** `plain` draws the constellation alone; `badge` adds the rounded plate. */
  variant?: 'plain' | 'badge'
  title?: string
  className?: string
}>

/** Node coordinates on a 32×32 grid: apex, left, right, centre, base. */
const NODES: readonly Readonly<{ cx: number; cy: number; r: number; accent?: boolean }>[] = [
  { cx: 16, cy: 5, r: 2.6 },
  { cx: 5.5, cy: 13, r: 2.2 },
  { cx: 26.5, cy: 13, r: 2.2, accent: true },
  { cx: 16, cy: 17.5, r: 3.2 },
  { cx: 16, cy: 27, r: 2.4, accent: true },
]

/** Edges as index pairs — the "wiring" that turns points into a pattern. */
const EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
  [3, 4],
  [1, 4],
  [2, 4],
]

export function PatternAiMark({ size = 24, variant = 'plain', title = 'PatternAI', className }: PatternAiMarkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const stroke = `pa-stroke-${uid}`
  const node = `pa-node-${uid}`
  const plate = `pa-plate-${uid}`
  return (
    <svg
      className={`pa-mark ${className ?? ''}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      focusable="false"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={stroke} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--pa-mark-from, rgb(167, 139, 250))" />
          <stop offset="55%" stopColor="var(--pa-mark-mid, rgb(139, 92, 246))" />
          <stop offset="100%" stopColor="var(--pa-mark-to, rgb(6, 182, 212))" />
        </linearGradient>
        <radialGradient id={node} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="var(--pa-mark-node-core, rgb(255, 255, 255))" />
          <stop offset="100%" stopColor="var(--pa-mark-node-edge, rgb(139, 92, 246))" />
        </radialGradient>
        <linearGradient id={plate} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--pa-mark-plate-from, rgba(139, 92, 246, 0.18))" />
          <stop offset="100%" stopColor="var(--pa-mark-plate-to, rgba(6, 182, 212, 0.16))" />
        </linearGradient>
      </defs>

      {variant === 'badge' && <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="9" fill={`url(#${plate})`} stroke="var(--pa-mark-plate-line, rgba(139, 92, 246, 0.32))" strokeWidth="1" />}

      <g stroke={`url(#${stroke})`} strokeWidth="1.35" strokeLinecap="round" opacity="0.9">
        {EDGES.map(([from, to]) => {
          const a = NODES[from]!
          const b = NODES[to]!
          return <line key={`${from}-${to}`} x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy} />
        })}
      </g>

      {NODES.map((point, index) => (
        <g key={index}>
          <circle cx={point.cx} cy={point.cy} r={point.r + 1.5} fill="var(--pa-mark-halo, rgba(139, 92, 246, 0.16))" />
          <circle cx={point.cx} cy={point.cy} r={point.r} fill={point.accent ? 'var(--pa-mark-accent, rgb(6, 182, 212))' : `url(#${node})`} />
        </g>
      ))}
    </svg>
  )
}

/**
 * Lucide-compatible signature so the mark can drop straight into the sidebar's
 * `icon` slot, which calls icons as `<Icon size={n} />`.
 */
export function PatternAiIcon(props: Readonly<{ size?: number | string; className?: string }>) {
  const size = typeof props.size === 'number' ? props.size : Number.parseInt(String(props.size ?? 18), 10) || 18
  return props.className === undefined ? <PatternAiMark size={size} /> : <PatternAiMark size={size} className={props.className} />
}

/** Wordmark used in the workspace hero and the page header. */
export function PatternAiWordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="pa-wordmark">
      <PatternAiMark size={size} variant="badge" />
      <span className="pa-wordmark-text">
        Pattern<em>AI</em>
      </span>
    </span>
  )
}

/**
 * "Run discovery" glyph — a compass rose whose needle is a discovery spark.
 *
 * Why this shape: discovery is *directed* exploration, so the mark reads as a
 * compass (orientation) with a four-point spark at its heart (the find) and
 * two small constellation points being revealed at the edge. It replaces the
 * generic sparkle/network icons that previously sat on the action buttons, and
 * it is used nowhere else in the app — no other module ships a compass mark.
 *
 * Pure SVG, per-instance gradient ids, legible at 12/14/16/24/32px, and driven
 * by the same theme-aware `--pa-mark-*` variables as the brand constellation
 * so it reads on both the dark (rgb(11, 13, 20)) and light (rgb(248, 250, 252)) canvases.
 */
export function PatternAiDiscoverGlyph({ size = 16, title = 'Run discovery', className }: Readonly<{ size?: number; title?: string; className?: string }>) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const ring = `pa-disc-ring-${uid}`
  const spark = `pa-disc-spark-${uid}`
  return (
    <svg
      className={`pa-discover-glyph ${className ?? ''}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={title}
      focusable="false"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={ring} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--pa-mark-from, rgb(167, 139, 250))" />
          <stop offset="100%" stopColor="var(--pa-mark-to, rgb(6, 182, 212))" />
        </linearGradient>
        <linearGradient id={spark} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--pa-mark-mid, rgb(139, 92, 246))" />
          <stop offset="100%" stopColor="var(--pa-mark-accent, rgb(6, 182, 212))" />
        </linearGradient>
      </defs>

      {/* Compass ring, open at the top-right where the new find appears. */}
      <path
        d="M 18.9 6.6 A 8.4 8.4 0 1 0 20.4 12"
        fill="none"
        stroke={`url(#${ring})`}
        strokeWidth="1.7"
        strokeLinecap="round"
      />

      {/* Needle: a four-point discovery spark, brightest toward the find. */}
      <path
        d="M 12 5.6 L 13.5 10.5 L 18.4 12 L 13.5 13.5 L 12 18.4 L 10.5 13.5 L 5.6 12 L 10.5 10.5 Z"
        fill={`url(#${spark})`}
      />

      {/* Constellation points being revealed outside the ring. */}
      <circle cx="20.8" cy="4.6" r="1.5" fill="var(--pa-mark-accent, rgb(6, 182, 212))" />
      <circle cx="17.4" cy="3.2" r="0.9" fill="var(--pa-mark-from, rgb(167, 139, 250))" />
    </svg>
  )
}

/** Lucide-compatible wrapper so the glyph drops into `icon` slots. */
export function PatternAiDiscoverIcon(props: Readonly<{ size?: number | string; className?: string }>) {
  const size = typeof props.size === 'number' ? props.size : Number.parseInt(String(props.size ?? 16), 10) || 16
  return props.className === undefined ? <PatternAiDiscoverGlyph size={size} /> : <PatternAiDiscoverGlyph size={size} className={props.className} />
}
