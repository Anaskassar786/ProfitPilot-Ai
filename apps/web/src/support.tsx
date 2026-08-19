import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  Gem,
  Inbox,
  LifeBuoy,
  Mail,
  MessageCircleQuestion,
  Paperclip,
  Plus,
  RefreshCw,
  Sparkles,
  TicketCheck,
  X,
} from 'lucide-react'
import { createTicket, fetchBilling, fetchTickets } from './api.js'
import type { TicketRecord } from './api.js'
import type { BillingAccount, WorkspaceContext } from './model.js'
import { CustomSelect } from './CustomSelect.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import {
  COMMON_FAQ_IDS,
  FAQ_CATEGORIES,
  PRIORITY_CHOICES,
  SUPPORT_TIERS,
  TICKET_CATEGORIES,
  apiPlanFor,
  apiPriorityFor,
  attachmentNote,
  commonFaqs,
  composeSubject,
  formatAttachmentSize,
  formatTicketDate,
  formatTicketMonth,
  resolveSupportPlan,
  splitTickets,
  ticketPriorityLabel,
  ticketQuota,
  ticketStatusMeta,
} from './support-model.js'
import type { SupportPlan, SupportTicketRecord, TicketCategory, TicketPriorityChoice } from './support-model.js'

export type SupportToast = (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void

/**
 * Help & Support — merchant-friendly redesign.
 *
 * · Renamed from "Operator inbox / Support tickets" jargon to "Help & Support".
 * · Plan-based support: quota, response target, and the always-present
 *   Upgrade Plan CTA come from the real billing account.
 * · FAQ / self-help section before ticket creation, plus an "Ask AI Command"
 *   path so 80% of questions never need a ticket.
 * · Zero fake data: tickets come from /support/tickets and the plan from
 *   /billing. Nothing is seeded, nothing is invented.
 */
export function HelpSupportPage({
  context,
  onToast,
  onNavigate,
  onNavigateBilling,
}: {
  context: WorkspaceContext
  onToast: SupportToast
  onNavigate: (page: 'ai-command') => void
  onNavigateBilling: () => void
}) {
  const [tickets, setTickets] = useState<readonly TicketRecord[]>([])
  const [account, setAccount] = useState<BillingAccount | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [showAllFaqs, setShowAllFaqs] = useState(false)
  const [loading, setLoading] = useState(true)
  // A failed tickets fetch must never be indistinguishable from an empty
  // inbox: the celebratory "All Clear!" state is only honest after a
  // *successful* load that returned zero tickets.
  const [loadFailed, setLoadFailed] = useState(false)

  const plan: SupportPlan = resolveSupportPlan(account)
  const tier = SUPPORT_TIERS[plan]
  const quota = useMemo(() => ticketQuota(tickets, plan), [tickets, plan])
  const { open: openTickets, past: pastTickets } = useMemo(() => splitTickets(tickets), [tickets])

  const refresh = () => {
    if (!context.storeId) { setTickets([]); setLoading(false); setLoadFailed(false); return }
    setLoading(true)
    void Promise.allSettled([fetchTickets(context.storeId), fetchBilling(context.storeId)]).then(([ticketResult, billingResult]) => {
      if (ticketResult.status === 'fulfilled') { setTickets(ticketResult.value); setLoadFailed(false) }
      else { setLoadFailed(true); onToast('Tickets could not be loaded. Check your connection and try again.', 'error') }
      if (billingResult.status === 'fulfilled') setAccount(billingResult.value)
      setLoading(false)
    })
  }

  useEffect(() => { refresh() }, [context.storeId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="support-workspace">
      <header className="support-header">
        <div className="support-header-copy">
          <div className="support-eyebrow"><LifeBuoy size={14} /> HELP CENTER</div>
          <h1>Help &amp; Support</h1>
          <p>Get help from our team. We track every question and respond quickly.</p>
        </div>
        <div className="support-header-actions">
          <button type="button" className="support-button secondary" onClick={() => onNavigate('ai-command')}>
            <Sparkles size={15} /> Ask AI Command
          </button>
          <button type="button" className="support-button primary" onClick={() => setFormOpen(true)}>
            <Plus size={15} /> New ticket
          </button>
        </div>
      </header>

      <SupportPlanCard plan={plan} quota={quota} onUpgrade={onNavigateBilling} />

      <FaqSection
        showAll={showAllFaqs}
        onToggleAll={() => setShowAllFaqs((value) => !value)}
        onShowAll={() => setShowAllFaqs(true)}
        onAskAi={() => onNavigate('ai-command')}
      />

      {formOpen && (
        <NewTicketForm
          plan={plan}
          storeId={context.storeId}
          limitReached={quota.limitReached}
          onCancel={() => setFormOpen(false)}
          onCreated={() => { setFormOpen(false); refresh() }}
          onToast={onToast}
          onUpgrade={onNavigateBilling}
        />
      )}

      {tickets.length === 0 && !formOpen ? (
        loadFailed ? (
          <SupportLoadError onRetry={refresh} loading={loading} />
        ) : loading ? (
          <SupportLoadingState />
        ) : (
          <SupportEmptyState
            onAskAi={() => onNavigate('ai-command')}
            onBrowseFaqs={() => { setShowAllFaqs(true); try { document.getElementById('support-faq')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) } catch { /* embedded browsers may restrict scrolling */ } }}
            onNewTicket={() => setFormOpen(true)}
            onRefresh={refresh}
            storeConnected={!!context.storeId}
          />
        )
      ) : (
        <TicketHistory open={openTickets} past={pastTickets} loading={loading} onRefresh={refresh} responseBadge={tier.responseBadge} />
      )}
    </div>
  )
}

/** 💎 Plan status: quota this month, response target, and Upgrade Plan — always. */
export function SupportPlanCard({ plan, quota, onUpgrade }: { plan: SupportPlan; quota: Readonly<{ used: number; limit: number | null; usageLabel: string; unlimited: boolean; limitReached: boolean; remaining: number | null }>; onUpgrade: () => void }) {
  const tier = SUPPORT_TIERS[plan]
  const usagePercent = quota.limit === null ? 0 : Math.min(100, Math.round((quota.used / quota.limit) * 100))
  return (
    <section className="support-plan-card" aria-label="Your support plan">
      <div className="support-plan-identity">
        <span className="support-plan-gem"><Gem size={18} /></span>
        <div>
          <div className="support-plan-kicker">YOUR PLAN</div>
          <h2>{tier.label}</h2>
        </div>
        <span className={`support-response-badge ${plan === 'commander' ? 'priority' : ''}`}>{tier.responseBadge}</span>
      </div>
      <div className="support-plan-facts">
        <div className="support-plan-fact">
          <span className="support-plan-fact-label">Support tickets · {formatTicketMonth()}</span>
          <strong className={quota.limitReached ? 'at-limit' : ''}>{quota.usageLabel}</strong>
          {quota.limit !== null && (
            <div className="support-usage-track" role="progressbar" aria-valuenow={quota.used} aria-valuemin={0} aria-valuemax={quota.limit} aria-label={`Support tickets used this month: ${quota.usageLabel}`}>
              <span style={{ width: `${usagePercent}%` }} className={quota.limitReached ? 'at-limit' : ''} />
            </div>
          )}
        </div>
        <div className="support-plan-fact">
          <span className="support-plan-fact-label">Response target</span>
          <strong>{tier.responseTargetHours === 4 ? '4h priority' : `${tier.responseTargetHours} hours`}</strong>
          <small>{tier.responseNote}</small>
        </div>
        <div className="support-plan-fact">
          <span className="support-plan-fact-label">Priority queue</span>
          <strong>{tier.priorityQueue ? <><CheckCircle2 size={14} /> Included</> : 'Not included'}</strong>
          <small>{tier.priorityQueue ? 'Your tickets jump to the front of the line.' : 'Commander plans move tickets to the front of the line.'}</small>
        </div>
      </div>
      <div className="support-plan-cta">
        <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
        {plan === 'commander' && <span className="support-top-plan"><CheckCircle2 size={14} /> You are on the top plan — thank you!</span>}
      </div>
    </section>
  )
}

/** 📚 Quick answers (4 categories) + ❓ common questions (expandable). */
function FaqSection({ showAll, onToggleAll, onShowAll, onAskAi }: { showAll: boolean; onToggleAll: () => void; onShowAll: () => void; onAskAi: () => void }) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) => setOpenIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  // Category "Read" must always *reveal* the library — never collapse it.
  const openQuestion = (id: string) => setOpenIds((current) => current.has(id) ? current : new Set(current).add(id))
  const common = commonFaqs()
  return (
    <section className="support-faq" id="support-faq" aria-label="Quick answers">
      <div className="support-section-head">
        <div>
          <div className="support-section-kicker"><BookOpen size={13} /> QUICK ANSWERS</div>
          <h2>Find help instantly without waiting</h2>
        </div>
        <button type="button" className="support-text-button" onClick={onToggleAll} aria-expanded={showAll}>
          {showAll ? 'Show common questions' : 'View all FAQs'} <ChevronDown size={14} className={showAll ? 'flipped' : ''} />
        </button>
      </div>

      <div className="support-faq-category-grid">
        {FAQ_CATEGORIES.map((category) => (
          <div className="support-faq-category" key={category.id}>
            <div className="support-faq-category-pin" aria-hidden="true">📌</div>
            <h3>{category.title}</h3>
            <p>{category.blurb}</p>
            <button type="button" className="support-text-button" onClick={() => { onShowAll(); openQuestion(category.questions[0]?.id ?? '') }}>
              Read <ArrowRight size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="support-faq-common">
        <div className="support-section-kicker"><MessageCircleQuestion size={13} /> COMMON QUESTIONS</div>
        {showAll ? (
          <div className="support-faq-full">
            {FAQ_CATEGORIES.map((category) => (
              <div className="support-faq-group" key={category.id}>
                <h4>{category.title}</h4>
                {category.questions.map((entry) => (
                  <FaqItem key={entry.id} entry={entry} categoryTitle={category.title} open={openIds.has(entry.id)} onToggle={() => toggle(entry.id)} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="support-faq-list">
            {common.map((entry) => (
              <FaqItem key={entry.id} entry={entry} categoryTitle={entry.categoryTitle} open={openIds.has(entry.id)} onToggle={() => toggle(entry.id)} />
            ))}
          </div>
        )}
      </div>

      <p className="support-faq-footnote">
        💡 Tip: <button type="button" className="support-text-button inline" onClick={onAskAi}>Ask AI Command</button> can answer 80% of questions instantly!
      </p>
    </section>
  )
}

function FaqItem({ entry, categoryTitle, open, onToggle }: { entry: Readonly<{ id: string; question: string; answer: string }>; categoryTitle: string; open: boolean; onToggle: () => void }) {
  return (
    <div className={`support-faq-item ${open ? 'open' : ''}`}>
      <button type="button" className="support-faq-question" onClick={onToggle} aria-expanded={open}>
        <span>{entry.question}</span>
        <ChevronDown size={15} className={open ? 'flipped' : ''} />
      </button>
      {open && <p className="support-faq-answer">{entry.answer}</p>}
      {!open && <small className="support-faq-category-tag">{categoryTitle}</small>}
    </div>
  )
}

/** ⏳ Honest first paint while the tickets fetch is in flight. */
function SupportLoadingState() {
  return (
    <section className="support-tickets support-loading" aria-label="Loading your tickets" aria-busy="true">
      <div className="support-loading-head">
        <span className="support-loading-spinner" aria-hidden="true"><RefreshCw size={15} /></span>
        <div>
          <div className="support-section-kicker"><TicketCheck size={13} /> YOUR TICKETS</div>
          <h2>Loading your tickets…</h2>
        </div>
      </div>
      <div className="support-loading-bars" aria-hidden="true">
        <span className="support-loading-bar wide" />
        <span className="support-loading-bar" />
        <span className="support-loading-bar short" />
      </div>
    </section>
  )
}

/** ⚠️ A failed load with a working retry — never disguised as "All Clear!". */
function SupportLoadError({ onRetry, loading }: { onRetry: () => void; loading: boolean }) {
  return (
    <section className="support-tickets support-load-error" role="alert" aria-label="Tickets could not be loaded">
      <div className="support-load-error-copy">
        <span className="support-load-error-icon" aria-hidden="true"><AlertTriangle size={20} /></span>
        <div>
          <h2>Your tickets could not be loaded</h2>
          <p>This is usually a temporary connection issue — your tickets are safe. Try again, or browse the quick answers above in the meantime.</p>
        </div>
      </div>
      <div className="support-load-error-actions">
        <button type="button" className="support-button primary" onClick={onRetry} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinning' : ''} /> {loading ? 'Checking…' : 'Try again'}
        </button>
      </div>
    </section>
  )
}

/** 🎉 The helpful empty state: three fastest paths to an answer. */
function SupportEmptyState({ onAskAi, onBrowseFaqs, onNewTicket, onRefresh, storeConnected }: { onAskAi: () => void; onBrowseFaqs: () => void; onNewTicket: () => void; onRefresh: () => void; storeConnected: boolean }) {
  return (
    <section className="support-empty" aria-label="No open tickets">
      <div className="support-empty-banner">
        <span className="support-empty-emoji" aria-hidden="true">🎉</span>
        <div>
          <h2>All Clear! No open tickets.</h2>
          <p>{storeConnected ? 'No open support tickets. Your store is running smoothly!' : 'Connect your Shopify store to open tickets — until then, the FAQ and AI Command below work right away.'}</p>
        </div>
        {storeConnected && (
          <button type="button" className="support-empty-refresh" onClick={onRefresh} title="Re-check your tickets">
            <RefreshCw size={13} /> Check again
          </button>
        )}
      </div>
      <p className="support-empty-lead">Need help with something? Choose the fastest option:</p>
      <div className="support-empty-options">
        <button type="button" className="support-option-card" onClick={onAskAi}>
          <span className="support-option-icon ai"><Bot size={20} /></span>
          <strong>Ask AI Command</strong>
          <small>Instant answers about your store</small>
          <span className="support-option-cta">Open <ArrowRight size={13} /></span>
        </button>
        <button type="button" className="support-option-card" onClick={onBrowseFaqs}>
          <span className="support-option-icon book"><BookOpen size={20} /></span>
          <strong>Browse FAQs</strong>
          <small>Common questions answered instantly</small>
          <span className="support-option-cta">Browse <ArrowRight size={13} /></span>
        </button>
        <button type="button" className="support-option-card" onClick={onNewTicket}>
          <span className="support-option-icon mail"><Mail size={20} /></span>
          <strong>New Ticket</strong>
          <small>Complex issues need human support</small>
          <span className="support-option-cta">Create <ArrowRight size={13} /></span>
        </button>
      </div>
      <p className="support-faq-footnote">💡 Tip: AI Command can answer 80% of questions instantly!</p>
    </section>
  )
}

/** 📧 Create Support Ticket — category, priority, subject, description, screenshot. */
function NewTicketForm({
  plan,
  storeId,
  limitReached,
  onCancel,
  onCreated,
  onToast,
  onUpgrade,
}: {
  plan: SupportPlan
  storeId: string | null
  limitReached: boolean
  onCancel: () => void
  onCreated: () => void
  onToast: SupportToast
  onUpgrade: () => void
}) {
  const tier = SUPPORT_TIERS[plan]
  const [category, setCategory] = useState<TicketCategory>('general-question')
  const [priority, setPriority] = useState<TicketPriorityChoice>('NORMAL')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [attachment, setAttachment] = useState<Readonly<{ name: string; size: number }> | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const onFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) setAttachment({ name: file.name, size: file.size })
    event.target.value = ''
  }

  const submit = async () => {
    if (!storeId) { onToast('Connect your Shopify store first, then create the ticket.', 'info'); return }
    if (!subject.trim()) { onToast('Add a short subject so we know what happened.', 'info'); return }
    if (!description.trim()) { onToast('Describe the issue so our team can fix it fast.', 'info'); return }
    setSubmitting(true)
    try {
      const fullDescription = attachment ? `${description.trim()}\n\n${attachmentNote(attachment.name, attachment.size)}` : description.trim()
      await createTicket(storeId, composeSubject(category, subject), apiPlanFor(plan), fetch, { description: fullDescription, priority: apiPriorityFor(priority) })
      onToast('Ticket submitted. We will respond right here — check Your Tickets below.', 'success')
      setSubject(''); setDescription(''); setAttachment(null); setPriority('NORMAL'); setCategory('general-question')
      onCreated()
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : 'The ticket could not be submitted. Please try again.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (limitReached) {
    return (
      <section className="support-form-card" aria-label="Monthly ticket limit reached">
        <div className="support-form-blocked">
          <span className="support-form-blocked-icon"><Gem size={20} /></span>
          <h3>Monthly ticket limit reached</h3>
          <p>You have used all {tier.ticketLimit} tickets included with {tier.label} this month. Upgrade for more tickets and faster responses — your open tickets stay tracked either way.</p>
          <div className="support-form-blocked-actions">
            <button type="button" className="support-button secondary" onClick={onCancel}>Back to support</button>
            <button type="button" className="support-button primary" onClick={onUpgrade}><Gem size={14} /> Upgrade Plan</button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="support-form-card" aria-label="Create support ticket">
      <div className="support-form-head">
        <span className="support-form-icon"><Mail size={18} /></span>
        <div>
          <div className="support-section-kicker">CREATE SUPPORT TICKET</div>
          <h3>Tell us what happened</h3>
          <small className="support-form-sla">{tier.responseBadge} · every ticket is tracked</small>
        </div>
        <button type="button" className="support-close-button" onClick={onCancel} aria-label="Close ticket form"><X size={16} /></button>
      </div>
      <div className="support-form-grid">
        <div className="support-field">
          <span id="support-category-label">Category</span>
          <CustomSelect
            value={category}
            options={TICKET_CATEGORIES.map((entry) => ({ value: entry.value, label: entry.label }))}
            onChange={setCategory}
            ariaLabel="Ticket category"
          />
        </div>
        <fieldset className="support-field">
          <span>Priority</span>
          <div className="support-priority-options" role="radiogroup" aria-label="Ticket priority">
            {PRIORITY_CHOICES.map((choice) => (
              <button
                type="button"
                key={choice.value}
                role="radio"
                aria-checked={priority === choice.value}
                className={`support-priority-option ${priority === choice.value ? 'selected' : ''}`}
                onClick={() => setPriority(choice.value)}
              >
                <span className="support-radio" aria-hidden="true">{priority === choice.value ? '●' : '○'}</span>
                <span className="support-priority-copy"><strong>{choice.label}</strong><small>{choice.hint}</small></span>
              </button>
            ))}
          </div>
        </fieldset>
        <label className="support-field support-field-wide">
          <span>Subject</span>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Brief description of your issue"
            maxLength={160}
          />
        </label>
        <label className="support-field support-field-wide">
          <span>Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            placeholder={'Describe your issue in detail…\nInclude any error messages or screenshots if applicable.'}
          />
        </label>
        <div className="support-field support-field-wide">
          <span>Screenshot (optional)</span>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileSelected} className="support-file-input" aria-label="Attach screenshot" />
          {attachment ? (
            <span className="support-attachment-chip">
              <Paperclip size={13} /> {attachment.name} · {formatAttachmentSize(attachment.size)}
              <button type="button" onClick={() => setAttachment(null)} aria-label="Remove screenshot"><X size={13} /></button>
            </span>
          ) : (
            <button type="button" className="support-attach-button" onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={14} /> Attach Screenshot
            </button>
          )}
          <small className="support-field-hint">The file name and size are added to your ticket so support can find it. Full file uploads ship with the next release.</small>
        </div>
      </div>
      <div className="support-form-actions">
        <button type="button" className="support-button secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="support-button primary" disabled={submitting} onClick={() => void submit()}>
          {submitting ? 'Submitting…' : 'Submit Ticket'} <ArrowRight size={14} />
        </button>
      </div>
      <p className="support-field-hint form-footnote">We reply to {tier.label} tickets within {tier.responseTargetHours === 4 ? '4 hours (priority)' : `${tier.responseTargetHours} hours`}.</p>
    </section>
  )
}

/** 📋 Your tickets — open cards with details, past tickets below. */
function TicketHistory({ open, past, loading, onRefresh, responseBadge }: { open: readonly SupportTicketRecord[]; past: readonly SupportTicketRecord[]; loading: boolean; onRefresh: () => void; responseBadge: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  return (
    <section className="support-tickets" aria-label="Your tickets">
      <div className="support-section-head">
        <div>
          <div className="support-section-kicker"><TicketCheck size={13} /> YOUR TICKETS</div>
          <h2>{open.length > 0 ? `${open.length} open ticket${open.length === 1 ? '' : 's'}` : 'All Clear! No open tickets.'}</h2>
        </div>
        <button type="button" className="support-button secondary" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinning' : ''} /> {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {open.length > 0 ? (
        <div className="support-ticket-list">
          {open.map((ticket) => {
            const status = ticketStatusMeta(ticket.status)
            const expanded = expandedId === ticket.id
            return (
              <article className={`support-ticket-card ${expanded ? 'expanded' : ''}`} key={ticket.id}>
                <button type="button" className="support-ticket-main" onClick={() => setExpandedId(expanded ? null : ticket.id)} aria-expanded={expanded}>
                  <span className={`support-ticket-status-dot ${status.tone}`} aria-hidden="true" />
                  <span className="support-ticket-copy">
                    <strong>{ticket.subject}</strong>
                    <small>Created: {formatTicketDate(ticket.createdAt)} · Priority: {ticketPriorityLabel(ticket.priority)}</small>
                  </span>
                  <span className="support-ticket-badges">
                    <span className={`support-status-badge ${status.tone}`}>{ticket.status === 'OPEN' ? 'OPEN' : 'IN PROGRESS'} · {status.label}</span>
                    <span className="support-ticket-chevron"><ChevronDown size={15} className={expanded ? 'flipped' : ''} /></span>
                  </span>
                </button>
                {expanded && (
                  <div className="support-ticket-details">
                    <TicketDetailsBody ticket={ticket} responseBadge={responseBadge} />
                  </div>
                )}
              </article>
            )
          })}
        </div>
      ) : (
        <div className="support-tickets-none">
          <Inbox size={18} />
          <span>{past.length > 0 ? 'No open tickets right now — your past tickets are below.' : 'No open tickets right now.'}</span>
        </div>
      )}
      <div className="support-past-tickets">
        <h3>Past Tickets:</h3>
        {past.length > 0 ? (
          <div className="support-past-list">
            {past.map((ticket) => {
              const status = ticketStatusMeta(ticket.status)
              const expanded = expandedId === ticket.id
              return (
                <div className={`support-past-item ${expanded ? 'expanded' : ''}`} key={ticket.id}>
                  <button type="button" className="support-past-row" onClick={() => setExpandedId(expanded ? null : ticket.id)} aria-expanded={expanded}>
                    <span className={`support-ticket-status-dot ${status.tone}`} aria-hidden="true" />
                    <strong>{ticket.subject}</strong>
                    <small>Resolved {formatTicketDate(ticket.updatedAt)} · {ticketPriorityLabel(ticket.priority)} priority</small>
                    <span className={`support-status-badge ${status.tone}`}>{status.label}</span>
                    <span className="support-ticket-chevron" aria-hidden="true"><ChevronDown size={15} className={expanded ? 'flipped' : ''} /></span>
                  </button>
                  {expanded && (
                    <div className="support-past-details">
                      <TicketDetailsBody ticket={ticket} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="support-past-empty">No resolved tickets yet.</p>
        )}
      </div>
    </section>
  )
}

/** Shared expandable details for open and past tickets. */
function TicketDetailsBody({ ticket, responseBadge }: { ticket: SupportTicketRecord; responseBadge?: string }) {
  const status = ticketStatusMeta(ticket.status)
  return (
    <>
      {ticket.description ? <p>{ticket.description}</p> : <p className="muted">No description was added to this ticket.</p>}
      <dl>
        <div><dt>Status</dt><dd>{status.label}</dd></div>
        <div><dt>Priority</dt><dd>{ticketPriorityLabel(ticket.priority)}</dd></div>
        <div><dt>Created</dt><dd>{formatTicketDate(ticket.createdAt)}</dd></div>
        <div><dt>Last update</dt><dd>{formatTicketDate(ticket.updatedAt)}</dd></div>
        {responseBadge && <div><dt>Response target</dt><dd>{responseBadge}</dd></div>}
        <div><dt>Ticket ID</dt><dd className="mono">{ticket.id}</dd></div>
      </dl>
    </>
  )
}

/** Exported for the static-render test: the FAQ strip is visible by default. */
export const SUPPORT_COMMON_QUESTION_IDS = COMMON_FAQ_IDS
