import { Button } from './polaris-ui.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import {
  AlertCircle,
  Archive,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Command,
  Copy,
  Download,
  History,
  LoaderCircle,
  Lock,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShoppingCart,
  Settings,
  Share2,
  ShieldCheck,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TrendingUp,
  Undo2,
  Users,
  X,
  Zap,
} from './icons.js'
import type { LucideIcon } from './icons.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import { AiCommandMark } from './ai-command-logo.js'
import { useAiCommandWorkspace } from './ai-command-hooks.js'
import {
  CATEGORY_TONE,
  GROUP_LABELS,
  cellText,
  conversationPreview,
  dailyResetCountdown,
  formatTimestamp,
  groupConversations,
  hoursUntilDailyReset,
  lastUserQuestion,
  planLabel,
  quickCommandCategory,
  quickCommandTone,
  remainingUndoSeconds,
  searchConversations,
  tableRows,
  usageHistoryBars,
  usageLabel,
  usagePercent,
  usageTone,
  valueStats,
} from './ai-command-model.js'
import type { AiCommandMessage, AiCommandPlan, AiCommandQuickCategory, AiCommandTone, AiCommandUsage } from './ai-command-model.js'
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

const CAPABILITIES: readonly Readonly<{ icon: LucideIcon; tone: AiCommandTone; title: string; sample: string }>[] = [
  { icon: BarChart3, tone: 'purple', title: 'Store Analytics', sample: 'What’s my revenue this month?' },
  { icon: Users, tone: 'blue', title: 'Customer Insights', sample: 'Who are my best customers?' },
  { icon: Package, tone: 'green', title: 'Inventory Management', sample: 'Which products are low stock?' },
  { icon: TrendingUp, tone: 'orange', title: 'Business Recommendations', sample: 'How can I increase sales?' },
]

const POPULAR_QUESTIONS: readonly Readonly<{ icon: LucideIcon; tone: AiCommandTone; label: string; prompt: string }>[] = [
  { icon: BarChart3, tone: 'purple', label: 'Today’s revenue', prompt: 'What’s my revenue today?' },
  { icon: Users, tone: 'blue', label: 'Top customers', prompt: 'Show my top customers' },
  { icon: Package, tone: 'green', label: 'Low stock', prompt: 'Which products are low stock?' },
  { icon: TrendingUp, tone: 'orange', label: 'Growth ideas', prompt: 'Help me increase sales' },
]

const TEMPLATES: readonly Readonly<{ icon: LucideIcon; tone: AiCommandTone; title: string; command: string }>[] = [
  { icon: BarChart3, tone: 'purple', title: 'Analyze weekend sales', command: 'Compare weekend vs weekday sales this week' },
  { icon: Users, tone: 'blue', title: 'Find at-risk customers', command: 'Show inactive customers' },
  { icon: Package, tone: 'green', title: 'Check inventory alerts', command: 'Which products are low stock?' },
  { icon: TrendingUp, tone: 'orange', title: 'Show growth opportunities', command: 'Help me increase sales' },
  { icon: BarChart3, tone: 'purple', title: 'Today’s revenue', command: 'What’s my revenue today?' },
  { icon: Zap, tone: 'amber', title: 'Recent orders', command: 'Show recent orders' },
  { icon: ShieldCheck, tone: 'green', title: 'Store health check', command: 'How healthy is my store?' },
  { icon: RefreshCw, tone: 'blue', title: 'Automation status', command: 'Show automation status' },
]

const FOLLOW_UP_ACTIONS: readonly Readonly<{ icon: LucideIcon; tone: AiCommandTone; label: string; prompt: string }>[] = [
  { icon: Users, tone: 'blue', label: 'Ask about customers', prompt: 'Who are my best customers?' },
  { icon: Package, tone: 'green', label: 'Check inventory', prompt: 'Which products are low stock?' },
  { icon: BarChart3, tone: 'purple', label: 'Revenue analysis', prompt: 'How is my revenue trending this month?' },
  { icon: TrendingUp, tone: 'orange', label: 'Growth ideas', prompt: 'Help me increase sales' },
]

const SHOWCASES: readonly Readonly<{ icon: LucideIcon; tone: AiCommandTone; title: string; description: string; sample: string }>[] = [
  { icon: BarChart3, tone: 'purple', title: 'Live analytics', description: 'Ask for revenue, orders, or average order value and get today’s real numbers — with a comparison to the prior period.', sample: 'What’s my revenue today?' },
  { icon: Users, tone: 'blue', title: 'Customer intelligence', description: 'Spot your best customers or at-risk segments straight from your synced Shopify customer table.', sample: 'Who are my best customers?' },
  { icon: Package, tone: 'green', title: 'Inventory control', description: 'Low stock, out of stock, and stockout risk — answered from live inventory levels, not guesses.', sample: 'Which products are low stock?' },
  { icon: Zap, tone: 'amber', title: 'Store actions', description: 'On Commander, preview and approve real actions: emails, tags, discounts, and automations. Nothing runs without your approval.', sample: 'Show automation status' },
  { icon: TrendingUp, tone: 'orange', title: 'Growth guidance', description: 'Combine analytics, recommendations, and store health into a single grounded answer about growing sales.', sample: 'Help me increase sales' },
]

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
  const draftRef = useRef<HTMLTextAreaElement | null>(null)

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
        <span className="aic-empty-orb"><AiCommandMark size={34} variant="badge" /></span>
        <h2>Connect Shopify to open AI Command</h2>
        <p>AI Command answers only from your live store data. Connect a store first — nothing here is ever invented.</p>
        <div className="aic-empty-steps">
          <span><CheckCircle2 size={14} /> Install ProfitPilot on your Shopify store</span>
          <span><CheckCircle2 size={14} /> Approve the data sync (orders, products, customers, inventory)</span>
          <span><CheckCircle2 size={14} /> Ask your first command — answers come from synced rows</span>
        </div>
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

  const sendText = (text: string) => {
    void workspace.send(text)
    setHistoryOpen(false)
    setSettingsOpen(false)
  }

  const grouped = groupConversations(searchConversations(workspace.conversations, search))
  const messages = workspace.conversation?.messages ?? []
  const actionsAvailable = plan === 'commander' && (workspace.usage?.actionsEnabled ?? true)
  const commands = workspace.quick.length ? workspace.quick : fallbackQuick(actionsAvailable ? 'commander' : plan === 'commander' ? 'growth' : plan)

  return (
    <div className="aic-shell">
      <header className="aic-header">
        <div className="aic-title">
          <span className="aic-orb"><AiCommandMark size={26} variant="badge" /></span>
          <div>
            <div className="aic-eyebrow">Universal command center</div>
            <h2>AI Command</h2>
            <p>One command controls everything</p>
          </div>
        </div>
        <div className="aic-header-actions">
          <span className={`aic-status ${workspace.busy ? 'busy' : 'live'}`} aria-live="polite">
            <i />{workspace.busy ? 'Thinking…' : 'Live'}
          </span>
          <Button type="button" className="aic-button secondary" onClick={workspace.newChat}><Plus size={15} /> New Chat</Button>
          <Button type="button" className="aic-button ghost" onClick={() => { setHistoryOpen((value) => !value); setSettingsOpen(false) }} aria-expanded={historyOpen}><History size={15} /> History</Button>
          <Button type="button" className="aic-button ghost icon-only" onClick={() => { setSettingsOpen((value) => !value); setHistoryOpen(false) }} aria-label="AI Command settings" aria-expanded={settingsOpen}><Settings size={15} /></Button>
        </div>
      </header>

      <PlanStatusBar plan={plan} usage={workspace.usage} now={now} actionsEnabled={actionsAvailable} onUpgrade={onNavigateBilling} />

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

      <div className="aic-layout">
        <section className="aic-main" aria-label="AI Command conversation">
          <div className="aic-scroll" ref={scrollRef}>
            {messages.length === 0 && !workspace.busy && (
              <WelcomeScreen plan={plan} usage={workspace.usage} now={now} actionsEnabled={actionsAvailable} onPrompt={sendText} onUpgrade={onNavigateBilling} />
            )}
            {messages.map((item, index) => (
              <MessageBubble
                key={item.id}
                message={item}
                now={now}
                busy={workspace.busy}
                onApprove={(id) => void workspace.approve(id)}
                onCancel={(id) => void workspace.cancel(id)}
                onEdit={(id) => {
                  const previous = previousUserMessage(messages, index)
                  void workspace.cancel(id).then(() => {
                    if (previous) setDraft(previous)
                    window.setTimeout(() => draftRef.current?.focus(), 0)
                  })
                }}
                onUndo={(id) => void workspace.undo(id)}
                onUpgrade={onNavigateBilling}
                plan={plan}
                onSave={() => {
                  const previous = previousUserMessage(messages, index)
                  if (previous) void workspace.saveCurrent(previous.slice(0, 40), previous)
                }}
                onRegenerate={() => {
                  const previous = previousUserMessage(messages, index)
                  if (previous) void workspace.send(previous)
                }}
                onFeedback={(rating) => void workspace.rateMessage(item.id, rating)}
                onPrompt={sendText}
                onToast={onToast}
              />
            ))}
            {workspace.busy && workspace.preferences?.thinkingAnimationEnabled !== false && <ThinkingCard steps={workspace.thinking} streaming={workspace.streaming} onCancel={workspace.cancelThinking} />}
            {messages.length > 0 && (
              <PostChatActivity
                usageHistory={workspace.usageHistory}
                now={now}
                lastCommand={lastUserContent(messages)}
                insights={workspace.quickInsights}
                followUps={workspace.followUps}
                disabled={workspace.busy || workspace.limitReached}
                onPrompt={sendText}
              />
            )}
          </div>

          <form className="aic-composer" onSubmit={submit}>
            <div className="aic-composer-label">
              <Command size={13} /> Type your command
              <span className="aic-counter">{draft.length}/2000</span>
            </div>
            <div className="aic-composer-row">
              <textarea
                id="aic-input"
                ref={draftRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={PLACEHOLDER_EXAMPLES[placeholderIndex]}
                maxLength={2000}
                rows={2}
                disabled={workspace.busy || workspace.limitReached}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
                }}
              />
              <div className="aic-composer-side">
                <Button type="submit" className="aic-send" disabled={workspace.busy || !draft.trim()} aria-label="Send command">
                  {workspace.busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
                </Button>
              </div>
            </div>
            {workspace.preferences?.autoSuggestionsEnabled !== false && <Suggestions draft={draft} onPick={(value) => { setDraft(value); draftRef.current?.focus() }} />}
            <div className="aic-composer-hints">
              <span><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line</span>
              <span>{usageLabel(workspace.usage, plan)}</span>
            </div>
            {workspace.preferences?.quickCommandsEnabled !== false && <QuickCommands commands={commands} disabled={workspace.busy || workspace.limitReached} onSend={sendText} />}
          </form>
        </section>

        <aside className="aic-rail" aria-label="AI Command dashboard">
          <UsageRingCard usage={workspace.usage} plan={plan} now={now} onUpgrade={onNavigateBilling} />
          <RecentCommandsCard conversations={workspace.conversations} onOpen={(id) => void workspace.openConversation(id)} onNewChat={workspace.newChat} />
          <ValueCard usage={workspace.usage} usageHistory={workspace.usageHistory} conversations={workspace.conversations.length} saved={workspace.saved.length} now={now} />
          <ShowcaseCard onPrompt={sendText} />
        </aside>
      </div>

      {(historyOpen || settingsOpen) && (
        <div className="aic-drawer-wrap">
          <Button type="button" className="aic-drawer-backdrop" onClick={() => { setHistoryOpen(false); setSettingsOpen(false) }} aria-label="Close panel" />
          <aside className="aic-drawer" aria-label={settingsOpen ? 'AI Command settings' : 'AI Command history'}>
            <div className="aic-drawer-head">
              <h3>{settingsOpen ? 'Settings' : 'Conversations'}</h3>
              <Button type="button" className="aic-icon" aria-label="Close panel" onClick={() => { setHistoryOpen(false); setSettingsOpen(false) }}><X size={16} /></Button>
            </div>
            <div className="aic-drawer-scroll">
              {settingsOpen && workspace.preferences && (
                <section className="aic-side-block">
                  <h3>Preferences</h3>
                  <label className="aic-setting-field">
                    <span>Response style</span>
                    <select value={workspace.preferences.defaultResponseStyle} onChange={(event) => void workspace.patchPreferences({ defaultResponseStyle: event.target.value as 'CONCISE' | 'DETAILED' | 'TECHNICAL' })}>
                      <option value="CONCISE">Concise</option>
                      <option value="DETAILED">Detailed</option>
                      <option value="TECHNICAL">Technical</option>
                    </select>
                  </label>
                  <label className="aic-toggle">
                    <input type="checkbox" checked={workspace.preferences.thinkingAnimationEnabled} onChange={(event) => void workspace.patchPreferences({ thinkingAnimationEnabled: event.target.checked })} />
                    Thinking animation
                  </label>
                  <label className="aic-toggle">
                    <input type="checkbox" checked={workspace.preferences.quickCommandsEnabled} onChange={(event) => void workspace.patchPreferences({ quickCommandsEnabled: event.target.checked })} />
                    Quick commands
                  </label>
                  <label className="aic-toggle">
                    <input type="checkbox" checked={workspace.preferences.autoSuggestionsEnabled} onChange={(event) => void workspace.patchPreferences({ autoSuggestionsEnabled: event.target.checked })} />
                    Auto-suggestions
                  </label>
                  <label className="aic-toggle">
                    <input type="checkbox" checked={workspace.preferences.conversationMemoryEnabled} onChange={(event) => void workspace.patchPreferences({ conversationMemoryEnabled: event.target.checked })} />
                    Conversation references
                  </label>
                  <label className="aic-toggle">
                    <input type="checkbox" checked={workspace.preferences.notificationOnActionComplete} onChange={(event) => void workspace.patchPreferences({ notificationOnActionComplete: event.target.checked })} />
                    Action completion notifications
                  </label>
                </section>
              )}
              {historyOpen && (
                <section className="aic-side-block">
                  <div className="aic-side-head">
                    <h3>Conversations</h3>
                    <div className="aic-search"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search conversations" /></div>
                  </div>
                  {(Object.keys(GROUP_LABELS) as Array<keyof typeof GROUP_LABELS>).map((key) => (
                    grouped[key].length > 0 && (
                      <div key={key} className="aic-group">
                        <span>{GROUP_LABELS[key]} ({grouped[key].length})</span>
                        {grouped[key].map((item) => {
                          const preview = conversationPreview(item)
                          return (
                            <div key={item.id} className={`aic-thread ${workspace.conversation?.id === item.id ? 'active' : ''}`}>
                              <Button type="button" className="aic-thread-main" onClick={() => void workspace.openConversation(item.id)}>
                                <strong>{item.title}</strong>
                                <small>{preview.question}</small>
                                {preview.answer && <em>{preview.answer}</em>}
                              </Button>
                              <Button type="button" className="aic-icon" aria-label="Save conversation as command" onClick={() => void workspace.saveCurrent(item.title.slice(0, 40), lastUserQuestion(item))}><Star size={13} /></Button>
                              {(plan === 'growth' || plan === 'commander') && <Button type="button" className="aic-icon" aria-label="Export conversation" onClick={() => void workspace.exportConversation(item.id)}><Download size={13} /></Button>}
                              <Button type="button" className="aic-icon" aria-label="Archive conversation" onClick={() => void workspace.archive(item.id)}><Archive size={13} /></Button>
                              <Button type="button" className="aic-icon" aria-label="Delete conversation" onClick={() => void workspace.removeConversation(item.id)}><Trash2 size={13} /></Button>
                            </div>
                          )
                        })}
                      </div>
                    )
                  ))}
                  {workspace.conversations.length === 0 && (
                    <div className="aic-inline-empty">
                      <AiCommandMark size={26} />
                      <strong>No conversations yet</strong>
                      <span>Ask your first question above — every answer is grounded in your real store data.</span>
                    </div>
                  )}
                  {workspace.conversations.length > 0 && (
                    <Button type="button" className="aic-text-button danger" onClick={() => { if (window.confirm('Delete all conversations? This cannot be undone.')) { void clearAllConversations(workspace.conversations, workspace.removeConversation) } }}>
                      <Trash2 size={13} /> Clear all
                    </Button>
                  )}
                </section>
              )}
              <section className="aic-side-block">
                <h3>Saved commands</h3>
                {workspace.saved.length === 0 && <p className="aic-muted">Star a command to save it here.</p>}
                {workspace.saved.map((item) => (
                  <div key={item.id} className="aic-saved">
                    <Button type="button" onClick={() => void workspace.runSaved(item.id)}><Star size={13} /> {item.name}<small>{item.useCount} uses</small></Button>
                    <Button type="button" className="aic-icon" aria-label="Delete saved command" onClick={() => void workspace.removeSaved(item.id)}><X size={13} /></Button>
                  </div>
                ))}
              </section>
              <ActivityCard usage={workspace.usage} conversations={workspace.conversations.length} saved={workspace.saved.length} />
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

async function clearAllConversations(conversations: readonly import('./ai-command-model.js').AiCommandConversation[], remove: (id: string) => Promise<void>): Promise<void> {
  await Promise.allSettled(conversations.map((item) => remove(item.id)))
}

function PlanStatusBar({ plan, usage, now, actionsEnabled, onUpgrade }: { plan: AiCommandPlan; usage: AiCommandUsage | null; now: number; actionsEnabled: boolean; onUpgrade: () => void }) {
  const commander = plan === 'commander'
  const tone = usageTone(usage)
  const countdown = dailyResetCountdown(new Date(now))
  const pct = commander ? 100 : usagePercent(usage)
  return (
    <div className={`aic-planbar ${tone}`}>
      <div className="aic-planbar-left">
        <span className="aic-planbar-plan">{planLabel(plan)}</span>
        <span className="aic-planbar-usage">
          {commander ? <CheckCircle2 size={13} /> : <BarChart3 size={13} />}
          {usageLabel(usage, plan)}
        </span>
        <span className="aic-planbar-reset">
          <Clock3 size={13} />
          {commander ? 'No daily limit' : `Resets in ${countdown.hours}h ${countdown.minutes}m`}
        </span>
        <span className={`aic-planbar-actions ${actionsEnabled ? 'unlocked' : 'locked'}`}>
          {actionsEnabled ? <CheckCircle2 size={13} /> : <ShieldCheck size={13} />}
          {actionsEnabled ? 'Actions enabled' : 'Actions locked'}
        </span>
        <span className="aic-planbar-track" role="img" aria-label={`${pct}% of daily commands used`}><i style={{ width: `${pct}%` }} /></span>
      </div>
      {!commander && <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />}
    </div>
  )
}

function WelcomeScreen({ plan, usage, now, actionsEnabled, onPrompt, onUpgrade }: {
  plan: AiCommandPlan
  usage: AiCommandUsage | null
  now: number
  actionsEnabled: boolean
  onPrompt: (value: string) => void
  onUpgrade: () => void
}) {
  const commander = plan === 'commander'
  const actionMode = commander && actionsEnabled
  const countdown = dailyResetCountdown(new Date(now))
  const approachingLimit = usageTone(usage) === 'amber' || usageTone(usage) === 'red'
  return (
    <div className="aic-welcome">
      <span className="aic-welcome-icon"><AiCommandMark size={40} variant="badge" /></span>
      <h2>Welcome to AI Command</h2>
      <p className="aic-welcome-sub">One command controls everything</p>
      <p className="aic-welcome-lede">Ask anything about your store. Get instant insights backed by your real Shopify data — and on Commander, approve real actions without leaving this page.</p>

      {approachingLimit && !commander && (
        <div className="aic-welcome-limit">
          <AlertCircle size={15} />
          <span><strong>Heads up:</strong> you&apos;re close to today&apos;s command limit ({usageLabel(usage, plan)}). Free commands refresh in {countdown.hours}h {countdown.minutes}m.</span>
          <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
        </div>
      )}

      <div className="aic-capabilities">
        <div className="aic-capabilities-head">
          <AiCommandMark size={14} /> What I can help you with
        </div>
        <div className="aic-capabilities-grid">
          {CAPABILITIES.map((capability) => (
            <Button type="button" key={capability.title} className={`aic-capability tone-${capability.tone}`} onClick={() => onPrompt(capability.sample)}>
              <span className="aic-capability-icon"><capability.icon size={16} /></span>
              <span className="aic-capability-copy">
                <strong>{capability.title}</strong>
                <small><em>“{capability.sample}”</em></small>
              </span>
              <ArrowUpRight size={14} className="aic-capability-arrow" />
            </Button>
          ))}
          <div className={`aic-capability store-actions ${actionMode ? 'enabled' : 'locked'}`}>
            <span className="aic-capability-icon"><Zap size={16} /></span>
            <span className="aic-capability-copy">
              <strong>Store Actions</strong>
              <small>{actionMode ? 'Execute real actions in your store' : commander ? 'Action execution is temporarily unavailable' : 'Email, tags, discounts & automations'}</small>
            </span>
            {actionMode
              ? <span className="aic-capability-lock unlocked"><CheckCircle2 size={14} /> Enabled</span>
              : commander
                ? <span className="aic-capability-lock"><AlertCircle size={14} /> Unavailable</span>
                : (
                  <span className="aic-capability-lock">
                    <Lock size={14} /> Locked
                    <Button type="button" className="aic-mini-upgrade" onClick={onUpgrade}>Upgrade Plan</Button>
                  </span>
                )}
          </div>
        </div>
      </div>

      <div className="aic-popular">
        <span className="aic-popular-label">Or try these popular questions</span>
        <div className="aic-popular-chips">
          {POPULAR_QUESTIONS.map((question) => (
            <Button type="button" key={question.label} className={`tone-${question.tone}`} onClick={() => onPrompt(question.prompt)}>
              <span className="aic-chip-icon"><question.icon size={13} /></span> {question.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="aic-templates">
        <div className="aic-templates-head">
          <span><AiCommandMark size={14} /> Popular command templates</span>
          <small>Click any template to run it with your live store data</small>
        </div>
        <div className="aic-templates-grid">
          {TEMPLATES.map((template) => (
            <Button type="button" key={template.title} className={`aic-template tone-${template.tone}`} onClick={() => onPrompt(template.command)}>
              <span className="aic-template-icon"><template.icon size={15} /></span>
              <span className="aic-template-copy">
                <strong>{template.title}</strong>
                <small>{template.command}</small>
              </span>
              <ChevronRight size={14} className="aic-template-arrow" />
            </Button>
          ))}
        </div>
      </div>

      <div className="aic-welcome-plan">
        <div className="aic-welcome-plan-copy">
          <span className="aic-plan-badge">{planLabel(plan)}</span>
          <span className="aic-welcome-plan-usage">Commands used today: {usageLabel(usage, plan)}</span>
          <span className="aic-welcome-plan-actions">{actionMode ? 'Full action execution enabled' : commander ? 'Action execution temporarily unavailable' : 'Actions require Commander Plan'}</span>
        </div>
        {!commander && <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />}
      </div>
    </div>
  )
}

export function PostChatActivity({ usageHistory, now, lastCommand = '', insights = null, followUps = [], disabled = false, onPrompt }: {
  usageHistory: readonly import('./ai-command-model.js').AiCommandUsage[]
  now: number
  lastCommand?: string
  insights?: import('./ai-command-model.js').AiCommandQuickInsights | null
  followUps?: readonly import('./ai-command-model.js').AiCommandSuggestion[]
  disabled?: boolean
  onPrompt: (value: string) => void
}) {
  const bars = usageHistoryBars(usageHistory, 7, new Date(now))
  const total = bars.reduce((sum, bar) => sum + bar.value, 0)
  const savedMinutes = total * 3
  const savedLabel = savedMinutes >= 60 ? `${(savedMinutes / 60).toFixed(1)}h` : `${savedMinutes}m`
  const maxDot = Math.max(1, ...bars.map((bar) => bar.value))
  const suggestions = followUps.length > 0 ? followUps : fallbackFollowUps(lastCommand)
  const tip = DAILY_TIPS[new Date(now).getUTCDate() % DAILY_TIPS.length] ?? DAILY_TIPS[0]!
  const insightCards = [
    { icon: BarChart3, label: 'Revenue today', value: moneyOrEmpty(insights?.revenueToday, insights?.currency), detail: comparison(insights?.revenueToday, insights?.revenueYesterday, 'yesterday'), prompt: "Show today's revenue details", tone: 'purple' },
    { icon: ShoppingCart, label: 'Orders today', value: countOrEmpty(insights?.ordersToday, 'orders'), detail: comparison(insights?.ordersToday, insights?.ordersYesterday, 'yesterday'), prompt: "Show today's orders", tone: 'blue' },
    { icon: Package, label: 'Low stock alerts', value: countOrEmpty(insights?.lowStockCount, 'products'), detail: insights?.lowStockCount == null ? 'Sync inventory to see data' : insights.lowStockCount > 0 ? 'Needs attention' : 'No low-stock alerts', prompt: 'Show low stock products', tone: 'orange' },
    { icon: ShieldCheck, label: 'Store health', value: insights?.healthScore == null ? 'No data yet' : `${insights.healthScore}/100`, detail: insights?.healthStatus ?? 'Sync your store to calculate', prompt: 'Run store health check', tone: 'green' },
  ] as const
  return (
    <div className="aic-postchat" aria-label="Conversation tools">
      <section aria-label="Contextual follow-up suggestions">
        <div className="aic-postchat-head"><ArrowUpRight size={14} /> Continue exploring <small>Based on your last command</small></div>
        <div className="aic-followups-grid">
          {suggestions.slice(0, 6).map((suggestion) => (
            <Button key={suggestion.command} type="button" disabled={disabled} onClick={() => onPrompt(suggestion.command)}>{suggestion.label}<ChevronRight size={13} /></Button>
          ))}
        </div>
      </section>

      <section aria-label="Live store quick insights">
        <div className="aic-postchat-head"><Zap size={14} /> Quick insights <small>{insights?.sources.length ? 'Live synced store data' : 'Waiting for synced store data'}</small></div>
        <div className="aic-insights-grid">
          {insightCards.map((card) => (
            <Button key={card.label} type="button" className={`tone-${card.tone}`} disabled={disabled} onClick={() => onPrompt(card.prompt)}>
              <span className="aic-insight-icon"><card.icon size={16} /></span>
              <span><small>{card.label}</small><strong>{card.value}</strong><em>{card.detail}</em></span>
              <ChevronRight size={14} />
            </Button>
          ))}
        </div>
      </section>

      <section aria-label="Popular commands">
        <div className="aic-postchat-head"><Star size={14} /> Popular commands <small>Always available</small></div>
        <div className="aic-popular-compact">
          {POPULAR_COMPACT.map((item) => (
            <Button key={item.label} type="button" disabled={disabled} onClick={() => onPrompt(item.command)}><item.icon size={14} /> {item.label}</Button>
          ))}
        </div>
      </section>

      <section className="aic-daily-tip" aria-label="AI tip of the day">
        <span className="aic-tip-icon">💡</span>
        <div><strong>AI tip of the day</strong><p>{tip.text}</p></div>
        <Button type="button" disabled={disabled} onClick={() => onPrompt(tip.command)}>Try it <ArrowUpRight size={13} /></Button>
      </section>

      <section className="aic-activity" aria-label="Your command activity for the last 7 days">
        <div className="aic-postchat-head"><TrendingUp size={14} /> Your Command Activity <small>Last 7 days · real usage</small></div>
        <div className="aic-activity-track">
          {bars.map((bar, index) => (
            <span key={`${bar.label}-${index}`} className={`aic-activity-day ${bar.isToday ? 'today' : ''} ${bar.value === 0 ? 'empty' : ''}`} style={{ '--dot-scale': Math.max(0.55, bar.value / maxDot) } as CSSProperties} title={`${bar.label}: ${bar.value} command${bar.value === 1 ? '' : 's'}`}>
              <span className="aic-activity-dot"><i /></span><strong>{bar.value}</strong><small>{bar.label}</small>
            </span>
          ))}
        </div>
        <div className="aic-activity-footer"><span>Total: {total} commands</span><span>Time saved: ~{savedLabel}</span></div>
      </section>
    </div>
  )
}

const POPULAR_COMPACT = [
  { icon: BarChart3, label: 'Revenue report', command: 'Show my revenue report' },
  { icon: Users, label: 'Top customers', command: 'Show my top customers' },
  { icon: Package, label: 'Inventory check', command: 'Show low stock products' },
  { icon: TrendingUp, label: 'Growth tips', command: 'Show growth opportunities' },
  { icon: ShoppingCart, label: 'Recent orders', command: 'Show recent orders' },
  { icon: ShieldCheck, label: 'Store health', command: 'Run store health check' },
  { icon: RefreshCw, label: 'Automation status', command: 'Show automation status' },
  { icon: ClipboardList, label: 'Weekly summary', command: "Summarize this week's store performance" },
] as const

const DAILY_TIPS = [
  { text: 'Find customers who have not ordered in 30 days to identify at-risk customers.', command: "Find customers who haven't ordered in 30 days" },
  { text: 'Compare this week’s sales with last week for a quick performance check.', command: "Compare this week's sales to last week" },
  { text: 'Find products with no sales this month to spot underperformers.', command: 'Show products with no sales this month' },
  { text: 'Ask for today’s best-selling product for an instant merchandising insight.', command: "What's my best selling product today?" },
  { text: 'Review low-stock best sellers before they become lost sales.', command: 'Show best sellers that are running low' },
  { text: 'Compare new and returning customers to understand retention.', command: 'Compare new and returning customers this month' },
  { text: 'Run a store health check to combine live sales and inventory signals.', command: 'Run store health check' },
] as const

function fallbackFollowUps(command: string): readonly import('./ai-command-model.js').AiCommandSuggestion[] {
  const text = command.toLowerCase()
  const prompts = /(stock|inventory|product)/.test(text)
    ? ['Show products to reorder', 'Find products with no sales in 60 days', 'Show best sellers running low', 'Show out-of-stock products']
    : /(customer|vip|inactive)/.test(text)
      ? ['Show repeat customers', 'Find at-risk customers', 'Show top spending customers', 'Show new customers this week']
      : ['Compare with last month’s revenue', 'Show revenue by product', 'Show average order value', 'Show today’s orders']
  return prompts.map((label) => ({ label, command: label }))
}

function moneyOrEmpty(value: number | null | undefined, currency: string | null | undefined): string {
  return value == null ? 'No data yet' : formatMoney(value, currency)
}
function countOrEmpty(value: number | null | undefined, noun: string): string {
  return value == null ? 'No data yet' : `${formatNumber(value)} ${noun}`
}
function comparison(current: number | null | undefined, previous: number | null | undefined, period: string): string {
  if (current == null || previous == null) return 'Sync store to compare'
  if (previous === 0) return current === 0 ? `No change vs ${period}` : `New activity vs ${period}`
  const change = Math.round(((current - previous) / previous) * 100)
  return `${change >= 0 ? '↑' : '↓'} ${Math.abs(change)}% vs ${period}`
}

function MessageBubble({ message, now, busy, onApprove, onCancel, onEdit, onUndo, onUpgrade, plan, onSave, onRegenerate, onFeedback, onPrompt, onToast }: {
  message: AiCommandMessage
  now: number
  busy: boolean
  onApprove: (id: string) => void
  onCancel: (id: string) => void
  onEdit: (id: string) => void
  onUndo: (id: string) => void
  onUpgrade: () => void
  plan: AiCommandPlan
  onSave: () => void
  onRegenerate: () => void
  onFeedback: (rating: 'HELPFUL' | 'NOT_HELPFUL') => void
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

  const share = async () => {
    const payload = `${message.content}\n\n— AI Command (ProfitPilot)`
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'AI Command response', text: payload })
        return
      } catch {
        // User closed the share sheet — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(payload)
      onToast('Response copied — paste it anywhere to share.', 'success')
    } catch {
      onToast('Could not share — your browser blocked clipboard access.', 'warning')
    }
  }

  return (
    <article className={`aic-bubble ${mine ? 'mine' : 'theirs'} ${message.contentType}`}>
      <div className="aic-bubble-meta">
        {mine
          ? <span className="aic-avatar user">You</span>
          : <span className="aic-avatar ai"><AiCommandMark size={12} /> AI Command</span>}
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
              {message.structuredData && <StructuredBlock data={message.structuredData} onPrompt={onPrompt} />}
            </>
          )}

        {message.contentType === 'action_preview' && message.action?.id && message.action.status === 'PENDING' && (
          <div className="aic-preview-actions">
            <Button type="button" className="aic-button approve" disabled={busy} onClick={() => onApprove(message.action!.id!)}><Check size={14} /> Approve</Button>
            <Button type="button" className="aic-button secondary" disabled={busy} onClick={() => onEdit(message.action!.id!)}><Pencil size={14} /> Edit</Button>
            <Button type="button" className="aic-button ghost" disabled={busy} onClick={() => onCancel(message.action!.id!)}><X size={14} /> Cancel</Button>
          </div>
        )}
        {message.contentType === 'action_result' && message.action?.rollbackAvailable && undoLeft > 0 && (
          <Button type="button" className="aic-button secondary" onClick={() => onUndo(message.action!.id!)}><Undo2 size={14} /> Undo ({undoLeft}s remaining)</Button>
        )}
        {message.contentType === 'upgrade' && <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />}

        {!mine && (
          <div className="aic-bubble-actions">
            {copyable && (
              <Button type="button" className="aic-chip-action" onClick={copy} aria-label="Copy response" title="Copy"><Copy size={13} /></Button>
            )}
            {copyable && (
              <Button type="button" className="aic-chip-action" onClick={() => void share()} aria-label="Share response" title="Share"><Share2 size={13} /></Button>
            )}
            {message.contentType === 'text' || message.contentType === 'structured_data' ? (
              <Button type="button" className="aic-chip-action" onClick={onRegenerate} aria-label="Regenerate response" title="Regenerate"><RefreshCw size={13} /></Button>
            ) : null}
            {copyable && (
              <>
                <Button type="button" className="aic-chip-action" onClick={() => onFeedback('HELPFUL')} aria-label="Good response" title="Helpful"><ThumbsUp size={13} /></Button>
                <Button type="button" className="aic-chip-action" onClick={() => onFeedback('NOT_HELPFUL')} aria-label="Poor response" title="Not helpful"><ThumbsDown size={13} /></Button>
              </>
            )}
            {message.contentType === 'text' && (
              <Button type="button" className="aic-chip-action" onClick={onSave} aria-label="Save this command" title="Save command"><Star size={13} /></Button>
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
          <Button key={suggestion.label} type="button" className="aic-offtopic-chip" onClick={() => onPrompt(suggestion.prompt)}>
            <suggestion.icon size={13} /> {suggestion.label}
          </Button>
        ))}
      </div>
      <p className="aic-offtopic-cta">What would you like to know about your store?</p>
    </div>
  )
}

function StructuredBlock({ data, onPrompt }: { data: NonNullable<AiCommandMessage['structuredData']>; onPrompt: (value: string) => void }) {
  const record = isRecord(data.data) ? data.data : {}
  if (data.type === 'analytics') return <AnalyticsBlock data={record} source={data.source} />
  if (data.type === 'store_health') return <HealthBlock data={record} source={data.source} />
  if (data.type === 'growth_plan') return <GrowthPlanBlock data={record} source={data.source} onPrompt={onPrompt} />

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
  workflow_list: 'Automations',
  action_preview: 'Action preview',
  action_result: 'Action result',
  growth_plan: 'Growth plan',
}

function GrowthPlanBlock({ data, source, onPrompt }: { data: Record<string, unknown>; source: string | undefined; onPrompt: (value: string) => void }) {
  const signals = isRecord(data.signals) ? data.signals : {}
  const priorities = Array.isArray(data.priorities) ? data.priorities.map(String) : []
  const commands = Array.isArray(data.nextCommands) ? data.nextCommands.filter(isRecord) : []
  const actionMode = data.actionsEnabled === true
  const currency = asCurrency(signals.currency)
  const signalCards = [
    { label: 'Revenue', value: asNumber(signals.revenue) === null ? 'No data' : formatMoney(asNumber(signals.revenue)!, currency), icon: BarChart3 },
    { label: 'Orders', value: asNumber(signals.orders) === null ? 'No data' : formatNumber(asNumber(signals.orders)!), icon: ShoppingCart },
    { label: 'Store health', value: asNumber(signals.healthScore) === null ? 'No data' : `${formatNumber(asNumber(signals.healthScore)!)}/100`, icon: ShieldCheck },
    { label: 'Low stock', value: asNumber(signals.lowStockCount) === null ? 'No data' : formatNumber(asNumber(signals.lowStockCount)!), icon: Package },
  ]
  return (
    <div className={`aic-growth-plan ${actionMode ? 'action-ready' : 'insight-only'}`}>
      <div className="aic-growth-signals">
        {signalCards.map((card) => <div key={card.label}><card.icon size={14} /><span>{card.label}</span><strong>{card.value}</strong></div>)}
      </div>
      {priorities.length > 0 && <ul className="aic-growth-priorities">{priorities.map((priority) => <li key={priority}>{priority}</li>)}</ul>}
      {commands.length > 0 && (
        <div className="aic-growth-actions">
          <strong>{actionMode ? 'Commander actions — preview first' : 'Next analysis'}</strong>
          <div>{commands.map((command) => {
            const label = typeof command.label === 'string' ? command.label : 'Continue'
            const prompt = typeof command.command === 'string' ? command.command : ''
            return <Button key={`${label}-${prompt}`} type="button" disabled={!prompt} onClick={() => onPrompt(prompt)}>{actionMode ? <Zap size={13} /> : <Search size={13} />}{label}<ChevronRight size={13} /></Button>
          })}</div>
        </div>
      )}
      {source && <small className="aic-source">Source: {source}</small>}
    </div>
  )
}

function AnalyticsBlock({ data, source }: { data: Record<string, unknown>; source: string | undefined }) {
  const revenue = asNumber(data.revenue)
  const previous = asNumber(data.previousRevenue)
  const orders = asNumber(data.orders)
  const aov = asNumber(data.aov)
  const currency = asCurrency(data.currency)
  const change = revenue !== null && previous !== null && previous !== 0 ? Math.round(((revenue - previous) / previous) * 100) : null
  const maxForBar = Math.max(revenue ?? 0, previous ?? 0, 1)
  return (
    <div className="aic-metrics">
      <div className="aic-metric primary">
        <span className="aic-metric-label">Revenue this period</span>
        <strong>{revenue !== null ? formatMoney(revenue, currency) : '—'}</strong>
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
          <strong>{formatMoney(aov, currency)}</strong>
        </div>
      )}
      {revenue !== null && previous !== null && (
        <div className="aic-compare">
          <span className="aic-compare-label">This period vs previous</span>
          <div className="aic-compare-bars">
            <span className="aic-compare-row"><i>This period</i><em><b style={{ width: `${Math.round((revenue / maxForBar) * 100)}%` }} /><small>{formatMoney(revenue, currency)}</small></em></span>
            <span className="aic-compare-row"><i>Previous</i><em><b className="dim" style={{ width: `${Math.round((previous / maxForBar) * 100)}%` }} /><small>{formatMoney(previous, currency)}</small></em></span>
          </div>
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

function ThinkingCard({ steps, streaming, onCancel }: { steps: readonly string[]; streaming: string; onCancel: () => void }) {
  const STEPS = ['Understanding your request...', 'Fetching store data...', 'Analyzing patterns...', 'Preparing response...']
  const current = Math.max(0, steps.length - 1)
  return (
    <article className="aic-thinking" aria-live="polite">
      <div className="aic-thinking-head">
        <span className="aic-thinking-dots"><i /><i /><i /></span>
        AI Command is thinking…
        <span className="aic-thinking-eta">usually under 15 seconds</span>
        <Button type="button" className="aic-thinking-cancel" onClick={onCancel} aria-label="Cancel command">Cancel <X size={12} /></Button>
      </div>
      <ol className="aic-thinking-steps">
        {STEPS.map((step, index) => (
          <li key={step} className={index < current ? 'done' : index === current ? 'active' : 'pending'}>
            {index < current ? <Check size={12} /> : <i />} {step}
          </li>
        ))}
      </ol>
      {streaming && <p className="aic-stream">{streaming}</p>}
    </article>
  )
}

function Suggestions({ draft, onPick }: { draft: string; onPick: (value: string) => void }) {
  const needle = draft.trim().toLowerCase()
  const matches = useMemo(() => {
    if (needle.length < 2) return []
    const pool = [...TEMPLATES.map((item) => item.command), ...POPULAR_QUESTIONS.map((item) => item.prompt)]
    const unique = [...new Set(pool)]
    return unique.filter((item) => item.toLowerCase().includes(needle)).slice(0, 3)
  }, [needle])
  if (matches.length === 0) return null
  return (
    <div className="aic-suggestions" role="listbox" aria-label="Suggestions">
      {matches.map((item) => (
        <Button key={item} type="button" role="option" onClick={() => onPick(item)}>
          <Search size={12} /> {item}
        </Button>
      ))}
    </div>
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
          <Button
            key={category.id}
            type="button"
            role="tab"
            aria-selected={category.id === current}
            className={category.id === current ? `active tone-${CATEGORY_TONE[category.id]}` : ''}
            onClick={() => setActive(category.id)}
          >
            <category.icon size={13} /> {category.label}
          </Button>
        ))}
      </div>
      <div className="aic-quick-pills">
        {groups[current].map((command) => (
          <Button key={command.id} type="button" className={`tone-${quickCommandTone(command)}`} onClick={() => onSend(command.command)} disabled={disabled}>
            {command.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function UsageRingCard({ usage, plan, now, onUpgrade }: { usage: AiCommandUsage | null; plan: AiCommandPlan; now: number; onUpgrade: () => void }) {
  const commander = plan === 'commander'
  const tone = usageTone(usage)
  const countdown = dailyResetCountdown(new Date(now))
  const used = usage?.commandsUsed ?? 0
  const limit = usage?.limit ?? null
  const pct = commander || limit === null ? 100 : usagePercent(usage)
  const ringStyle = { '--ring-pct': `${pct * 3.6}deg` } as CSSProperties
  // Higher plans raise the daily limit, so the numbers inside the ring grow.
  // Scale the ring type down by digit count so it can never overflow the circle.
  const digits = Math.max(String(used).length, limit === null ? 1 : String(limit).length)
  const ringScale = digits >= 6 ? 'size-xs' : digits >= 4 ? 'size-sm' : ''
  return (
    <section className={`aic-usage-ring ${tone}`}>
      <div className="aic-usage-ring-top">
        <span>Daily commands</span>
        <span className="aic-plan-badge">{planLabel(plan)}</span>
      </div>
      <div className="aic-usage-ring-body">
        <div className="aic-ring" style={ringStyle}>
          <div className="aic-ring-inner">
            <strong className={ringScale}>{commander || limit === null ? '∞' : used}</strong>
            <small className={ringScale}>{commander || limit === null ? 'Unlimited' : `of ${limit} today`}</small>
          </div>
        </div>
        <div className="aic-usage-ring-copy">
          <strong>{commander || limit === null ? 'Unlimited commands' : `${limit - used} command${limit - used === 1 ? '' : 's'} left today`}</strong>
          <span><Clock3 size={12} /> {commander ? 'No daily reset' : `Resets in ${countdown.hours}h ${countdown.minutes}m`}</span>
          {tone === 'red' && <em>All used up — nice work! Fresh commands arrive at the next reset.</em>}
          {tone === 'amber' && <em>Almost at your limit — plan your next commands wisely.</em>}
          {tone === 'green' && <em>Every answer is grounded in your real store data.</em>}
        </div>
      </div>
      {!commander && (
        <div className="aic-usage-ring-cta">
          <span>Need more? <strong>Upgrade Plan</strong> for higher daily limits — and actions on Commander.</span>
          <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
        </div>
      )}
    </section>
  )
}

function RecentCommandsCard({ conversations, onOpen, onNewChat }: {
  conversations: readonly import('./ai-command-model.js').AiCommandConversation[]
  onOpen: (id: string) => void
  onNewChat: () => void
}) {
  const recent = [...conversations].sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt)).slice(0, 5)
  return (
    <section className="aic-side-block recent">
      <div className="aic-side-head-row">
        <h3>Recent commands</h3>
        <Button type="button" className="aic-text-button" onClick={onNewChat}><Plus size={12} /> New</Button>
      </div>
      {recent.length === 0 && (
        <div className="aic-inline-empty">
          <AiCommandMark size={24} />
          <strong>No commands yet</strong>
          <span>Ask your first question — recent commands will appear here so you can reload them anytime.</span>
        </div>
      )}
      {recent.map((item) => {
        const preview = conversationPreview(item)
        return (
          <Button key={item.id} type="button" className="aic-recent" onClick={() => onOpen(item.id)}>
            <span className="aic-recent-meta">
              <time>{new Date(item.lastMessageAt).toLocaleString()}</time>
              <ChevronRight size={12} />
            </span>
            <strong>{preview.question}</strong>
            {preview.answer && <small>{preview.answer}</small>}
          </Button>
        )
      })}
    </section>
  )
}

function ValueCard({ usage, usageHistory, conversations, saved, now }: {
  usage: AiCommandUsage | null
  usageHistory: readonly import('./ai-command-model.js').AiCommandUsage[]
  conversations: number
  saved: number
  now: number
}) {
  const stats = valueStats(usage, usageHistory, conversations, saved)
  const bars = usageHistoryBars(usageHistory, 7, new Date(now))
  const maxBar = Math.max(1, ...bars.map((bar) => bar.value))
  return (
    <section className="aic-side-block value">
      <h3>Your impact</h3>
      <div className="aic-value-grid">
        <div className="aic-value-stat"><span>Commands today</span><strong>{stats.commandsToday}</strong></div>
        <div className="aic-value-stat"><span>Commands this week</span><strong>{stats.commandsWeek}</strong></div>
        <div className="aic-value-stat"><span>Actions taken</span><strong>{stats.actions}</strong></div>
        <div className="aic-value-stat"><span>Conversations</span><strong>{stats.conversations}</strong></div>
        <div className="aic-value-stat"><span>Saved commands</span><strong>{stats.saved}</strong></div>
        <div className="aic-value-stat estimate"><span>Time saved (est.)</span><strong>{stats.timeSavedLabel}</strong></div>
      </div>
      <div className="aic-value-chart">
        <div className="aic-value-chart-head"><span>Commands per day</span><small>Last 7 days · real usage</small></div>
        <div className="aic-value-bars">
          {bars.map((bar) => (
            <span key={bar.label} className={bar.isToday ? 'today' : ''} title={`${bar.label}: ${bar.value}`}>
              <i style={{ height: `${Math.max(4, Math.round((bar.value / maxBar) * 100))}%` }} />
              <small>{bar.label}</small>
            </span>
          ))}
        </div>
      </div>
      <p className="aic-stats-note">Every figure reflects real AI Command usage — time saved is estimated at ~3 minutes per manual lookup.</p>
    </section>
  )
}

function ShowcaseCard({ onPrompt }: { onPrompt: (value: string) => void }) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % SHOWCASES.length), 6000)
    return () => window.clearInterval(timer)
  }, [])
  const current = SHOWCASES[index] ?? SHOWCASES[0]!
  return (
    <section className="aic-side-block showcase">
      <h3>What AI can do</h3>
      <div className={`aic-showcase tone-${current.tone}`} key={index}>
        <span className="aic-showcase-icon"><current.icon size={18} /></span>
        <strong>{current.title}</strong>
        <p>{current.description}</p>
        <Button type="button" className="aic-showcase-run" onClick={() => onPrompt(current.sample)}>
          <Search size={12} /> {current.sample}
        </Button>
      </div>
      <div className="aic-showcase-dots" role="tablist" aria-label="Showcase pages">
        {SHOWCASES.map((item, dotIndex) => (
          <Button
            key={item.title}
            type="button"
            role="tab"
            aria-selected={dotIndex === index}
            aria-label={item.title}
            className={dotIndex === index ? 'active' : ''}
            onClick={() => setIndex(dotIndex)}
          />
        ))}
      </div>
    </section>
  )
}

function ActivityCard({ usage, conversations, saved }: { usage: AiCommandUsage | null; conversations: number; saved: number }) {
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

function lastUserContent(messages: readonly AiCommandMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages[index]!.content
  }
  return ''
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
function formatMoney(value: number, currency: string | null | undefined): string {
  if (!currency) return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)} · currency unavailable`
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}
function asCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveAiCommandPlan(raw: string | null | undefined): AiCommandPlan {
  const value = raw?.toLowerCase()
  if (value === 'commander' || value === 'growth' || value === 'start') return value
  return 'trial'
}
