import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import {
  AlertCircle,
  Archive,
  ArrowUpRight,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  Command,
  Copy,
  History,
  LoaderCircle,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TrendingUp,
  Undo2,
  Users,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import { useAiCommandWorkspace } from './ai-command-hooks.js'
import {
  GROUP_LABELS,
  cellText,
  formatTimestamp,
  groupConversations,
  hoursUntilDailyReset,
  planLabel,
  quickCommandCategory,
  remainingUndoSeconds,
  searchConversations,
  tableRows,
  usageLabel,
  usagePercent,
  usageTone,
} from './ai-command-model.js'
import type { AiCommandMessage, AiCommandPlan, AiCommandQuickCategory } from './ai-command-model.js'
import type { WorkspaceContext } from './model.js'

type ToastFn = (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void

const PLACEHOLDER_EXAMPLES = [
  'Ask anything about your store, or tell me what to do…',
  'Try “What’s my revenue this month?”',
  'Try “Which products are low stock?”',
  'Try “Show me my top customers.”',
  'Try “How can I increase sales?”',
] as const

const QUICK_CATEGORIES: readonly Readonly<{ id: AiCommandQuickCategory; label: string; icon: LucideIcon }>[] = [
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'actions', label: 'Actions', icon: Zap },
]

const CAPABILITIES = [
  { icon: BarChart3, title: 'Store Analytics', prompt: 'What’s my revenue this month?' },
  { icon: Users, title: 'Customer Insights', prompt: 'Who are my best customers?' },
  { icon: Package, title: 'Inventory Management', prompt: 'Which products are low stock?' },
  { icon: TrendingUp, title: 'Business Recommendations', prompt: 'How can I increase sales?' },
] as const

const POPULAR_QUESTIONS = [
  { icon: BarChart3, label: 'Today’s revenue', prompt: 'What’s my revenue today?' },
  { icon: Users, label: 'Top customers', prompt: 'Show my top customers' },
  { icon: Package, label: 'Low stock', prompt: 'Which products are low stock?' },
  { icon: TrendingUp, label: 'Growth ideas', prompt: 'Help me increase sales' },
] as const

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
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (initialConversationId) void workspace.openConversation(initialConversationId)
  }, [initialConversationId])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setPlaceholderIndex((index) => (index + 1) % PLACEHOLDER_EXAMPLES.length), 5000)
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

  const sendText = (text: string) => void workspace.send(text)

  const grouped = groupConversations(searchConversations(workspace.conversations, search))
  const messages = workspace.conversation?.messages ?? []
  const commands = workspace.quick.length ? workspace.quick : fallbackQuick(plan)

  return (
    <div className="aic-shell">
      <header className="aic-header">
        <div className="aic-title">
          <span className="aic-orb compact"><Sparkles size={18} /></span>
          <div>
            <h2>AI Command</h2>
            <p>One command controls everything</p>
          </div>
        </div>
        <div className="aic-header-actions">
          <span className={`aic-status ${workspace.busy ? 'busy' : 'live'}`} aria-live="polite">
            <i />{workspace.busy ? 'Thinking…' : 'Live'}
          </span>
          <button type="button" className="aic-button secondary" onClick={workspace.newChat}><Plus size={15} /> New Chat</button>
          <button type="button" className="aic-button ghost" onClick={() => setHistoryOpen((value) => !value)} aria-expanded={historyOpen}><History size={15} /> History</button>
          <button type="button" className="aic-button ghost icon-only" onClick={() => setSettingsOpen((value) => !value)} aria-label="AI Command settings" aria-expanded={settingsOpen}><Settings size={15} /></button>
        </div>
      </header>

      <PlanStatusBar plan={plan} usage={workspace.usage} onUpgrade={onNavigateBilling} />

      <div className={`aic-layout ${historyOpen || settingsOpen ? 'with-side' : ''}`}>
        <section className="aic-main" aria-label="AI Command conversation">
          {workspace.error && workspace.limitReached && (
            <div className="aic-banner limit" role="alert">
              <AlertCircle size={16} />
              <div className="aic-limit-copy">
                <strong>You&apos;ve used all {workspace.usage?.limit ?? 10} commands for today.</strong>
                <span>Come back tomorrow for {workspace.usage?.limit ?? 10} more (free) — resets in {hoursUntilDailyReset()} hour{hoursUntilDailyReset() === 1 ? '' : 's'}. Or upgrade for unlimited commands.</span>
              </div>
              <UpgradePlanButton plan={plan} onUpgrade={onNavigateBilling} />
            </div>
          )}
          {workspace.error && !workspace.limitReached && (
            <div className="aic-banner error" role="alert">
              <AlertCircle size={16} />
              <span>{workspace.error}</span>
            </div>
          )}

          <div className="aic-scroll" ref={scrollRef}>
            {messages.length === 0 && !workspace.busy && (
              <WelcomeScreen plan={plan} usage={workspace.usage} onPrompt={sendText} onUpgrade={onNavigateBilling} />
            )}
            {messages.map((item, index) => (
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
                onRegenerate={() => {
                  const previous = previousUserMessage(messages, index)
                  if (previous) void workspace.send(previous)
                }}
                onPrompt={sendText}
                onToast={onToast}
              />
            ))}
            {workspace.busy && <ThinkingCard steps={workspace.thinking} streaming={workspace.streaming} />}
          </div>

          <form className="aic-composer" onSubmit={submit}>
            <div className="aic-composer-label">
              <Command size={13} /> Type your command
              <span className="aic-counter">{draft.length}/2000</span>
            </div>
            <div className="aic-composer-row">
              <textarea
                id="aic-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
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
            <div className="aic-composer-hints">
              <span>Enter to send · Shift+Enter for a new line</span>
              <span>{usageLabel(workspace.usage, plan)}</span>
            </div>
            <QuickCommands commands={commands} disabled={workspace.busy} onSend={sendText} />
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
            <ActivityCard usage={workspace.usage} conversations={workspace.conversations.length} saved={workspace.saved.length} />
          </aside>
        )}
      </div>
    </div>
  )
}

function PlanStatusBar({ plan, usage, onUpgrade }: { plan: AiCommandPlan; usage: import('./ai-command-model.js').AiCommandUsage | null; onUpgrade: () => void }) {
  const commander = plan === 'commander'
  const tone = usageTone(usage)
  return (
    <div className={`aic-planbar ${tone}`}>
      <div className="aic-planbar-left">
        <span className="aic-planbar-plan">{planLabel(plan)}</span>
        <span className="aic-planbar-usage">Commands: {usageLabel(usage, plan)}</span>
        <span className={`aic-planbar-actions ${commander ? 'unlocked' : 'locked'}`}>
          {commander ? <CheckCircle2 size={13} /> : <ShieldCheck size={13} />}
          {commander ? 'Actions enabled' : 'Actions locked'}
        </span>
      </div>
      {!commander && <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />}
    </div>
  )
}

function WelcomeScreen({ plan, usage, onPrompt, onUpgrade }: {
  plan: AiCommandPlan
  usage: import('./ai-command-model.js').AiCommandUsage | null
  onPrompt: (value: string) => void
  onUpgrade: () => void
}) {
  const commander = plan === 'commander'
  return (
    <div className="aic-welcome">
      <span className="aic-welcome-icon"><Sparkles size={30} /></span>
      <h2>Welcome to AI Command</h2>
      <p className="aic-welcome-sub">Your intelligent store assistant</p>
      <p className="aic-welcome-lede">Ask anything about your store. Get instant insights backed by your real data.</p>

      <div className="aic-capabilities">
        <div className="aic-capabilities-head">
          <Sparkles size={14} /> What I can help you with
        </div>
        <div className="aic-capabilities-grid">
          {CAPABILITIES.map((capability) => (
            <button type="button" key={capability.title} className="aic-capability" onClick={() => onPrompt(capability.prompt)}>
              <span className="aic-capability-icon"><capability.icon size={16} /></span>
              <span className="aic-capability-copy">
                <strong>{capability.title}</strong>
                <small>{capability.prompt}</small>
              </span>
              <ArrowUpRight size={14} className="aic-capability-arrow" />
            </button>
          ))}
          <div className={`aic-capability ${commander ? 'enabled' : 'locked'}`}>
            <span className="aic-capability-icon"><Zap size={16} /></span>
            <span className="aic-capability-copy">
              <strong>Store Actions</strong>
              <small>{commander ? 'Execute real actions in your store' : 'Available on Commander Plan'}</small>
            </span>
            {!commander && <span className="aic-capability-lock"><ShieldCheck size={14} /> Locked</span>}
          </div>
        </div>
      </div>

      <div className="aic-popular">
        <span className="aic-popular-label">Or try these popular questions</span>
        <div className="aic-popular-chips">
          {POPULAR_QUESTIONS.map((question) => (
            <button type="button" key={question.label} onClick={() => onPrompt(question.prompt)}>
              <question.icon size={14} /> {question.label}
            </button>
          ))}
        </div>
      </div>

      <div className="aic-welcome-plan">
        <div className="aic-welcome-plan-copy">
          <span className="aic-plan-badge">{planLabel(plan)}</span>
          <span className="aic-welcome-plan-usage">Commands used today: {usageLabel(usage, plan)}</span>
          <span className="aic-welcome-plan-actions">{commander ? 'Full action execution enabled' : 'Actions require Commander Plan'}</span>
        </div>
        {!commander && <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />}
      </div>
    </div>
  )
}

function MessageBubble({ message, now, busy, onApprove, onCancel, onUndo, onUpgrade, plan, onSave, onRegenerate, onPrompt, onToast }: {
  message: AiCommandMessage
  now: number
  busy: boolean
  onApprove: (id: string) => void
  onCancel: (id: string) => void
  onUndo: (id: string) => void
  onUpgrade: () => void
  plan: AiCommandPlan
  onSave: (text: string) => void
  onRegenerate: () => void
  onPrompt: (value: string) => void
  onToast: ToastFn
}) {
  const mine = message.role === 'user'
  const undoLeft = remainingUndoSeconds(message.action?.rollbackDeadline, now)
  const copyable = !mine && message.contentType !== 'action_result'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      onToast('Copied to clipboard.', 'success')
    } catch {
      onToast('Could not copy — your browser blocked clipboard access.', 'warning')
    }
  }

  return (
    <article className={`aic-bubble ${mine ? 'mine' : 'theirs'} ${message.contentType}`}>
      <div className="aic-bubble-meta">
        {mine
          ? <span className="aic-avatar user">You</span>
          : <span className="aic-avatar ai"><Sparkles size={12} /> AI Command</span>}
        <time>{formatTimestamp(message.timestamp)}</time>
      </div>
      <div className="aic-bubble-body">
        {message.thinkingSteps && message.thinkingSteps.length > 0 && (
          <details className="aic-steps">
            <summary>How this was prepared</summary>
            <ol>{message.thinkingSteps.map((step) => <li key={step}>{step}</li>)}</ol>
          </details>
        )}

        {message.contentType === 'offtopic'
          ? <OffTopicBlock content={message.content} onPrompt={onPrompt} />
          : (
            <>
              <p>{message.content}</p>
              {message.structuredData && <StructuredBlock data={message.structuredData} />}
            </>
          )}

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

        {!mine && (
          <div className="aic-bubble-actions">
            {copyable && (
              <button type="button" className="aic-chip-action" onClick={copy} aria-label="Copy response"><Copy size={13} /></button>
            )}
            {message.contentType === 'text' || message.contentType === 'structured_data' ? (
              <button type="button" className="aic-chip-action" onClick={onRegenerate} aria-label="Regenerate response"><RefreshCw size={13} /></button>
            ) : null}
            {copyable && (
              <>
                <button type="button" className="aic-chip-action" onClick={() => onToast('Thanks for the feedback!', 'success')} aria-label="Good response"><ThumbsUp size={13} /></button>
                <button type="button" className="aic-chip-action" onClick={() => onToast('Thanks for the feedback!', 'info')} aria-label="Poor response"><ThumbsDown size={13} /></button>
              </>
            )}
            {message.contentType === 'text' && (
              <button type="button" className="aic-chip-action" onClick={() => onSave(message.content)} aria-label="Save this command"><Star size={13} /></button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function OffTopicBlock({ content, onPrompt }: { content: string; onPrompt: (value: string) => void }) {
  const suggestions = [
    { icon: BarChart3, label: 'Today’s revenue', prompt: 'What’s my revenue today?' },
    { icon: Package, label: 'Recent orders', prompt: 'Show recent orders' },
    { icon: Users, label: 'Store health', prompt: 'How healthy is my store?' },
  ]
  return (
    <div className="aic-offtopic">
      <p>{content}</p>
      <div className="aic-offtopic-suggestions">
        {suggestions.map((suggestion) => (
          <button key={suggestion.label} type="button" className="aic-offtopic-chip" onClick={() => onPrompt(suggestion.prompt)}>
            <suggestion.icon size={13} /> {suggestion.label}
          </button>
        ))}
      </div>
      <p className="aic-offtopic-cta">What would you like to know about your store?</p>
    </div>
  )
}

function StructuredBlock({ data }: { data: NonNullable<AiCommandMessage['structuredData']> }) {
  const record = isRecord(data.data) ? data.data : {}
  if (data.type === 'analytics') return <AnalyticsBlock data={record} source={data.source} />
  if (data.type === 'store_health') return <HealthBlock data={record} source={data.source} />

  const rows = tableRows(data.data)
  if (rows.length === 0) return data.source ? <small className="aic-source">Source: {data.source}</small> : null
  const columns = Object.keys(rows[0] ?? {}).slice(0, 6)
  const label = STRUCTURED_LABELS[data.type] ?? 'Results'
  return (
    <div className="aic-data-card">
      <div className="aic-data-card-head">
        <span>{label}</span>
        <strong>{rows.length}</strong>
      </div>
      <div className="aic-table-wrap">
        <table className="aic-table">
          <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, 12).map((row, index) => (
              <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column}>{cellText(row[column])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.source && <small className="aic-source">Source: {data.source}</small>}
    </div>
  )
}

const STRUCTURED_LABELS: Readonly<Record<string, string>> = {
  analytics: 'Store analytics',
  customer_list: 'Customers',
  product_list: 'Products',
  order_list: 'Orders',
  inventory_list: 'Inventory',
  recommendation_list: 'Recommendations',
  store_health: 'Store health',
  action_preview: 'Action preview',
  action_result: 'Action result',
}

function AnalyticsBlock({ data, source }: { data: Record<string, unknown>; source: string | undefined }) {
  const revenue = asNumber(data.revenue)
  const previous = asNumber(data.previousRevenue)
  const orders = asNumber(data.orders)
  const aov = asNumber(data.aov)
  const change = revenue !== null && previous !== null && previous !== 0 ? Math.round(((revenue - previous) / previous) * 100) : null
  return (
    <div className="aic-metrics">
      <div className="aic-metric primary">
        <span className="aic-metric-label">Revenue this period</span>
        <strong>{revenue !== null ? formatMoney(revenue) : '—'}</strong>
        {change !== null && (
          <small className={change >= 0 ? 'up' : 'down'}>{change >= 0 ? '↑' : '↓'} {Math.abs(change)}% vs prior period</small>
        )}
      </div>
      {orders !== null && (
        <div className="aic-metric">
          <span className="aic-metric-label">Orders</span>
          <strong>{formatNumber(orders)}</strong>
        </div>
      )}
      {aov !== null && (
        <div className="aic-metric">
          <span className="aic-metric-label">Avg. order value</span>
          <strong>{formatMoney(aov)}</strong>
        </div>
      )}
      {source && <small className="aic-source">Source: {source}</small>}
    </div>
  )
}

function HealthBlock({ data, source }: { data: Record<string, unknown>; source: string | undefined }) {
  const score = asNumber(data.score)
  const label = typeof data.label === 'string' ? data.label : '—'
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score))
  return (
    <div className="aic-health">
      <div className="aic-health-ring" style={{ '--score': `${pct * 3.6}deg` } as CSSProperties}>
        <div className="aic-health-ring-inner">
          <strong>{score ?? '—'}</strong>
          <small>/100</small>
        </div>
      </div>
      <div className="aic-health-copy">
        <strong>{label}</strong>
        <small>Computed from live analytics and inventory.</small>
        {source && <small className="aic-source">Source: {source}</small>}
      </div>
    </div>
  )
}

function ThinkingCard({ steps, streaming }: { steps: readonly string[]; streaming: string }) {
  return (
    <article className="aic-thinking" aria-live="polite">
      <div className="aic-thinking-head">
        <span className="aic-thinking-dots"><i /><i /><i /></span>
        AI Command is thinking…
      </div>
      <ol>
        {(steps.length ? steps : ['Understanding your request...']).map((step) => <li key={step}>{step}</li>)}
      </ol>
      {streaming && <p className="aic-stream">{streaming}</p>}
    </article>
  )
}

function QuickCommands({ commands, disabled, onSend }: {
  commands: readonly import('./ai-command-model.js').AiCommandQuickCommand[]
  disabled: boolean
  onSend: (value: string) => void
}) {
  const groups = useMemo(() => {
    const map: Record<AiCommandQuickCategory, import('./ai-command-model.js').AiCommandQuickCommand[]> = { analytics: [], customers: [], products: [], growth: [], actions: [] }
    for (const command of commands) map[quickCommandCategory(command)].push(command)
    return map
  }, [commands])
  const categories = QUICK_CATEGORIES.filter((category) => groups[category.id].length > 0)
  const [active, setActive] = useState<AiCommandQuickCategory | null>(null)
  const current = active && groups[active]?.length ? active : categories[0]?.id ?? null
  if (!current) return null
  return (
    <div className="aic-quick" aria-label="Quick commands">
      <div className="aic-quick-tabs" role="tablist">
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            role="tab"
            aria-selected={category.id === current}
            className={category.id === current ? 'active' : ''}
            onClick={() => setActive(category.id)}
          >
            <category.icon size={13} /> {category.label}
          </button>
        ))}
      </div>
      <div className="aic-quick-pills">
        {groups[current].map((command) => (
          <button key={command.id} type="button" onClick={() => onSend(command.command)} disabled={disabled}>
            {command.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function UsageCard({ usage, plan, onUpgrade }: { usage: import('./ai-command-model.js').AiCommandUsage | null; plan: AiCommandPlan; onUpgrade: () => void }) {
  const tone = usageTone(usage)
  return (
    <section className={`aic-usage ${tone}`}>
      <div className="aic-usage-top"><span>Usage</span><strong>{usageLabel(usage, plan)}</strong></div>
      <div className="aic-usage-track" role="img" aria-label={usageLabel(usage, plan)}><i style={{ width: `${usagePercent(usage)}%` }} /></div>
      {tone === 'red' && (
        <div className="aic-usage-cta">
          <span>You&apos;ve used all {usage?.limit ?? ''} commands for today — nice work! You get {usage?.limit ?? ''} more free tomorrow (resets in {hoursUntilDailyReset()} hour{hoursUntilDailyReset() === 1 ? '' : 's'}).</span>
          <span>Or <strong>Upgrade Plan</strong> for unlimited commands.</span>
          <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
        </div>
      )}
      {tone === 'amber' && <div className="aic-usage-cta">Almost at your daily limit. <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} /></div>}
    </section>
  )
}

function ActivityCard({ usage, conversations, saved }: { usage: import('./ai-command-model.js').AiCommandUsage | null; conversations: number; saved: number }) {
  const stats = [
    { label: 'Commands today', value: String(usage?.commandsUsed ?? 0) },
    { label: 'Actions executed', value: String(usage?.actionsExecuted ?? 0) },
    { label: 'Conversations', value: String(conversations) },
    { label: 'Saved commands', value: String(saved) },
  ]
  return (
    <section className="aic-side-block stats">
      <h3>Your activity</h3>
      {stats.map((stat) => (
        <div key={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong></div>
      ))}
      <p className="aic-stats-note">Every figure reflects your real AI Command usage — nothing is estimated.</p>
    </section>
  )
}

function previousUserMessage(messages: readonly AiCommandMessage[], index: number): string | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === 'user') return messages[cursor]!.content
  }
  return null
}

function fallbackQuick(plan: AiCommandPlan): readonly import('./ai-command-model.js').AiCommandQuickCommand[] {
  const info = [
    { id: 'revenue', label: 'Today’s revenue', command: 'Show today’s revenue', kind: 'info' as const },
    { id: 'customers', label: 'Top customers', command: 'Show my top customers', kind: 'info' as const },
    { id: 'stock', label: 'Low stock', command: 'Which products are low stock?', kind: 'info' as const },
    { id: 'orders', label: 'Recent orders', command: 'Show recent orders', kind: 'info' as const },
    { id: 'reports', label: 'Weekly report', command: 'Summarize this week’s store performance', kind: 'info' as const },
    { id: 'grow', label: 'Help me grow', command: 'Help me increase sales', kind: 'info' as const },
    { id: 'health', label: 'Store health', command: 'How healthy is my store?', kind: 'info' as const },
  ]
  if (plan !== 'commander') return info
  return [...info, { id: 'email', label: 'Create email', command: 'Draft an email to VIP customers', kind: 'action' }]
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}
function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveAiCommandPlan(raw: string | null | undefined): AiCommandPlan {
  const value = raw?.toLowerCase()
  if (value === 'commander' || value === 'growth' || value === 'start') return value
  return 'trial'
}
