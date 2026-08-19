import { describe, expect, it } from 'vitest'
import {
  FAQ_CATEGORIES,
  COMMON_FAQ_IDS,
  PRIORITY_CHOICES,
  SUPPORT_TIERS,
  TICKET_CATEGORIES,
  apiPlanFor,
  apiPriorityFor,
  attachmentNote,
  commonFaqs,
  composeSubject,
  faqById,
  faqContentIsComplete,
  formatAttachmentSize,
  formatTicketDate,
  formatTicketMonth,
  resolveSupportPlan,
  splitTickets,
  ticketPriorityLabel,
  ticketQuota,
  ticketStatusMeta,
  ticketsThisMonth,
} from './support-model.js'
import type { SupportTicketRecord } from './support-model.js'

/** Fixed "now" so month-window tests never depend on the wall clock: Aug 19, 2026. */
const NOW = Date.parse('2026-08-19T12:00:00.000Z')

const ticket = (overrides: Partial<SupportTicketRecord> = {}): SupportTicketRecord => ({
  id: 'ticket-1',
  subject: 'Billing question',
  description: 'How do I see my invoices?',
  priority: 'NORMAL',
  status: 'OPEN',
  createdAt: Date.parse('2026-08-18T10:00:00.000Z'),
  updatedAt: Date.parse('2026-08-18T10:00:00.000Z'),
  ...overrides,
})

describe('Help & Support plan tiers (FIX 4)', () => {
  it('matches the PR support matrix for every plan', () => {
    expect(SUPPORT_TIERS.trial).toMatchObject({ label: 'Trial', ticketLimit: 2, responseTargetHours: 48, priorityQueue: false })
    expect(SUPPORT_TIERS.start).toMatchObject({ label: 'Start', ticketLimit: 5, responseTargetHours: 24, priorityQueue: false })
    expect(SUPPORT_TIERS.growth).toMatchObject({ label: 'Growth', ticketLimit: null, responseTargetHours: 12, priorityQueue: false })
    expect(SUPPORT_TIERS.commander).toMatchObject({ label: 'Commander', ticketLimit: null, responseTargetHours: 4, priorityQueue: true })
  })

  it('shows the correct response badge per plan (Trial must be 48h, never 24h)', () => {
    expect(SUPPORT_TIERS.trial.responseBadge).toBe('48h response target')
    expect(SUPPORT_TIERS.start.responseBadge).toBe('24h response target')
    expect(SUPPORT_TIERS.growth.responseBadge).toBe('12h response target')
    expect(SUPPORT_TIERS.commander.responseBadge).toBe('4h Priority response')
    for (const key of ['start', 'growth', 'commander'] as const) expect(SUPPORT_TIERS[key].responseBadge).not.toContain('48h')
  })

  it('resolves the plan from the real billing account and defaults to Trial', () => {
    expect(resolveSupportPlan(null)).toBe('trial')
    expect(resolveSupportPlan({ subscription: null, trial: { expiresAt: NOW, state: 'ACTIVE' }, gift: null })).toBe('trial')
    expect(resolveSupportPlan({ subscription: { plan: 'start', state: 'ACTIVE_MONTHLY', currentPeriodEnd: null, version: 0 }, trial: null, gift: null })).toBe('start')
    expect(resolveSupportPlan({ subscription: { plan: 'growth', state: 'ACTIVE_MONTHLY', currentPeriodEnd: null, version: 0 }, trial: null, gift: null })).toBe('growth')
    expect(resolveSupportPlan({ subscription: { plan: 'commander', state: 'GIFT_ACCESS_UNLIMITED', currentPeriodEnd: null, version: 0 }, trial: null, gift: null })).toBe('commander')
    expect(resolveSupportPlan({ subscription: { plan: 'SOMETHING_ELSE', state: 'ACTIVE_MONTHLY', currentPeriodEnd: null, version: 0 }, trial: null, gift: null })).toBe('trial')
  })
})

describe('monthly ticket quota (plan restrictions enforced)', () => {
  it('counts only tickets created in the current calendar month', () => {
    const august = ticket()
    const july = ticket({ id: 'july', createdAt: Date.parse('2026-07-31T23:00:00.000Z') })
    expect(ticketsThisMonth([august, july], NOW)).toBe(1)
    expect(ticketsThisMonth([], NOW)).toBe(0)
  })

  it('enforces the Trial limit of 2 tickets per month', () => {
    const one = ticketQuota([ticket()], 'trial', NOW)
    expect(one).toMatchObject({ used: 1, limit: 2, remaining: 1, unlimited: false, limitReached: false })
    expect(one.usageLabel).toBe('1/2 this month')
    const two = ticketQuota([ticket(), ticket({ id: 't2' })], 'trial', NOW)
    expect(two).toMatchObject({ used: 2, remaining: 0, limitReached: true })
    expect(two.usageLabel).toBe('2/2 this month')
  })

  it('enforces the Start limit of 5 tickets per month', () => {
    const four = ticketQuota([ticket(), ticket({ id: 't2' }), ticket({ id: 't3' }), ticket({ id: 't4' })], 'start', NOW)
    expect(four).toMatchObject({ used: 4, limit: 5, remaining: 1, limitReached: false })
    const five = ticketQuota([ticket(), ticket({ id: 't2' }), ticket({ id: 't3' }), ticket({ id: 't4' }), ticket({ id: 't5' })], 'start', NOW)
    expect(five.limitReached).toBe(true)
  })

  it('never blocks Growth and Commander (unlimited)', () => {
    const many = Array.from({ length: 30 }, (_, index) => ticket({ id: `t${index}` }))
    for (const plan of ['growth', 'commander'] as const) {
      const quota = ticketQuota(many, plan, NOW)
      expect(quota).toMatchObject({ unlimited: true, limit: null, limitReached: false })
      expect(quota.usageLabel).toBe('30 this month · unlimited')
    }
  })

  it('last month’s tickets do not consume this month’s quota', () => {
    const usedUp = [ticket({ id: 'july-1', createdAt: Date.parse('2026-07-02T10:00:00.000Z') }), ticket({ id: 'july-2', createdAt: Date.parse('2026-07-03T10:00:00.000Z') })]
    expect(ticketQuota(usedUp, 'trial', NOW).limitReached).toBe(false)
  })
})

describe('ticket form helpers (FIX 5)', () => {
  it('offers exactly the six merchant categories', () => {
    expect(TICKET_CATEGORIES.map((entry) => entry.label)).toEqual(['Billing & Plans', 'Technical Issue', 'Feature Request', 'Data & Sync', 'AI Features', 'General Question'])
  })

  it('offers Low / Normal / High priorities with merchant hints', () => {
    expect(PRIORITY_CHOICES.map((choice) => choice.label)).toEqual(['Low', 'Normal', 'High'])
    expect(PRIORITY_CHOICES[0]?.hint).toMatch(/general question/i)
    expect(PRIORITY_CHOICES[2]?.hint).toMatch(/blocking/i)
  })

  it('maps merchant priorities onto API-safe values', () => {
    expect(apiPriorityFor('LOW')).toBe('NORMAL')
    expect(apiPriorityFor('NORMAL')).toBe('NORMAL')
    expect(apiPriorityFor('HIGH')).toBe('HIGH')
  })

  it('never claims a higher API plan than the merchant has (trial sends start)', () => {
    expect(apiPlanFor('trial')).toBe('start')
    expect(apiPlanFor('start')).toBe('start')
    expect(apiPlanFor('growth')).toBe('growth')
    expect(apiPlanFor('commander')).toBe('commander')
  })

  it('prefixes the category into the subject and caps it at 200 characters', () => {
    expect(composeSubject('billing-plans', 'How do I upgrade?')).toBe('[Billing & Plans] How do I upgrade?')
    const long = 'x'.repeat(300)
    expect(composeSubject('general-question', long).length).toBeLessThanOrEqual(200)
    expect(composeSubject('general-question', '   trimmed   ')).toBe('[General Question] trimmed')
  })

  it('formats attachment notes and sizes honestly', () => {
    expect(attachmentNote('error.png', 204_800)).toBe('📎 Screenshot attached: error.png (200 KB)')
    expect(attachmentNote('sync.png', 2 * 1_048_576)).toContain('2.0 MB')
    expect(formatAttachmentSize(500)).toBe('1 KB')
  })
})

describe('ticket history helpers (FIX 6)', () => {
  it('splits open and past tickets, newest first', () => {
    const older = ticket({ id: 'older', createdAt: Date.parse('2026-08-10T10:00:00.000Z') })
    const newer = ticket({ id: 'newer', createdAt: Date.parse('2026-08-18T10:00:00.000Z') })
    const resolved = ticket({ id: 'resolved', status: 'RESOLVED', createdAt: Date.parse('2026-08-01T10:00:00.000Z') })
    const inProgress = ticket({ id: 'wip', status: 'IN_PROGRESS', createdAt: Date.parse('2026-08-15T10:00:00.000Z') })
    const split = splitTickets([older, resolved, newer, inProgress])
    expect(split.open.map((entry) => entry.id)).toEqual(['newer', 'wip', 'older'])
    expect(split.past.map((entry) => entry.id)).toEqual(['resolved'])
  })

  it('uses merchant-friendly status copy', () => {
    expect(ticketStatusMeta('OPEN')).toEqual({ label: 'Awaiting response', tone: 'green' })
    expect(ticketStatusMeta('IN_PROGRESS')).toEqual({ label: 'In progress', tone: 'amber' })
    expect(ticketStatusMeta('RESOLVED')).toEqual({ label: 'Resolved', tone: 'blue' })
    expect(ticketStatusMeta('WEIRD')).toEqual({ label: 'Weird', tone: 'green' })
  })

  it('labels stored priorities without jargon', () => {
    expect(ticketPriorityLabel('NORMAL')).toBe('Normal')
    expect(ticketPriorityLabel('HIGH')).toBe('High')
    expect(ticketPriorityLabel('URGENT')).toBe('Priority')
  })

  it('formats dates like "Aug 18, 2026" and survives bad input', () => {
    expect(formatTicketDate(Date.parse('2026-08-18T10:00:00.000Z'))).toMatch(/^Aug 18, 2026$/)
    expect(formatTicketDate(Number.NaN)).toBe('—')
    expect(formatTicketMonth(NOW)).toMatch(/^August 2026$/)
  })
})

describe('FAQ content (FIX 2)', () => {
  it('ships the four promised categories', () => {
    expect(FAQ_CATEGORIES.map((category) => category.title)).toEqual(['Getting Started', 'Billing & Plans', 'AI Features', 'Technical Help'])
    expect(FAQ_CATEGORIES.every((category) => category.blurb.length > 10)).toBe(true)
  })

  it('lists the seven common questions from the spec in order', () => {
    expect(commonFaqs().map((entry) => entry.question)).toEqual([
      'How do I sync my Shopify data?',
      'Why is Store Health showing 0?',
      'How do I upgrade my plan?',
      'How do AI recommendations work?',
      'How to set up my first automation?',
      'What data does ProfitPilot access?',
      'How is my data protected?',
    ])
    expect(COMMON_FAQ_IDS).toHaveLength(7)
  })

  it('answers every question with real product guidance (no placeholders)', () => {
    expect(faqContentIsComplete()).toBe(true)
    expect(faqById('faq-upgrade-plan')?.answer).toContain('Billing')
    expect(faqById('faq-data-protected')?.answer).toMatch(/tenant-scoped/i)
    const allAnswers = FAQ_CATEGORIES.flatMap((category) => category.questions.map((entry) => entry.answer))
    expect(allAnswers.every((answer) => !/lorem|TODO|coming soon\./i.test(answer))).toBe(true)
  })

  it('keeps every common question findable in a category', () => {
    for (const entry of commonFaqs()) expect(FAQ_CATEGORIES.some((category) => category.title === entry.categoryTitle)).toBe(true)
  })
})
