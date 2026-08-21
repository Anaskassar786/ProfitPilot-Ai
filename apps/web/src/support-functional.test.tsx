// @vitest-environment jsdom
import './jsdom-polaris-setup.js'
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HelpSupportPage } from './support.js'
import type { SupportToast } from './support.js'
import { AppProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json' with { type: 'json' }


/**
 * Functional test pass for the Help & Support redesign — the PR checklist
 * made executable: ticket creation form, category + priority selection,
 * subject/description validation, submit, list refresh, plan gating, the
 * Upgrade Plan route, FAQ expansion, the AI Command redirect, and zero
 * console errors. The component is mounted against a fully mocked, honest
 * backend envelope ({ ok, data, requestId }) — no fake data in the product.
 */

const consoleErrors: string[] = []
let root: Root | null = null
let container: HTMLDivElement | null = null

const ENVELOPE = (data: unknown): unknown => ({ ok: true, data, requestId: 'support-test' })

const trialAccount = { subscription: null, trial: { expiresAt: Date.now() + 86_400_000 * 7, state: 'ACTIVE' }, gift: null }

type BackendState = {
  tickets: readonly unknown[]
  billing: unknown
  created: unknown[]
  navigation: string[]
  billingNavigation: number
}

let backend: BackendState

function ticketFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ticket-1',
    shopId: 'store-1',
    subject: '[Billing & Plans] How do invoices work?',
    description: 'Where can I see my charges?',
    priority: 'NORMAL',
    status: 'OPEN',
    version: 0,
    createdAt: Date.now() - 3_600_000,
    updatedAt: Date.now() - 3_600_000,
    ...overrides,
  }
}

function mockBackend(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.includes('/support/tickets') && (init?.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'))
      backend.created.push(body)
      const record = ticketFixture({ id: 'ticket-created', ...body, createdAt: Date.now(), updatedAt: Date.now() })
      backend.tickets = [...backend.tickets, record]
      return json(201, ENVELOPE(record))
    }
    if (url.includes('/support/tickets')) return json(200, ENVELOPE(backend.tickets))
    if (url.includes('/billing')) return json(200, ENVELOPE(backend.billing))
    return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} } })
  }))
}

const findButton = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes(text)) as HTMLButtonElement | undefined

const click = async (text: string): Promise<void> => {
  const button = findButton(text)
  expect(button, `button containing "${text}"`).toBeTruthy()
  await act(async () => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

const fill = async (placeholder: string, value: string): Promise<void> => {
  const field = [...document.querySelectorAll('input, textarea')].find((element) => element.getAttribute('placeholder')?.includes(placeholder))
  expect(field, `field with placeholder "${placeholder}"`).toBeTruthy()
  // jsdom + React controlled inputs need the native value setter so React's
  // value tracker registers the change before the input event.
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!
  await act(async () => {
    setter.call(field, value)
    field!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function mountPage(context: Readonly<{ storeId: string | null; shop: string | null }> = { storeId: 'store-1', shop: 'demo.myshopify.com' }): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(StrictMode, null, createElement(AppProvider, { i18n: enTranslations as never }, createElement(HelpSupportPage, {
      context,
      onToast: () => {},
      onNavigate: (page) => backend.navigation.push(page),
      onNavigateBilling: () => { backend.billingNavigation += 1 },
    }))))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

beforeEach(() => {
  consoleErrors.length = 0
  backend = { tickets: [], billing: trialAccount, created: [], navigation: [], billingNavigation: 0 }
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const originalError = console.error
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '))
    originalError(...args)
  })
  mockBackend()
})

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount())
    root = null
  }
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('Help & Support page load', () => {
  it('renders without console errors (both data paths settle)', async () => {
    await mountPage()
    expect(consoleErrors).toEqual([])
    expect(document.querySelector('.support-workspace')).toBeTruthy()
    expect(document.querySelector('.support-header-copy')?.textContent).toContain('Help & Support')
  })

  it('shows the plan card from the real billing account (Trial, 0/2, 48h)', async () => {
    await mountPage()
    const card = document.querySelector('.support-plan-card')
    expect(card?.textContent).toContain('Trial')
    expect(card?.textContent).toContain('0/2 this month')
    expect(card?.textContent).toContain('48h response target')
  })

  it('reflects a Growth subscription with unlimited tickets and 12h target', async () => {
    backend.billing = { subscription: { plan: 'growth', state: 'ACTIVE_MONTHLY', currentPeriodEnd: null, version: 0 }, trial: null, gift: null }
    await mountPage()
    const card = document.querySelector('.support-plan-card')
    expect(card?.textContent).toContain('Growth')
    expect(card?.textContent).toContain('unlimited')
    expect(card?.textContent).toContain('12h response target')
  })
})

describe('FAQ interactions', () => {
  it('expands a common question and shows its answer', async () => {
    await mountPage()
    expect(document.querySelector('.support-faq-answer')).toBeNull()
    await click('How do I sync my Shopify data?')
    expect(document.querySelector('.support-faq-answer')?.textContent).toContain('Sync all')
  })

  it('expands the full FAQ library via "View all FAQs"', async () => {
    await mountPage()
    await click('View all FAQs')
    expect(document.querySelectorAll('.support-faq-group')).toHaveLength(4)
    // Collapsed again hides the full library.
    await click('Show common questions')
    expect(document.querySelectorAll('.support-faq-group')).toHaveLength(0)
    expect(document.querySelectorAll('.support-faq-item').length).toBeGreaterThanOrEqual(7)
  })

  it('routes "Ask AI Command" to the AI Command surface', async () => {
    await mountPage()
    await click('Ask AI Command')
    expect(backend.navigation).toEqual(['ai-command'])
  })
})

describe('empty state options (FIX 3)', () => {
  it('celebrates "All Clear!" with the three fastest help options once loading settles', async () => {
    await mountPage()
    const empty = document.querySelector('.support-empty')
    expect(empty?.textContent).toContain('All Clear! No open tickets.')
    expect(empty?.textContent).toContain('Your store is running smoothly')
    expect(empty?.textContent).toContain('Need help with something? Choose the fastest option')
    expect(empty?.textContent).toContain('Ask AI Command')
    expect(empty?.textContent).toContain('Browse FAQs')
    expect(empty?.textContent).toContain('New Ticket')
    expect(empty?.textContent).toContain('Instant answers about your store')
    expect(empty?.textContent).toContain('Complex issues need human support')
    expect(empty?.textContent).toContain('AI Command can answer 80% of questions instantly')
    // The loading card is gone by now — only truthful states paint.
    expect(document.querySelector('.support-loading')).toBeNull()
  })

  it('opens the ticket form from the "New Ticket" option', async () => {
    await mountPage()
    await click('New Ticket')
    expect(document.querySelector('.support-form-card')).toBeTruthy()
  })

  it('focuses the FAQ from "Browse FAQs"', async () => {
    await mountPage()
    await click('Browse FAQs')
    expect(document.querySelectorAll('.support-faq-group')).toHaveLength(4)
  })
})

describe('ticket creation (FIX 5)', () => {
  it('opens the form from the header and submits a complete ticket', async () => {
    await mountPage()
    await click('New ticket')
    expect(document.querySelector('.support-form-card')?.textContent).toContain('CREATE SUPPORT TICKET')

    // Category via the shared custom listbox.
    await act(async () => { findButton('General Question')?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const billingOption = [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent?.includes('Billing & Plans'))
    expect(billingOption).toBeTruthy()
    await act(async () => { billingOption!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    // Priority: High (blocking issue).
    await click('High')
    expect(findButton('Submit Ticket')).toBeTruthy()

    await fill('Brief description of your issue', 'Invoices are missing')
    await fill('Describe your issue in detail', 'The billing page shows no invoices for August.')

    await click('Submit Ticket')
    expect(consoleErrors).toEqual([])
    expect(backend.created).toHaveLength(1)
    const body = backend.created[0] as Record<string, string>
    expect(body.subject).toBe('[Billing & Plans] Invoices are missing')
    expect(body.priority).toBe('HIGH')
    // Trial sends the honest API plan — never a fabricated higher tier.
    expect(body.plan).toBe('start')
    expect(body.description).toContain('The billing page shows no invoices for August.')
    // Form closes after success and the ticket appears in the list (FIX 8 checklist).
    expect(document.querySelector('.support-form-card')).toBeNull()
    const history = document.querySelector('.support-tickets')
    expect(history?.textContent).toContain('YOUR TICKETS')
    expect(history?.textContent).toContain('1 open ticket')
    expect(history?.textContent).toContain('[Billing & Plans] Invoices are missing')
  })

  it('blocks submission without subject or description', async () => {
    await mountPage()
    await click('New ticket')
    await click('Submit Ticket')
    expect(backend.created).toHaveLength(0)
    expect(document.querySelector('.support-form-card')).toBeTruthy()
  })

  it('shows the created ticket in YOUR TICKETS after refresh', async () => {
    backend.tickets = [ticketFixture()]
    await mountPage()
    const history = document.querySelector('.support-tickets')
    expect(history?.textContent).toContain('YOUR TICKETS')
    expect(history?.textContent).toContain('1 open ticket')
    expect(history?.textContent).toContain('[Billing & Plans] How do invoices work?')
    const expectedDate = new Date(Date.now() - 3_600_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    expect(history?.textContent).toContain(`Created: ${expectedDate}`)
    expect(history?.textContent).toContain('Priority: Normal')
    expect(history?.textContent).toContain('Awaiting response')
    expect(history?.textContent).toContain('No resolved tickets yet.')
  })

  it('expands ticket details with View-style disclosure', async () => {
    backend.tickets = [ticketFixture({ description: 'Full story of the problem.' })]
    await mountPage()
    expect(document.querySelector('.support-ticket-details')).toBeNull()
    await click('How do invoices work?')
    const details = document.querySelector('.support-ticket-details')
    expect(details?.textContent).toContain('Full story of the problem.')
    expect(details?.textContent).toContain('48h response target')
  })

  it('separates resolved tickets into Past Tickets', async () => {
    backend.tickets = [ticketFixture(), ticketFixture({ id: 't2', subject: 'Old question', status: 'RESOLVED', updatedAt: Date.now() - 7_200_000 })]
    await mountPage()
    const past = document.querySelector('.support-past-tickets')
    expect(past?.textContent).toContain('Old question')
    expect(past?.textContent).toContain('Resolved')
    const open = document.querySelector('.support-ticket-list')
    expect(open?.textContent).not.toContain('Old question')
  })
})

describe('plan restrictions enforced (FIX 4)', () => {
  it('blocks the form at the Trial limit and routes Upgrade Plan to billing', async () => {
    backend.tickets = [ticketFixture(), ticketFixture({ id: 't2' })]
    await mountPage()
    expect(document.querySelector('.support-plan-card')?.textContent).toContain('2/2 this month')
    await click('New ticket')
    const blocked = document.querySelector('.support-form-blocked')
    expect(blocked?.textContent).toContain('Monthly ticket limit reached')
    expect(document.querySelector('.support-form-grid')).toBeNull()
    const upgrade = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === 'Upgrade Plan')
    expect(upgrade).toBeTruthy()
    await act(async () => { upgrade!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(backend.billingNavigation).toBe(1)
    expect(backend.created).toHaveLength(0)
  })

  it('always shows Upgrade Plan on the plan card for upgradeable plans', async () => {
    await mountPage()
    const upgrade = [...document.querySelectorAll('.support-plan-card button')].find((button) => (button.textContent ?? '').includes('Upgrade Plan'))
    expect(upgrade).toBeTruthy()
    await act(async () => { upgrade!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(backend.billingNavigation).toBe(1)
  })

  it('never blocks a Growth merchant with many tickets', async () => {
    backend.billing = { subscription: { plan: 'growth', state: 'ACTIVE_MONTHLY', currentPeriodEnd: null, version: 0 }, trial: null, gift: null }
    backend.tickets = Array.from({ length: 12 }, (_, index) => ticketFixture({ id: `t${index}`, subject: `Question ${index}` }))
    await mountPage()
    await click('New ticket')
    expect(document.querySelector('.support-form-grid')).toBeTruthy()
    expect(document.querySelector('.support-form-blocked')).toBeNull()
  })
})

describe('no store connected', () => {
  it('still answers FAQs but explains tickets need a store', async () => {
    await mountPage({ storeId: null, shop: null })
    expect(document.querySelector('.support-faq')).toBeTruthy()
    expect(document.querySelector('.support-empty-banner')?.textContent).toContain('Connect your Shopify store')
    await click('New Ticket')
    await click('Submit Ticket')
    expect(backend.created).toHaveLength(0)
  })
})
