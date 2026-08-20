import type { ReactElement } from 'react'
import { Mic, ShieldCheck, Sparkles, Workflow } from 'lucide-react'
import { JarvisOrb } from './JarvisOrb.js'
import type { WorkspaceContext } from './model.js'

export function JarvisNavIcon({ size = 17, className, strokeWidth: _strokeWidth }: Readonly<{ size?: number | string; className?: string; strokeWidth?: number }>): ReactElement {
  const px = typeof size === 'number' ? size : Number.parseInt(String(size), 10) || 17
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#0B1B3A" />
      <circle cx="12" cy="12" r="7.2" fill="#1D4ED8" opacity=".9" />
      <circle cx="9.4" cy="9.2" r="3.4" fill="#7DD3FC" opacity=".85" />
    </svg>
  )
}

export function JarvisWorkspace({ context, onListen }: Readonly<{ context: WorkspaceContext; onListen: () => void }>) {
  return (
    <div className="jarvis-stage">
      <button type="button" className="jarvis-stage-orb" onClick={onListen} aria-label={context.storeId ? 'Start Jarvis voice' : 'Connect Shopify before using Jarvis'}>
        <JarvisOrb state={context.storeId ? 'idle' : 'warning'} size={176} label={context.storeId ? 'Start Jarvis voice' : 'Connect Shopify for Jarvis'} />
      </button>
      <div className="jarvis-stage-copy">
        <span className="section-kicker">SPOKEN STORE ASSISTANT</span>
        <h2>{context.storeId ? 'Tap the orb to speak' : 'Connect Shopify to wake Jarvis'}</h2>
        <p>Jarvis briefs the page you are on and stays on store work. Typed questions live in AI Command.</p>
      </div>
      <div className="jarvis-stage-grid">
        <article>
          <Sparkles size={16} />
          <strong>Page-aware</strong>
          <span>On every workspace page it can say what matters there and the next useful step.</span>
        </article>
        <article>
          <ShieldCheck size={16} />
          <strong>Suggestions first</strong>
          <span>Trial, Start, and Growth get grounded suggestions only — never invented numbers.</span>
        </article>
        <article>
          <Workflow size={16} />
          <strong>Commander actions</strong>
          <span>On Commander it can open a page or draft an automation after you say confirm.</span>
        </article>
      </div>
      <p className="jarvis-stage-hint"><Mic size={13} /> Speak after the listening glow. Pause or close from the strip anytime.</p>
    </div>
  )
}
