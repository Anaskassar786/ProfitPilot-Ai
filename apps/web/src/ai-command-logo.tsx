/**
 * AI Command brand mark — "Neural Command Node".
 *
 * A central hub with radiating connections: one command, everything it
 * controls. The command-prompt chevron in the core (`>`) marks it as a
 * command surface, and the faint dashed orbit suggests the command ring
 * reaching every corner of the store.
 *
 * The mark is pure SVG with a per-instance gradient id (so several marks can
 * share a page safely), scales cleanly from 16px favicons to 64px headers,
 * and reads correctly on both the dark (#0F0F0F) and light (#FFFFFF)
 * canvases — gradients and strokes use theme-aware brand values so the node
 * never disappears into either background.
 */

import { useId } from 'react'

export type AiCommandMarkProps = Readonly<{
  size?: number
  /** `plain` draws the node alone; `badge` adds the rounded gradient plate. */
  variant?: 'plain' | 'badge'
  title?: string
  className?: string
}>

/** Satellite nodes around the hub on a 32×32 grid. */
const SATELLITES: readonly Readonly<{ cx: number; cy: number; r: number; accent?: boolean }>[] = [
  { cx: 16, cy: 5.2, r: 1.7 },
  { cx: 26.4, cy: 13.6, r: 2.1, accent: true },
  { cx: 22.4, cy: 24.4, r: 1.6 },
  { cx: 9.6, cy: 24.4, r: 1.9 },
  { cx: 5.6, cy: 13.6, r: 1.7 },
]

const HUB: Readonly<{ cx: number; cy: number; r: number }> = { cx: 16, cy: 16, r: 5.6 }

export function AiCommandMark({ size = 24, variant = 'plain', title = 'AI Command', className }: AiCommandMarkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const stroke = `ac-stroke-${uid}`
  const hubFill = `ac-hub-${uid}`
  const node = `ac-node-${uid}`
  const plate = `ac-plate-${uid}`
  return (
    <svg
      className={`ac-mark ${className ?? ''}`.trim()}
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
          <stop offset="0%" stopColor="var(--ac-mark-from, #A78BFA)" />
          <stop offset="55%" stopColor="var(--ac-mark-mid, #8B5CF6)" />
          <stop offset="100%" stopColor="var(--ac-mark-to, #C084FC)" />
        </linearGradient>
        <radialGradient id={hubFill} cx="38%" cy="32%" r="85%">
          <stop offset="0%" stopColor="var(--ac-hub-core, #FFFFFF)" />
          <stop offset="48%" stopColor="var(--ac-hub-mid, #C4B5FD)" />
          <stop offset="100%" stopColor="var(--ac-hub-edge, #8B5CF6)" />
        </radialGradient>
        <radialGradient id={node} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="var(--ac-node-core, #FFFFFF)" />
          <stop offset="100%" stopColor="var(--ac-node-edge, #8B5CF6)" />
        </radialGradient>
        <linearGradient id={plate} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--ac-plate-from, rgba(139, 92, 246, 0.2))" />
          <stop offset="100%" stopColor="var(--ac-plate-to, rgba(109, 40, 217, 0.28))" />
        </linearGradient>
      </defs>

      {variant === 'badge' && <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="9" fill={`url(#${plate})`} stroke="var(--ac-plate-line, rgba(139, 92, 246, 0.4))" strokeWidth="1" />}

      {/* Faint command orbit */}
      <circle cx={HUB.cx} cy={HUB.cy} r="13.4" fill="none" stroke={`url(#${stroke})`} strokeWidth="0.9" strokeDasharray="3.2 3.4" opacity="0.5" />

      {/* Radiating connections: one hub, every corner of the store */}
      <g stroke={`url(#${stroke})`} strokeWidth="1.4" strokeLinecap="round" opacity="0.92">
        {SATELLITES.map((point) => (
          <line key={`${point.cx}-${point.cy}`} x1={HUB.cx} y1={HUB.cy} x2={point.cx} y2={point.cy} />
        ))}
      </g>

      {/* Satellite nodes */}
      {SATELLITES.map((point, index) => (
        <g key={index}>
          <circle cx={point.cx} cy={point.cy} r={point.r + 1.4} fill="var(--ac-halo, rgba(139, 92, 246, 0.18))" />
          <circle cx={point.cx} cy={point.cy} r={point.r} fill={point.accent ? 'var(--ac-accent-dot, #C084FC)' : `url(#${node})`} />
        </g>
      ))}

      {/* Central hub */}
      <circle cx={HUB.cx} cy={HUB.cy} r={HUB.r + 2} fill="var(--ac-hub-halo, rgba(139, 92, 246, 0.22))" />
      <circle cx={HUB.cx} cy={HUB.cy} r={HUB.r} fill={`url(#${hubFill})`} stroke="var(--ac-hub-ring, rgba(255, 255, 255, 0.55))" strokeWidth="0.8" />

      {/* Command-prompt chevron in the core */}
      <g stroke="var(--ac-chevron, #4C1D95)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M 12.9 13.2 L 17.4 16 L 12.9 18.8" />
        <path d="M 14.2 20.2 H 17.8" />
      </g>
    </svg>
  )
}

/**
 * Lucide-compatible signature so the mark can drop straight into the
 * sidebar's `icon` slot, which calls icons as `<Icon size={n} />`.
 */
export function AiCommandIcon(props: Readonly<{ size?: number | string; className?: string }>) {
  const size = typeof props.size === 'number' ? props.size : Number.parseInt(String(props.size ?? 18), 10) || 18
  return props.className === undefined ? <AiCommandMark size={size} /> : <AiCommandMark size={size} className={props.className} />
}

/** Wordmark used in the workspace hero and page headers. */
export function AiCommandWordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="ac-wordmark">
      <AiCommandMark size={size} variant="badge" />
      <span className="ac-wordmark-text">
        AI&nbsp;<em>Command</em>
      </span>
    </span>
  )
}
