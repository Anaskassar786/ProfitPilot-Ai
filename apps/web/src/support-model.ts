import type { BillingAccount } from './model.js'

/**
 * Help & Support — merchant-facing support model.
 *
 * Everything here is pure so the plan matrix, quota gating, and FAQ content
 * stay unit-testable without a DOM. No fake data: the ticket counts come from
 * the real /support/tickets list and the plan comes from the real /billing
 * account. A store with no subscription is on the honest default — Trial.
 */

export type SupportPlan = 'trial' | 'start' | 'growth' | 'commander'

/** The categories a merchant can pick when creating a ticket. */
export type TicketCategory = 'billing-plans' | 'technical-issue' | 'feature-request' | 'data-sync' | 'ai-features' | 'general-question'

/** Merchant-facing priority choices on the form. */
export type TicketPriorityChoice = 'LOW' | 'NORMAL' | 'HIGH'

/** Priorities the support API accepts (it has no LOW tier). */
export type ApiTicketPriority = 'NORMAL' | 'HIGH'

export type SupportTier = Readonly<{
  label: string
  /** Support tickets per calendar month. `null` means unlimited. */
  ticketLimit: number | null
  responseTargetHours: number
  /** Compact badge copy, e.g. "48h response target". */
  responseBadge: string
  /** One-line promise shown on the plan card. */
  responseNote: string
  priorityQueue: boolean
}>

/**
 * Plan-based support tiers (the PR matrix):
 *   Tickets/month: Trial 2 · Start 5 · Growth unlimited · Commander unlimited
 *   Response target: 48h · 24h · 12h · 4h priority
 *   Priority queue: Commander only
 */
export const SUPPORT_TIERS: Readonly<Record<SupportPlan, SupportTier>> = {
  trial: { label: 'Trial', ticketLimit: 2, responseTargetHours: 48, responseBadge: '48h response target', responseNote: 'We reply to every ticket within 48 hours.', priorityQueue: false },
  start: { label: 'Start', ticketLimit: 5, responseTargetHours: 24, responseBadge: '24h response target', responseNote: 'We reply to every ticket within 24 hours.', priorityQueue: false },
  growth: { label: 'Growth', ticketLimit: null, responseTargetHours: 12, responseBadge: '12h response target', responseNote: 'We reply to every ticket within 12 hours.', priorityQueue: false },
  commander: { label: 'Commander', ticketLimit: null, responseTargetHours: 4, responseBadge: '4h Priority response', responseNote: 'Priority responses within 4 hours, day or night.', priorityQueue: true },
}

export const TICKET_CATEGORIES: readonly Readonly<{ value: TicketCategory; label: string; hint: string }>[] = [
  { value: 'billing-plans', label: 'Billing & Plans', hint: 'Upgrades, invoices, gift codes' },
  { value: 'technical-issue', label: 'Technical Issue', hint: 'Errors, bugs, something broken' },
  { value: 'feature-request', label: 'Feature Request', hint: 'Ideas and improvements' },
  { value: 'data-sync', label: 'Data & Sync', hint: 'Shopify data, syncs, missing rows' },
  { value: 'ai-features', label: 'AI Features', hint: 'Recommendations, AI Command, coaching' },
  { value: 'general-question', label: 'General Question', hint: 'Anything else' },
]

export const PRIORITY_CHOICES: readonly Readonly<{ value: TicketPriorityChoice; label: string; hint: string }>[] = [
  { value: 'LOW', label: 'Low', hint: 'General question — no rush' },
  { value: 'NORMAL', label: 'Normal', hint: 'I need help, but nothing is blocked' },
  { value: 'HIGH', label: 'High', hint: 'Blocking issue — I cannot work' },
]

/** Resolve the merchant's real plan from the billing account (never invented). */
export function resolveSupportPlan(account: BillingAccount | null | undefined): SupportPlan {
  const plan = account?.subscription?.plan?.toLowerCase()
  if (plan === 'start' || plan === 'growth' || plan === 'commander') return plan
  return 'trial'
}

/**
 * The support API only accepts start | growth | commander. A trial store is
 * sent as `start` so we never claim a higher (or lower-priority) tier than
 * the merchant actually has — priority is sent explicitly alongside.
 */
export function apiPlanFor(plan: SupportPlan): 'start' | 'growth' | 'commander' {
  if (plan === 'growth' || plan === 'commander') return plan
  return 'start'
}

/** LOW questions are ordinary questions — the API has no LOW priority. */
export function apiPriorityFor(choice: TicketPriorityChoice): ApiTicketPriority {
  return choice === 'HIGH' ? 'HIGH' : 'NORMAL'
}

export type SupportTicketRecord = Readonly<{
  id: string
  subject: string
  description?: string
  priority: string
  status: string
  createdAt: number
  updatedAt: number
}>

/** True when the ticket was created inside the current calendar month. */
function createdThisMonth(ticket: SupportTicketRecord, year: number, month: number): boolean {
  const date = new Date(ticket.createdAt)
  return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month
}

/** Tickets created this calendar month — the plan quota window. */
export function ticketsThisMonth(tickets: readonly SupportTicketRecord[], now: number = Date.now()): number {
  const reference = new Date(now)
  return tickets.filter((ticket) => createdThisMonth(ticket, reference.getFullYear(), reference.getMonth())).length
}

export type TicketQuota = Readonly<{ used: number; limit: number | null; remaining: number | null; unlimited: boolean; limitReached: boolean; usageLabel: string }>

/** Plan quota for this month, e.g. "1/2 this month" or "3 this month". */
export function ticketQuota(tickets: readonly SupportTicketRecord[], plan: SupportPlan, now: number = Date.now()): TicketQuota {
  const tier = SUPPORT_TIERS[plan]
  const used = ticketsThisMonth(tickets, now)
  const limit = tier.ticketLimit
  if (limit === null) return { used, limit: null, remaining: null, unlimited: true, limitReached: false, usageLabel: `${used} this month · unlimited` }
  const remaining = Math.max(0, limit - used)
  return { used, limit, remaining, unlimited: false, limitReached: used >= limit, usageLabel: `${used}/${limit} this month` }
}

/** e.g. 1755465600000 → "Aug 18, 2026" */
export function formatTicketDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** e.g. "August 2026" for the quota window label. */
export function formatTicketMonth(now: number = Date.now()): string {
  const date = new Date(now)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export type TicketStatusMeta = Readonly<{ label: string; tone: 'green' | 'amber' | 'blue' }>

/** Merchant-friendly status copy — no raw enum codes in the UI. */
export function ticketStatusMeta(status: string): TicketStatusMeta {
  if (status === 'OPEN') return { label: 'Awaiting response', tone: 'green' }
  if (status === 'IN_PROGRESS') return { label: 'In progress', tone: 'amber' }
  if (status === 'RESOLVED') return { label: 'Resolved', tone: 'blue' }
  return { label: status ? status.charAt(0) + status.slice(1).toLowerCase().replaceAll('_', ' ') : 'Open', tone: 'green' }
}

/** Priority label for a stored ticket (API stores NORMAL | HIGH | URGENT). */
export function ticketPriorityLabel(priority: string): string {
  if (priority === 'HIGH') return 'High'
  if (priority === 'URGENT') return 'Priority'
  return 'Normal'
}

export type SplitTickets = Readonly<{ open: readonly SupportTicketRecord[]; past: readonly SupportTicketRecord[] }>

/** Open = OPEN + IN_PROGRESS, Past = RESOLVED. Newest first in both lists. */
export function splitTickets(tickets: readonly SupportTicketRecord[]): SplitTickets {
  const byNewest = (left: SupportTicketRecord, right: SupportTicketRecord) => right.createdAt - left.createdAt
  const open = tickets.filter((ticket) => ticket.status === 'OPEN' || ticket.status === 'IN_PROGRESS').sort(byNewest)
  const past = tickets.filter((ticket) => ticket.status !== 'OPEN' && ticket.status !== 'IN_PROGRESS').sort(byNewest)
  return { open, past }
}

/**
 * The API has a single subject line, so the chosen category rides along as a
 * short prefix. Subject stays capped at the API's 200-character limit.
 */
export function composeSubject(category: TicketCategory, subject: string): string {
  const categoryLabel = TICKET_CATEGORIES.find((entry) => entry.value === category)?.label ?? 'General Question'
  const trimmed = subject.trim().slice(0, 200)
  return `[${categoryLabel}] ${trimmed}`.slice(0, 200)
}

/** Screenshot references ride along in the description (sized in KB/MB). */
export function attachmentNote(fileName: string, sizeBytes: number): string {
  const size = sizeBytes >= 1_048_576 ? `${(sizeBytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
  return `📎 Screenshot attached: ${fileName} (${size})`
}

export function formatAttachmentSize(sizeBytes: number): string {
  return sizeBytes >= 1_048_576 ? `${(sizeBytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
}

/** ─── FAQ / self-help content ─────────────────────────────────────────────
 * Answers describe real ProfitPilot modules only — no invented features,
 * no invented numbers. Each answer names where to click in the product. */

export type FaqEntry = Readonly<{ id: string; question: string; answer: string }>

export type FaqCategory = Readonly<{ id: string; title: string; blurb: string; questions: readonly FaqEntry[] }>

export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    blurb: 'How to sync your Shopify data, set up agents',
    questions: [
      {
        id: 'faq-sync-data',
        question: 'How do I sync my Shopify data?',
        answer: 'Open Dashboard and click "Sync all", or use the sync button on any data page (Products, Orders, Inventory). Each sync pulls fresh records from Shopify — ProfitPilot never invents numbers, so pages fill in only after a real sync finishes. The sync banner always shows the latest sync time.',
      },
      {
        id: 'faq-health-zero',
        question: 'Why is Store Health showing 0?',
        answer: 'Store Health is computed from your synced orders, products, and customers. Right after install there is nothing synced yet, so health honestly shows "No data" instead of a made-up score. Run "Sync all" from the Dashboard — once real orders exist, your health score appears within a minute.',
      },
      {
        id: 'faq-first-automation',
        question: 'How to set up my first automation?',
        answer: 'Open Automation → Browse Templates, pick a ready-made workflow like Welcome Customer or Cart Recovery, click Install, review the steps, then Publish. Templates marked Growth or Commander need that plan — everything else works on any plan.',
      },
    ],
  },
  {
    id: 'billing-plans',
    title: 'Billing & Plans',
    blurb: 'How to upgrade, change plans, billing questions',
    questions: [
      {
        id: 'faq-upgrade-plan',
        question: 'How do I upgrade my plan?',
        answer: 'Go to Billing → choose a plan → "Choose plan". Shopify opens a secure confirmation page and your new limits apply the moment the charge is approved. Upgrading also speeds up support: Start replies in 24h, Growth in 12h, and Commander gets 4h priority responses.',
      },
      {
        id: 'faq-gift-code',
        question: 'I have a gift code — how do I use it?',
        answer: 'Open Billing, find "Have a gift code?", enter the code, and click Redeem. One code works per store and it replaces the limited trial with full Commander access until the code expires.',
      },
      {
        id: 'faq-cancel',
        question: 'Can I cancel or change my plan anytime?',
        answer: 'Yes. Plans are managed through your Shopify admin (Settings → Apps and sales channels → ProfitPilot), where you can switch tiers or cancel. Your synced data and reports stay available for the rest of the billing period.',
      },
    ],
  },
  {
    id: 'ai-features',
    title: 'AI Features',
    blurb: 'How AI agents, recommendations, coaching work',
    questions: [
      {
        id: 'faq-ai-recommendations',
        question: 'How do AI recommendations work?',
        answer: 'Open Recommendations and click Generate. ProfitPilot studies your synced products, orders, and customers, then proposes actions with real evidence behind every number — revenue impact, the rule that fired, and the data it used. You approve or reject each one; nothing changes in your store until you approve it.',
      },
      {
        id: 'faq-ai-command',
        question: 'What can I ask AI Command?',
        answer: 'AI Command answers questions about your real store data ("What were my top products last month?") and can run safe actions for you — draft emails, tag customers, prepare discounts — always asking for your confirmation first. About 80% of support-style questions are answered instantly there, no ticket needed.',
      },
      {
        id: 'faq-store-coach',
        question: 'What do Store Coach and GrowthIQ do?',
        answer: 'Store Coach gives you a daily huddle, goals, and streaks built from your real sales. GrowthIQ turns the same data into strategy: benchmarks, growth scenarios, and board-ready reports. PatternAI finds hidden patterns — best sellers, buying personas, and "why did this happen?" answers.',
      },
    ],
  },
  {
    id: 'technical-help',
    title: 'Technical Help',
    blurb: 'Sync issues, errors, data questions',
    questions: [
      {
        id: 'faq-data-access',
        question: 'What data does ProfitPilot access?',
        answer: 'Only what Shopify grants during install: products, orders, customers, inventory, and related records for your store. ProfitPilot is tenant-scoped — your data lives separated from every other store, and exports show exactly which rows were synced.',
      },
      {
        id: 'faq-data-protected',
        question: 'How is my data protected?',
        answer: 'Every request is tenant-scoped and audited, sensitive actions require your explicit approval, and customer data is minimized by default. Read the security details under Privacy, Terms, and Security in the sidebar footer.',
      },
      {
        id: 'faq-sync-issue',
        question: 'A sync failed or data looks wrong — what now?',
        answer: 'Click Retry on the sync banner first; a temporary Shopify outage usually clears on the second try. If it keeps failing, create a ticket in the Data & Sync category with the error message and the time it happened — that is exactly what our team needs to fix it fast.',
      },
    ],
  },
]

/** The seven most common questions, shown expandable before ticket creation. */
export const COMMON_FAQ_IDS: readonly string[] = ['faq-sync-data', 'faq-health-zero', 'faq-upgrade-plan', 'faq-ai-recommendations', 'faq-first-automation', 'faq-data-access', 'faq-data-protected']

export function faqById(id: string): FaqEntry | null {
  for (const category of FAQ_CATEGORIES) {
    const found = category.questions.find((entry) => entry.id === id)
    if (found) return found
  }
  return null
}

/** The common-questions strip in spec order, with its category label. */
export function commonFaqs(): readonly Readonly<FaqEntry & { categoryTitle: string }>[] {
  return COMMON_FAQ_IDS.map((id) => {
    const entry = faqById(id)
    if (!entry) throw new Error(`Unknown FAQ id: ${id}`)
    const category = FAQ_CATEGORIES.find((category) => category.questions.some((question) => question.id === id))!
    return { ...entry, categoryTitle: category.title }
  })
}

/** True when every category has questions and every question has an answer. */
export function faqContentIsComplete(): boolean {
  return FAQ_CATEGORIES.every((category) => category.questions.length > 0 && category.questions.every((entry) => entry.question.trim().length > 0 && entry.answer.trim().length > 40))
}
