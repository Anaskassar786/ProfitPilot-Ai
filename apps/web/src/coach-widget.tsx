import { Button } from './polaris-ui.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, CalendarDays, ChevronRight, MessageSquare, X } from './icons.js'
import { ApiClientError, fetchCoachHuddle, fetchCoachPreferences, fetchCoachPriorities, fetchCoachStreak, streamCoachChat } from './api.js'
import { PLAN_LABEL } from './store-coach-model.js'
import type { CoachHuddle, CoachPlan, CoachPriority, CoachStreakView } from './store-coach-model.js'

/**
 * PR #48 — Coach widget. A floating, draggable Store Coach surface available
 * on every page for Start+ plans. Collapsed: coach icon + notification dot.
 * Expanded: huddle status, the top priority, and quick chat. Dismissible per
 * session and disabled from Store Coach preferences.
 */

export function CoachWidget({ storeId, onToast, onNavigate }: { storeId: string; onToast: (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void; onNavigate?: () => void }) {
  const [plan, setPlan] = useState<CoachPlan | null>(null)
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [huddle, setHuddle] = useState<CoachHuddle | null>(null)
  const [priority, setPriority] = useState<CoachPriority | null>(null)
  const [streak, setStreak] = useState<CoachStreakView | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [message, setMessage] = useState('')
  const [reply, setReply] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  useEffect(() => {
    void fetchCoachPreferences(storeId).then((preferences) => {
      if (!preferences.widgetEnabled) { setPlan(null); return }
      setPlan(preferences.plan)
    }).catch(() => setPlan(null))
  }, [storeId])

  useEffect(() => {
    if (!plan) return
    void Promise.allSettled([fetchCoachHuddle(storeId), fetchCoachPriorities(storeId), fetchCoachStreak(storeId)]).then(([huddleResult, prioritiesResult, streakResult]) => {
      if (huddleResult.status === 'fulfilled') setHuddle(huddleResult.value)
      if (prioritiesResult.status === 'fulfilled') setPriority(prioritiesResult.value.priorities[0] ?? null)
      if (streakResult.status === 'fulfilled') setStreak(streakResult.value)
    })
  }, [storeId, plan])

  const ask = useCallback(() => {
    if (!message.trim() || busy) return
    setBusy(true)
    setReply('')
    void streamCoachChat(storeId, message, setReply)
      .then((final) => { setReply(final.content); setMessage('') })
      .catch((error: unknown) => onToast(error instanceof ApiClientError ? error.message : 'Coach chat failed.', 'error'))
      .finally(() => setBusy(false))
  }, [storeId, message, busy, onToast])

  if (dismissed || plan === null || (plan !== 'start' && plan !== 'growth' && plan !== 'commander')) return null

  const dot = huddle && !huddle.viewed
  const unread = priority !== null || (huddle !== null && !huddle.viewed)

  return (
    <div className={`coach-widget ${open ? 'open' : ''}`} style={position ? { right: 'auto', bottom: 'auto', left: position.x, top: position.y } : undefined}>
      {open && (
        <div className="coach-widget-panel">
          <div
            className="coach-widget-head"
            onPointerDown={(event) => {
              const target = event.currentTarget
              const rect = target.getBoundingClientRect()
              dragRef.current = { startX: event.clientX, startY: event.clientY, originX: rect.left, originY: rect.top }
              const onMove = (move: PointerEvent) => {
                if (!dragRef.current) return
                setPosition({ x: dragRef.current.originX + (move.clientX - dragRef.current.startX), y: dragRef.current.originY + (move.clientY - dragRef.current.startY) })
              }
              const onUp = () => { dragRef.current = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
              window.addEventListener('pointermove', onMove)
              window.addEventListener('pointerup', onUp)
            }}
          >
            <span className="coach-widget-title"><Bot size={15} /> Store Coach</span>
            <span className="coach-widget-plan">{PLAN_LABEL[plan]}</span>
            <Button className="icon-button" onClick={() => setDismissed(true)} aria-label="Dismiss widget for this session"><X size={14} /></Button>
          </div>
          <div className="coach-widget-body">
            <div className="coach-widget-status">
              <span className="coach-widget-status-icon"><CalendarDays size={14} /></span>
              <div>
                <strong>{huddle ? (huddle.viewed ? 'Today\u2019s huddle viewed' : 'Today\u2019s huddle is ready') : 'Coach is preparing your huddle'}</strong>
                <small>{streak ? `${streak.currentStreak} day streak · ${streak.todayViewed ? 'alive' : 'view your huddle'}` : 'No streak yet'}</small>
              </div>
            </div>
            {priority && (
              <div className="coach-widget-priority">
                <span>TOP PRIORITY</span>
                <strong>{priority.title}</strong>
                <small>{priority.description}</small>
              </div>
            )}
            {reply !== null && <div className="coach-widget-reply">{reply || <span className="coach-typing"><i /><i /><i /></span>}</div>}
            <div className="coach-widget-composer">
              <input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void ask() }} placeholder="Ask your coach…" disabled={busy} />
              <Button className="icon-button" onClick={() => void ask()} disabled={busy || !message.trim()} aria-label="Send"><MessageSquare size={14} /></Button>
            </div>
          </div>
          {/* HOTFIX 3: SPA navigation — intercept the click so opening Store
              Coach from the floating widget never hard-reloads the embedded
              iframe (which would re-run the whole bootstrap). The href stays
              for middle-click / deep-link semantics. */}
          <a
            className="coach-widget-open"
            href={`/ai-growth-command/coach${window.location.search}`}
            onClick={(event) => {
              if (!onNavigate) return
              event.preventDefault()
              onNavigate()
            }}
          >Open Store Coach <ChevronRight size={13} /></a>
        </div>
      )}
      <Button
        className="coach-widget-fab"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Collapse Store Coach widget' : 'Expand Store Coach widget'}
      >
        {open ? <X size={18} /> : <Bot size={18} />}
        {!open && unread && <span className="coach-widget-dot" />}
      </Button>
    </div>
  )
}
