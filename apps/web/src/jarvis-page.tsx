import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Check, Mic, Settings2, ShieldCheck, Sparkles, Volume2, Workflow } from 'lucide-react'
import { fetchJarvisPreferences, saveJarvisPreferences, saveWorkspaceSettings } from './api.js'
import { JarvisOrb } from './JarvisOrb.js'
import type { WorkspaceContext } from './model.js'
import type { JarvisAddressing, JarvisPreference } from './f8-model.js'
import { defaultWorkspaceSettings, mergeWorkspaceSettings, writeWorkspaceSettings } from './settings-model.js'
import type { WorkspaceSettings } from './settings-model.js'

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

type JarvisWorkspaceProps = Readonly<{
  context: WorkspaceContext
  onListen: () => void
  onToast?: (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void
  workspaceSettings?: WorkspaceSettings
}>

const ADDRESSING_OPTIONS: readonly JarvisAddressing[] = ['Sir', "Ma'am", 'Commander', 'Miss']

export function JarvisWorkspace({ context, onListen, onToast, workspaceSettings }: JarvisWorkspaceProps) {
  const baseSettings = useMemo(() => workspaceSettings ?? defaultWorkspaceSettings(), [workspaceSettings])
  const [preference, setPreference] = useState<JarvisPreference | null>(null)
  const [addressing, setAddressing] = useState<JarvisAddressing>('Sir')
  const [voiceGender, setVoiceGender] = useState<WorkspaceSettings['jarvisVoiceGender']>(baseSettings.jarvisVoiceGender)
  const [language, setLanguage] = useState<JarvisPreference['language']>('auto')
  const [offerGuidance, setOfferGuidance] = useState(true)
  const [answerOnly, setAnswerOnly] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setVoiceGender(baseSettings.jarvisVoiceGender)
  }, [baseSettings.jarvisVoiceGender])

  useEffect(() => {
    if (!context.storeId) {
      setPreference(null)
      setAddressing('Sir')
      setOfferGuidance(true)
      setAnswerOnly(false)
      return
    }
    let cancelled = false
    void fetchJarvisPreferences(context.storeId).then((next) => {
      if (cancelled) return
      setPreference(next)
      setAddressing(next.addressing)
      setLanguage(next.language)
      setOfferGuidance(next.navigationSuggestions)
      setAnswerOnly(next.onlyAnswerWhenAsked)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [context.storeId])

  const saveSettings = async () => {
    const nextSettings = mergeWorkspaceSettings(baseSettings, { jarvisVoiceGender: voiceGender })
    writeWorkspaceSettings(context.storeId, nextSettings)
    setSaving(true)
    try {
      if (context.storeId) {
        const engagementMode = answerOnly
          ? 'answer-only'
          : preference?.engagementMode === 'answer-only'
            ? 'balanced'
            : (preference?.engagementMode ?? 'balanced')
        const [workspaceResult, preferenceResult] = await Promise.allSettled([
          saveWorkspaceSettings(context.storeId, nextSettings),
          saveJarvisPreferences({
            storeId: context.storeId,
            addressing,
            language,
            navigationSuggestions: offerGuidance,
            onlyAnswerWhenAsked: answerOnly,
            engagementMode,
          }),
        ])
        if (preferenceResult.status === 'fulfilled') setPreference(preferenceResult.value)
        if (workspaceResult.status === 'rejected' || preferenceResult.status === 'rejected') {
          onToast?.('Jarvis settings were saved locally. Server sync can catch up in a moment.', 'warning')
          return
        }
      }
      onToast?.('Jarvis settings saved.', 'success')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="jarvis-stage">
      <button type="button" className="jarvis-stage-orb" onClick={onListen} aria-label={context.storeId ? 'Start Jarvis voice' : 'Connect Shopify before using Jarvis'}>
        <JarvisOrb state={context.storeId ? 'idle' : 'warning'} size={176} label={context.storeId ? 'Start Jarvis voice' : 'Connect Shopify for Jarvis'} />
      </button>
      <div className="jarvis-stage-copy">
        <span className="section-kicker">SPOKEN STORE ASSISTANT</span>
        <h2>{context.storeId ? 'Tap the orb to speak' : 'Connect Shopify to wake Jarvis'}</h2>
        <p>Jarvis now speaks more naturally, asks before over-explaining a new page, and lets you choose a male or female voice right here.</p>
      </div>
      <div className="jarvis-stage-grid">
        <article>
          <Sparkles size={16} />
          <strong>Page-aware</strong>
          <span>On a new page Jarvis asks first, then explains only if you say yes.</span>
        </article>
        <article>
          <ShieldCheck size={16} />
          <strong>Suggestions first</strong>
          <span>Trial, Start, and Growth stay in suggestion mode. Commander can navigate and take confirmed actions.</span>
        </article>
        <article>
          <Workflow size={16} />
          <strong>Commander actions</strong>
          <span>Tell Jarvis to open a page, guide you, or create a safe draft action after confirmation.</span>
        </article>
      </div>

      <section className="jarvis-settings-surface card">
        <div className="settings-panel-head">
          <span className="settings-panel-icon"><Settings2 size={16} /></span>
          <div>
            <h3>Jarvis settings</h3>
            <p>Change the voice, how Jarvis addresses you, and how proactive it should be.</p>
          </div>
        </div>

        <div className="jarvis-settings-grid">
          <div className="jarvis-settings-card">
            <div className="jarvis-settings-label"><Volume2 size={15} /> Voice style</div>
            <div className="jarvis-choice-row" role="radiogroup" aria-label="Jarvis voice style">
              <ChoiceButton selected={voiceGender === 'feminine'} onClick={() => setVoiceGender('feminine')} label="Female" hint="Softer, assistant-style voice" />
              <ChoiceButton selected={voiceGender === 'masculine'} onClick={() => setVoiceGender('masculine')} label="Male" hint="Deeper, assistant-style voice" />
            </div>
          </div>

          <div className="jarvis-settings-card">
            <div className="jarvis-settings-label"><Mic size={15} /> Conversation language</div>
            <label className="jarvis-language-select">
              <span className="sr-only">Jarvis conversation language</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value as JarvisPreference['language'])}>
                <option value="auto">Auto-detect (English or Hindi)</option>
                <option value="en">English</option>
                <option value="hi">Hindi / Hinglish</option>
              </select>
            </label>
            <small className="jarvis-setting-help">Hindi voice input uses hi-IN. For best results, speak after the listening indicator appears.</small>
          </div>

          <div className="jarvis-settings-card">
            <div className="jarvis-settings-label"><Mic size={15} /> How Jarvis addresses you</div>
            <div className="jarvis-choice-row jarvis-choice-row-compact" role="radiogroup" aria-label="Jarvis addressing">
              {ADDRESSING_OPTIONS.map((option) => (
                <PillButton key={option} selected={addressing === option} onClick={() => setAddressing(option)}>{option}</PillButton>
              ))}
            </div>
          </div>

          <div className="jarvis-settings-card">
            <div className="jarvis-settings-label"><Sparkles size={15} /> Page guidance</div>
            <button type="button" className={`jarvis-toggle-card ${offerGuidance ? 'selected' : ''}`} onClick={() => setOfferGuidance((value) => !value)}>
              <span>
                <strong>Ask before explaining a new page</strong>
                <small>Jarvis says “If you want, I can explain this page” instead of briefing every page automatically.</small>
              </span>
              {offerGuidance && <Check size={15} />}
            </button>
          </div>

          <div className="jarvis-settings-card">
            <div className="jarvis-settings-label"><ShieldCheck size={15} /> Quiet mode</div>
            <button type="button" className={`jarvis-toggle-card ${answerOnly ? 'selected' : ''}`} onClick={() => setAnswerOnly((value) => !value)}>
              <span>
                <strong>Only answer when I ask</strong>
                <small>Useful if you want Jarvis fully on-demand while you browse the store.</small>
              </span>
              {answerOnly && <Check size={15} />}
            </button>
          </div>
        </div>

        <div className="jarvis-settings-footer">
          <span><Sparkles size={14} /> These settings apply to the floating Jarvis bubble across your workspace.</span>
          <div className="jarvis-settings-actions">
            <button type="button" className="button secondary" onClick={onListen}>{context.storeId ? 'Start listening' : 'Connect Shopify first'}</button>
            <button type="button" className="button primary" onClick={() => void saveSettings()} disabled={saving}>{saving ? 'Saving…' : 'Save Jarvis settings'}</button>
          </div>
        </div>
      </section>

      <p className="jarvis-stage-hint"><Mic size={13} /> Speak after the listening glow. Say “yes” if you want a page walkthrough, or ask Jarvis to open Recommendations, Customers, Products, and more.</p>
    </div>
  )
}

function ChoiceButton({ selected, onClick, label, hint }: Readonly<{ selected: boolean; onClick: () => void; label: string; hint: string }>) {
  return (
    <button type="button" className={`jarvis-choice-button ${selected ? 'selected' : ''}`} onClick={onClick} role="radio" aria-checked={selected}>
      <strong>{label}</strong>
      <small>{hint}</small>
    </button>
  )
}

function PillButton({ selected, onClick, children }: Readonly<{ selected: boolean; onClick: () => void; children: string }>) {
  return (
    <button type="button" className={`jarvis-pill-button ${selected ? 'selected' : ''}`} onClick={onClick} role="radio" aria-checked={selected}>
      {children}
    </button>
  )
}
