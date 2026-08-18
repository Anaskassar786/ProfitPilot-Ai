import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertCircle,
  Archive,
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  Command,
  History,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  X,
  Zap,
} from 'lucide-react'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import { useAiCommandWorkspace } from './ai-command-hooks.js'
import {
  GROUP_LABELS,
  cellText,
  formatTimestamp,
  groupConversations,
  planLabel,
  remainingUndoSeconds,
  searchConversations,
  tableRows,
  usageLabel,
  usagePercent,
  usageTone,
} from './ai-command-model.js'
import type { AiCommandMessage, AiCommandPlan } from './ai-command-model.js'
import type { WorkspaceContext } from './model.js'

type ToastFn = (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void

export function AiCommandWorkspace({ context, plan = 'trial', onToast, onNavigateBilling, initialConversationId = null }: {
  context: WorkspaceContext
  plan?: AiCommandPlan
  onToast: ToastFn
  onNavigateBilling: () => void
  initialConversationId?: string | null
}) {
  const storeId = context.storeId
  const workspace = useAiCommandWorkspace(storeId, onToast)
  const [draft, setDraft] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [now, setNow] = useState(Date.now())
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (initialConversationId) void workspace.openConversation(initialConversationId)
  }, [initialConversationId])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [workspace.conversation?.messages.length, workspace.thinking.length, workspace.streaming])

  if (!storeId) {
    return (
      <div className="aic-empty">
        <span className="aic-orb"><Bot size={28} /></span>
        <h2>Connect Shopify to open AI Command</h2>
        <p>AI Command answers only from your live store data. Connect a store first — nothing here is ever invented.</p>
      </div>
    )
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void workspace.send(text)
  }

  const grouped = groupConversations(searchConversations(workspace.conversations, search))
  const messages = workspace.conversation?.messages ?? []

  return (
    <div className="aic-shell">
      <header className="aic-header">
        <div className="aic-title">
          <span className="aic-orb compact"><Sparkles size={18} /></span>
          <div>
            <h2>AI Command</h2>
            <p>One command controls everything</p>
          </div>
          <span className={`aic-plan-badge ${plan}`}>{planLabel(plan)}</span>
        </div>
        <div className="aic-header-actions">
          <button type="button" className="aic-button secondary" onClick={workspace.newChat}><Plus size={15} /> New Chat</button>
          <button type="button" className="aic-button ghost" onClick={() => setHistoryOpen((value) => !value)} aria-expanded={historyOpen}><History size={15} /> History</button>
          <button type="button" className="aic-button ghost" onClick={() => setSettingsOpen((value) => !value)} aria-label="AI Command settings"><Settings size={15} /></button>
        </div>
      </header>

      <div className={`aic-layout ${historyOpen || settingsOpen ? 'with-side' : ''}`}>
        <section className="aic-main" aria-label="AI Command conversation">
          {workspace.error && (
            <div className="aic-banner error" role="alert">
              <AlertCircle size={16} />
              <span>{workspace.error}</span>
              {workspace.limitReached && <UpgradePlanButton plan={plan} onUpgrade={onNavigateBilling} />}
            </div>
          )}

          <div className="aic-scroll" ref={scrollRef}>
            {messages.length === 0 && !workspace.busy && <EmptyState plan={plan} onPrompt={(value) => void workspace.send(value)} onUpgrade={onNavigateBilling} />}
            {messages.map((item) => (
              <MessageBubble
                key={item.id}
                message={item}
                now={now}
                busy={workspace.busy}
                onApprove={(id) => void workspace.approve(id)}
                onCancel={(id) => void workspace.cancel(id)}
                onUndo={(id) => void workspace.undo(id)}
                onUpgrade={onNavigateBilling}
                plan={plan}
                onSave={(text) => void workspace.saveCurrent(text.slice(0, 40), text)}
              />
            ))}
            {workspace.busy && <ThinkingCard steps={workspace.thinking} streaming={workspace.streaming} />}
          </div>

          <form className="aic-composer" onSubmit={submit}>
            <label className="aic-composer-label" htmlFor="aic-input">
              <Command size={13} /> Type your command
            </label>
            <div className="aic-composer-row">
              <textarea
                id="aic-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask anything about your store, or tell me what to do…"
                rows={2}
                disabled={workspace.busy || workspace.limitReached}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
                }}
              />
              <button type="submit" className="aic-send" disabled={workspace.busy || !draft.trim()} aria-label="Send command">
                {workspace.busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
              </button>
            </div>
            <div className="aic-quick" aria-label="Quick commands">
              {(workspace.quick.length ? workspace.quick : fallbackQuick(plan)).map((item) => (
                <button type="button" key={item.id} onClick={() => void workspace.send(item.command)} disabled={workspace.busy}>
                  {item.label}
                </button>
              ))}
            </div>
          </form>
        </section>

        {(historyOpen || settingsOpen) && (
          <aside className="aic-sidebar" aria-label="AI Command sidebar">
            <UsageCard usage={workspace.usage} plan={plan} onUpgrade={onNavigateBilling} />
            {settingsOpen && workspace.preferences && (
              <section className="aic-side-block">
                <h3>Preferences</h3>
                <label className="aic-toggle">
                  <input type="checkbox" checked={workspace.preferences.thinkingAnimationEnabled} onChange={(event) => void workspace.patchPreferences({ thinkingAnimationEnabled: event.target.checked })} />
                  Thinking animation
                </label>
                <label className="aic-toggle">
                  <input type="checkbox" checked={workspace.preferences.quickCommandsEnabled} onChange={(event) => void workspace.patchPreferences({ quickCommandsEnabled: event.target.checked })} />
                  Quick commands
                </label>
              </section>
            )}
            <section className="aic-side-block">
              <div className="aic-side-head">
                <h3>Conversations</h3>
                <div className="aic-search"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search conversations" /></div>
              </div>
              {(Object.keys(GROUP_LABELS) as Array<keyof typeof GROUP_LABELS>).map((key) => (
                grouped[key].length > 0 && (
                  <div key={key} className="aic-group">
                    <span>{GROUP_LABELS[key]} ({grouped[key].length})</span>
                    {grouped[key].map((item) => (
                      <div key={item.id} className={`aic-thread ${workspace.conversation?.id === item.id ? 'active' : ''}`}>
                        <button type="button" onClick={() => void workspace.openConversation(item.id)}>
                          <strong>{item.title}</strong>
                          <small>{new Date(item.lastMessageAt).toLocaleString()}</small>
                        </button>
                        <button type="button" className="aic-icon" aria-label="Archive conversation" onClick={() => void workspace.archive(item.id)}><Archive size={13} /></button>
                        <button type="button" className="aic-icon" aria-label="Delete conversation" onClick={() => void workspace.removeConversation(item.id)}><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                )
              ))}
              {workspace.conversations.length === 0 && <p className="aic-muted">No conversations yet.</p>}
            </section>
            <section className="aic-side-block">
              <h3>Saved commands</h3>
              {workspace.saved.length === 0 && <p className="aic-muted">Star a command to save it here.</p>}
              {workspace.saved.map((item) => (
                <div key={item.id} className="aic-saved">
                  <button type="button" onClick={() => void workspace.runSaved(item.id)}><Star size={13} /> {item.name}<small>{item.useCount} uses</small></button>
                  <button type="button" className="aic-icon" aria-label="Delete saved command" onClick={() => void workspace.removeSaved(item.id)}><X size={13} /></button>
                </div>
              ))}
            </section>
            <section className="aic-side-block stats">
              <h3>Stats</h3>
              <div><span>Commands</span><strong>{workspace.usage?.commandsUsed ?? 0}</strong></div>
              <div><span>Actions</span><strong>{workspace.usage?.actionsExecuted ?? 0}</strong></div>
            </section>
          </aside>
        )}
      </div>
    </div>
  )
}

function EmptyState({ plan, onPrompt, onUpgrade }: { plan: AiCommandPlan; onPrompt: (value: string) => void; onUpgrade: () => void }) {
  return (
    <div className="aic-welcome">
      <span className="aic-orb"><Bot size={28} /></span>
      <h2>Welcome to AI Command</h2>
      <p>Your intelligent store command center. Ask anything about your store or tell me what to do.</p>
      <p className="aic-grounded"><ShieldCheck size={14} /> Powered by real store data — every answer is grounded in your actual Shopify data.</p>
      {plan === 'commander'
        ? <span className="aic-plan-badge commander">You have full action access.</span>
        : <span className="aic-plan-badge">{planLabel(plan)} — upgrade for actions.</span>}
      {plan !== 'commander' && <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />}
      <div className="aic-try">
        <span>Try asking</span>
        {['What\'s my revenue this month?', 'Which products are low stock?', 'Show me inactive customers', 'Help me increase sales'].map((prompt) => (
          <button type="button" key={prompt} onClick={() => onPrompt(prompt)}>{prompt}</button>
        ))}
      </div>
    </div>
  )
}

function MessageBubble({ message, now, busy, onApprove, onCancel, onUndo, onUpgrade, plan, onSave }: {
  message: AiCommandMessage
  now: number
  busy: boolean
  onApprove: (id: string) => void
  onCancel: (id: string) => void
  onUndo: (id: string) => void
  onUpgrade: () => void
  plan: AiCommandPlan
  onSave: (text: string) => void
}) {
  const mine = message.role === 'user'
  const undoLeft = remainingUndoSeconds(message.action?.rollbackDeadline, now)
  return (
    <article className={`aic-bubble ${mine ? 'mine' : 'theirs'} ${message.contentType}`}>
      <div className="aic-bubble-meta">
        {mine ? <span className="aic-avatar user">You</span> : <span className="aic-avatar ai"><Sparkles size={12} /></span>}
        <time>{formatTimestamp(message.timestamp)}</time>
      </div>
      <div className="aic-bubble-body">
        {message.thinkingSteps && message.thinkingSteps.length > 0 && (
          <details className="aic-steps">
            <summary>How this was prepared</summary>
            <ol>{message.thinkingSteps.map((step) => <li key={step}>{step}</li>)}</ol>
          </details>
        )}
        <p>{message.content}</p>
        {message.structuredData && <StructuredBlock data={message.structuredData} />}
        {message.contentType === 'action_preview' && message.action?.id && (
          <div className="aic-preview-actions">
            <button type="button" className="aic-button approve" disabled={busy} onClick={() => onApprove(message.action!.id!)}><Check size={14} /> Approve</button>
            <button type="button" className="aic-button secondary" disabled={busy}><Pencil size={14} /> Edit</button>
            <button type="button" className="aic-button ghost" disabled={busy} onClick={() => onCancel(message.action!.id!)}><X size={14} /> Cancel</button>
          </div>
        )}
        {message.contentType === 'action_result' && message.action?.rollbackAvailable && undoLeft > 0 && (
          <button type="button" className="aic-button secondary" onClick={() => onUndo(message.action!.id!)}><Undo2 size={14} /> Undo ({undoLeft}s remaining)</button>
        )}
        {message.contentType === 'upgrade' && <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />}
        {!mine && message.contentType === 'text' && (
          <button type="button" className="aic-star" onClick={() => onSave(message.content)} aria-label="Save this command"><Star size={13} /></button>
        )}
      </div>
    </article>
  )
}

function StructuredBlock({ data }: { data: NonNullable<AiCommandMessage['structuredData']> }) {
  const rows = tableRows(data.data)
  if (rows.length === 0) return data.source ? <small className="aic-source">Source: {data.source}</small> : null
  const columns = Object.keys(rows[0] ?? {}).slice(0, 6)
  return (
    <div className="aic-table-wrap">
      <table className="aic-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, 12).map((row, index) => (
            <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column}>{cellText(row[column])}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {data.source && <small className="aic-source">Source: {data.source}</small>}
    </div>
  )
}

function ThinkingCard({ steps, streaming }: { steps: readonly string[]; streaming: string }) {
  return (
    <article className="aic-thinking" aria-live="polite">
      <div className="aic-thinking-head"><LoaderCircle className="spin" size={15} /> AI Command is thinking…</div>
      <ol>
        {(steps.length ? steps : ['Understanding your request...']).map((step) => <li key={step}>{step}</li>)}
      </ol>
      {streaming && <p className="aic-stream">{streaming}</p>}
    </article>
  )
}

function UsageCard({ usage, plan, onUpgrade }: { usage: import('./ai-command-model.js').AiCommandUsage | null; plan: AiCommandPlan; onUpgrade: () => void }) {
  const tone = usageTone(usage)
  return (
    <section className={`aic-usage ${tone}`}>
      <div className="aic-usage-top"><span>Usage</span><strong>{usageLabel(usage, plan)}</strong></div>
      <div className="aic-usage-track" role="img" aria-label={usageLabel(usage, plan)}><i style={{ width: `${usagePercent(usage)}%` }} /></div>
      {tone === 'red' && <div className="aic-usage-cta">You&apos;ve reached today&apos;s limit. <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} /></div>}
    </section>
  )
}

function fallbackQuick(plan: AiCommandPlan): readonly import('./ai-command-model.js').AiCommandQuickCommand[] {
  const info = [
    { id: 'revenue', label: 'Revenue', command: 'Show today\'s revenue', kind: 'info' as const },
    { id: 'customers', label: 'Customers', command: 'Show my top customers', kind: 'info' as const },
    { id: 'stock', label: 'Low stock', command: 'Which products are low stock?', kind: 'info' as const },
    { id: 'orders', label: 'Orders', command: 'Show recent orders', kind: 'info' as const },
    { id: 'reports', label: 'Reports', command: 'Summarize this week\'s store performance', kind: 'info' as const },
    { id: 'grow', label: 'Help me grow', command: 'Help me increase sales', kind: 'info' as const },
  ]
  if (plan !== 'commander') return info
  return [...info, { id: 'email', label: 'Create email', command: 'Draft an email to VIP customers', kind: 'action' }]
}

export function resolveAiCommandPlan(raw: string | null | undefined): AiCommandPlan {
  const value = raw?.toLowerCase()
  if (value === 'commander' || value === 'growth' || value === 'start') return value
  return 'trial'
}
