import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Mic, MicOff, Pause, Play, X } from 'lucide-react'
import { JarvisOrb } from './JarvisOrb.js'
import type { JarvisOrbState } from './JarvisOrb.js'
import { useJarvisVoiceSnapshot } from './jarvis-voice.js'
import type { FloatingVoiceStatus } from './jarvis-voice.js'

const STORAGE_KEY = 'profitpilot:jarvis:floating-widget-position'
export const WIDGET_WIDTH = 340
export const WIDGET_HEIGHT = 78
const MARGIN = 12

type SavedPosition = Readonly<{ x: number; y: number }>

export type FloatingVoiceWidgetProps = Readonly<{
  visible: boolean
  address: string
  page: string
  caption: string
  paused: boolean
  micOn: boolean
  onMic: () => void
  onPause: () => void
  onResume: () => void
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
  } catch { /* storage disabled — fall through to default center position */ }
  return defaultCenterPosition(viewport)
}

export function defaultCenterPosition(viewport: { width: number; height: number } = defaultViewport()): SavedPosition {
  return {
    x: Math.max(MARGIN, Math.round((viewport.width - WIDGET_WIDTH) / 2)),
    y: Math.max(MARGIN, Math.round(viewport.height - WIDGET_HEIGHT - 28)),
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
    case 'processing': return 'Checking store data…'
    case 'speaking': return 'Speaking…'
    case 'paused': return 'Paused'
    case 'sleeping': return 'Paused'
    case 'error': return 'Voice error'
    default: return 'Ready'
  }
}

export function FloatingVoiceWidget({ visible, address, page, caption, paused, micOn, onMic, onPause, onResume, onClose }: FloatingVoiceWidgetProps) {
  const voice = useJarvisVoiceSnapshot()
  const [position, setPosition] = useState<SavedPosition>(() => loadPosition(typeof window === 'undefined' ? undefined : window.localStorage))
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const widgetRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!visible) return
    const onResize = () => setPosition((current) => clampPosition(current.x, current.y))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [visible])

  if (!visible || typeof document === 'undefined') return null

  const status: FloatingVoiceStatus = paused ? 'paused' : voice.status
  const orbState = orbStateFor(status)
  const detail = voice.error ?? caption ?? `${page.replace(/-/g, ' ')} · drag to move`

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
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
    opacity: voice.status === 'idle' && !dragging ? 0.96 : 1,
  }

  const control = (
    <div className="jarvis-floating-widget" ref={widgetRef} style={style} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} role="dialog" aria-label="Jarvis voice assistant">
      <span className="jarvis-floating-orb"><JarvisOrb state={orbState} size={48} label={`Jarvis ${status}`} /></span>
      <div className="jarvis-floating-copy">
        <strong>{statusLabel(status, address, voice.error)}</strong>
        <span>{detail}</span>
      </div>
      <div className="jarvis-floating-controls">
        <button type="button" className={`icon-button ${micOn && !paused ? 'voice-active' : ''}`} onClick={onMic} aria-label={micOn ? 'Turn microphone off' : 'Turn microphone on'} title={micOn ? 'Mic off' : 'Mic on'}>
          {micOn && !paused ? <Mic size={15} /> : <MicOff size={15} />}
        </button>
        <button type="button" className="icon-button" onClick={paused ? onResume : onPause} aria-label={paused ? 'Resume Jarvis' : 'Pause Jarvis'} title={paused ? 'Resume' : 'Pause'}>
          {paused ? <Play size={15} /> : <Pause size={15} />}
        </button>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close Jarvis" title="Close"><X size={15} /></button>
      </div>
    </div>
  )

  return createPortal(control, document.body)
}
