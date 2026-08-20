import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Mic, MicOff, Pause, Play, X } from 'lucide-react'
import { JarvisOrb } from './JarvisOrb.js'
import type { JarvisOrbState } from './JarvisOrb.js'
import type { FloatingVoiceStatus } from './jarvis-voice.js'

/**
 * The Jarvis voice bar.
 *
 * Jarvis is a voice assistant, not a second chat window — the merchant already
 * has AI Command for typing. So this is a small draggable strip: the orb, one
 * word of state, and exactly three controls (microphone, pause, close). Every
 * answer is spoken; nothing is transcribed on screen.
 */

const STORAGE_KEY = 'profitpilot:jarvis:floating-widget-position'
const WIDGET_WIDTH = 220
const WIDGET_HEIGHT = 76
const MARGIN = 12

type SavedPosition = Readonly<{ x: number; y: number }>

export type JarvisVoiceBarProps = Readonly<{
  /** Visible only while a voice session is running. */
  visible: boolean
  status: FloatingVoiceStatus
  orbState: JarvisOrbState
  micEnabled: boolean
  paused: boolean
  /** Short spoken-state label ("Listening", "Thinking"…). Never an answer. */
  label: string
  /** Hover/assistive detail, typically the current error. */
  detail?: string | null
  onToggleMic: () => void
  onTogglePause: () => void
  onClose: () => void
}>

type DragState = Readonly<{
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
}>

export function loadPosition(storage?: Pick<Storage, 'getItem'>, viewport: { width: number; height: number } = defaultViewport()): SavedPosition {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && Number.isFinite((parsed as SavedPosition).x) && Number.isFinite((parsed as SavedPosition).y)) {
        return clampPosition((parsed as SavedPosition).x, (parsed as SavedPosition).y, viewport)
      }
    }
  } catch { /* storage disabled — fall through to the default position */ }
  return defaultCenterPosition(viewport)
}

/** Default resting place: just above the launcher, bottom-right. */
export function defaultCenterPosition(viewport: { width: number; height: number } = defaultViewport()): SavedPosition {
  return {
    x: Math.max(MARGIN, Math.round((viewport.width - WIDGET_WIDTH) / 2)),
    y: Math.max(MARGIN, Math.round((viewport.height - WIDGET_HEIGHT) / 2)),
  }
}

export function clampPosition(x: number, y: number, viewport: { width: number; height: number } = defaultViewport()): SavedPosition {
  const maxX = Math.max(MARGIN, viewport.width - WIDGET_WIDTH - MARGIN)
  const maxY = Math.max(MARGIN, viewport.height - WIDGET_HEIGHT - MARGIN)
  return { x: Math.min(Math.max(MARGIN, Math.round(x)), maxX), y: Math.min(Math.max(MARGIN, Math.round(y)), maxY) }
}

function savePosition(position: SavedPosition, storage?: Pick<Storage, 'setItem'>): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(position)) } catch { /* storage may be unavailable in embedded browsers */ }
}

function defaultViewport(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1280, height: 800 }
  return { width: window.innerWidth, height: window.innerHeight }
}

/** Maps voice state to the orb animation state. */
export function orbStateFor(status: FloatingVoiceStatus): JarvisOrbState {
  if (status === 'listening') return 'listening'
  if (status === 'processing') return 'thinking'
  if (status === 'speaking') return 'speaking'
  if (status === 'error') return 'warning'
  if (status === 'paused' || status === 'sleeping') return 'sleeping'
  return 'idle'
}

/** One or two words — the merchant hears the content, they only see the state. */
export function statusLabel(status: FloatingVoiceStatus, micEnabled: boolean, paused: boolean): string {
  if (paused) return 'Paused'
  if (status === 'error') return 'Voice issue'
  if (status === 'listening') return 'Listening'
  if (status === 'processing') return 'Thinking'
  if (status === 'speaking') return 'Speaking'
  return micEnabled ? 'Ready' : 'Mic off'
}

export function JarvisVoiceBar({ visible, status, orbState, micEnabled, paused, label, detail, onToggleMic, onTogglePause, onClose }: JarvisVoiceBarProps) {
  const [position, setPosition] = useState<SavedPosition>(() => loadPosition(typeof window === 'undefined' ? undefined : window.localStorage))
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)

  // Re-clamp on resize so the bar is never stranded off-screen.
  useEffect(() => {
    if (!visible) return
    const onResize = () => setPosition((current) => clampPosition(current.x, current.y))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [visible])

  if (!visible || typeof document === 'undefined') return null

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    const target = barRef.current
    if (!target) return
    try { target.setPointerCapture(event.pointerId) } catch { /* ignore */ }
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y, moved: false }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    dragRef.current = { ...drag, moved: true }
    setPosition(clampPosition(drag.originX + dx, drag.originY + dy))
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag && event.pointerId === drag.pointerId) {
      try { barRef.current?.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
      const finalPosition = clampPosition(position.x, position.y)
      setPosition(finalPosition)
      if (drag.moved) savePosition(finalPosition, typeof window === 'undefined' ? undefined : window.localStorage)
    }
    dragRef.current = null
    setDragging(false)
  }

  const style: CSSProperties = {
    left: position.x,
    top: position.y,
    zIndex: 60,
    touchAction: 'none',
    cursor: dragging ? 'grabbing' : 'grab',
  }

  const bar = (
    <div
      className={`jarvis-voice-bar status-${status}${paused ? ' is-paused' : ''}`}
      ref={barRef}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="toolbar"
      aria-label="Jarvis voice controls"
      title={detail ?? 'Drag to move'}
    >
      <span className="jarvis-voice-bar-orb"><JarvisOrb state={orbState} size={30} label={`Jarvis ${status}`} /></span>
      <span className="jarvis-voice-bar-state" aria-live="polite">{label}</span>
      <span className="jarvis-voice-bar-controls">
        <button
          type="button"
          className={`icon-button ${micEnabled && !paused ? 'mic-live' : ''}`}
          onClick={onToggleMic}
          aria-pressed={micEnabled && !paused}
          aria-label={micEnabled ? 'Turn microphone off' : 'Turn microphone on'}
          title={micEnabled ? 'Microphone on' : 'Microphone off'}
        >
          {micEnabled && !paused ? <Mic size={14} /> : <MicOff size={14} />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onTogglePause}
          aria-label={paused ? 'Resume Jarvis' : 'Pause Jarvis'}
          title={paused ? 'Resume' : 'Pause'}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close Jarvis" title="Close">
          <X size={14} />
        </button>
      </span>
    </div>
  )

  return createPortal(bar, document.body)
}
