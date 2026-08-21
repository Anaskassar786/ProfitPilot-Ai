/**
 * GrowthIQ — brand mark.
 *
 * An upward growth arrow woven through neural-network nodes: the arrow is
 * the business trajectory, the nodes are the intelligence layer that reads
 * it. Purple gradient (rgb(139, 92, 246) → rgb(99, 102, 241)) is the GrowthIQ signature and the
 * mark is built from strokes + circles only, so it stays crisp from 16px up
 * and reads identically in dark and light themes (the gradient badge is
 * self-contained; only the wordmark text uses theme tokens).
 */
import { useId } from 'react'

export type GrowthIqMarkProps = Readonly<{ size?: number; withBadge?: boolean; title?: string }>

/** The GrowthIQ mark: upward arrow through neural nodes on a purple badge. */
export function GrowthIqMark({ size = 24, withBadge = true, title = 'GrowthIQ' }: GrowthIqMarkProps) {
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const arrowGradientId = `${gradientId}a`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      focusable="false"
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={`${gradientId}g`} x1="0" y1="32" x2="32" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="rgb(99, 102, 241)" />
          <stop offset="1" stopColor="rgb(139, 92, 246)" />
        </linearGradient>
        <radialGradient id={`${gradientId}h`} cx="0.82" cy="0.12" r="0.9">
          <stop offset="0" stopColor="rgb(255, 255, 255)" stopOpacity="0.28" />
          <stop offset="0.55" stopColor="rgb(255, 255, 255)" stopOpacity="0.06" />
          <stop offset="1" stopColor="rgb(255, 255, 255)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {withBadge ? (
        <rect x="1" y="1" width="30" height="30" rx="8" fill={`url(#${gradientId}g)`} />
      ) : null}
      <rect x="1" y="1" width="30" height="30" rx="8" fill={`url(#${gradientId}h)`} />
      {/* Neural links (faint connections between intelligence nodes) */}
      <g stroke="rgb(255, 255, 255)" strokeWidth="1.1" opacity="0.5" strokeLinecap="round">
        <line x1="11.5" y1="17" x2="7.5" y2="12.5" />
        <line x1="15.5" y1="21" x2="22.5" y2="23.5" />
      </g>
      {/* Satellite nodes */}
      <circle cx="7.5" cy="12.5" r="1.5" fill="rgb(255, 255, 255)" opacity="0.75" />
      <circle cx="22.5" cy="23.5" r="1.8" fill="rgb(255, 255, 255)" opacity="0.75" />
      {/* The growth arrow */}
      <path
        d="M5 24.5 L11.5 17.5 L15.5 21.5 L25.5 10"
        fill="none"
        stroke="rgb(255, 255, 255)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.5 8.8 L26 8.4 L26.2 14.8"
        fill="none"
        stroke="rgb(255, 255, 255)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Primary neural nodes on the trajectory */}
      <circle cx="11.5" cy="17" r="2.3" fill="rgb(255, 255, 255)" />
      <circle cx="15.5" cy="21" r="1.9" fill="rgb(255, 255, 255)" />
    </svg>
  )
}

/**
 * Sidebar/breadcrumb icon adapter. The workspace nav renders icons with the
 * shared icon contract (`size` + `strokeWidth` + `className`); this wrapper
 * maps that onto GrowthIqMark so the brand mark can be used as a nav icon
 * without touching the shared nav rendering.
 */
export function GrowthIqNavIcon(props: Readonly<{ size?: number | string; strokeWidth?: number; className?: string }>) {
  const size = typeof props.size === 'number' ? props.size : Number.parseInt(String(props.size ?? 17), 10) || 17
  return <GrowthIqMark size={size} />
}

/** Mark + wordmark lockup for page headers. */
export function GrowthIqWordmark({ size = 30, tone = 'auto' }: Readonly<{ size?: number; tone?: 'auto' | 'on-dark' }>) {
  return (
    <span className={`gq-wordmark ${tone === 'on-dark' ? 'on-dark' : ''}`} aria-label="GrowthIQ">
      <GrowthIqMark size={size} />
      <span className="gq-wordmark-text">
        Growth<span className="gq-wordmark-iq">IQ</span>
      </span>
    </span>
  )
}
