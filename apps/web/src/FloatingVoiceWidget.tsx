import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, Volume2, VolumeX, X } from 'lucide-react'
import { JarvisOrb } from './JarvisOrb.js'
import type { JarvisOrbState } from './JarvisOrb.js'
import { jarvisVoiceController, useJarvisVoiceSnapshot } from './jarvis-voice.js'
import type { FloatingVoiceStatus } from './jarvis-voice.js'

const STORAGE_KEY = 'profitpilot:jarvis:floating-widget-position'
const WIDGET_WIDTH = 220
const WIDGET_HEIGHT = 76
const MARGIN = 12

type SavedPosition = Readonly<{ x: number; y: number }>

export type FloatingVoiceWidgetProps = Readonly<{
  /** Visible only while a voice session is active (the chat panel may be closed). */
  visible: boolean
  address: string
  paused: boolean
  onPause: () => void
  onResume: () => void
  onClose: () => void
  onOpenPanel: () => void
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
  } catch { /* storage disabled — fall through to default center position */ }
  return defaultCenterPosition(viewport)
}

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

function orbStateFor(status: FloatingVoiceStatus): JarvisOrbState {
  if (status === 'listening') return 'listening'
  if (status === 'processing') return 'thinking'
  if (status === 'speaking') return 'speaking'
  if (status === 'error') return 'warning'
  if (status === 'paused' || status === 'sleeping') return 'sleeping'
  return 'idle'
}

function statusLabel(status: FloatingVoiceStatus, address: string, error: string | null): string {
  if (error) return 'Voice unavailable'
  switch (status) {
    case 'listening': return `Listening, ${address}…`
    case 'processing': return 'Thinking…'
    case 'speaking': return 'Speaking…'
    case 'paused': return 'Paused'
    case 'sleeping': return 'Sleeping'
    case 'error': return 'Voice error'
    default: return 'Voice ready'
  }
}

export function FloatingVoiceWidget({ visible, address, paused, onPause, onResume, onClose, onOpenPanel }: FloatingVoiceWidgetProps) {
  const voice = useJarvisVoiceSnapshot()
  const [position, setPosition] = useState<SavedPosition>(() => loadPosition(typeof window === 'undefined' ? undefined : window.localStorage))
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const widgetRef = useRef<HTMLDivElement | null>(null)

  // Re-clamp on viewport resize so the widget never gets stranded off-screen.
  useEffect(() => {
    if (!visible) return
    const onResize = () => setPosition((current) => clampPosition(current.x, current.y))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [visible])

  if (!visible || typeof document === 'undefined') return null

  const status: FloatingVoiceStatus = paused ? 'paused' : voice.status
  const orbState = orbStateFor(status)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Only the drag handle area starts a drag; buttons stop propagation.
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    const target = widgetRef.current
    if (!target) return
    target.setPointerCapture(event.pointerId)
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
      try { widgetRef.current?.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
      const finalPosition = clampPosition(position.x, position.y)
      setPosition(finalPosition)
      savePosition(finalPosition, typeof window === 'undefined' ? undefined : window.localStorage)
      // A tap (no real drag) reopens the chat panel.
      if (!drag.moved) onOpenPanel()
    }
    dragRef.current = null
    setDragging(false)
  }

  const style: CSSProperties = {
    left: position.x,
    top: position.y,
    width: WIDGET_WIDTH,
    zIndex: 60,
    touchAction: 'none',
    cursor: dragging ? 'grabbing' : 'grab',
    opacity: voice.status === 'idle' && !dragging ? 0.92 : 1,
  }

  const control = (
    <div className="jarvis-floating-widget" ref={widgetRef} style={style} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} role="dialog" aria-label="Jarvis voice is active">
      <span className="jarvis-floating-orb"><JarvisOrb state={orbState} size={40} label={`Jarvis ${status}`} /></span>
      <div className="jarvis-floating-copy">
        <strong>{statusLabel(status, address, voice.error)}</strong>
        <span>{voice.error ?? 'Tap to open chat · drag to move'}</span>
      </div>
      <div className="jarvis-floating-controls">
        <button type="button" className="icon-button" onClick={paused ? onResume : onPause} aria-label={paused ? 'Resume listening' : 'Pause listening'} title={paused ? 'Resume' : 'Pause'}>
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <button type="button" className="icon-button" onClick={() => jarvisVoiceController.setMuted(!voice.muted)} aria-label={voice.muted ? 'Unmute voice' : 'Mute voice'} title={voice.muted ? 'Unmute' : 'Mute'}>
          {voice.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Stop voice and close widget" title="Close"><X size={14} /></button>
      </div>
    </div>
  )

  return createPortal(control, document.body)
}
