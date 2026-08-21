// @vitest-environment jsdom
import './jsdom-polaris-setup.js'
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HelpSupportPage } from './support.js'
import { AppProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json' with { type: 'json' }


/**
 * Audit regression tests (2026-08-19 full inspection pass).
 *
 * AUDIT-2 through AUDIT-6 each FAILED on the old implementation and now guard
 * one of the shipped fixes; AUDIT-1 was verified correct during the audit and
 * is kept as a permanent guard of the escaping contract:
 *
 *  AUDIT-1  The description textarea's placeholder and the submitted
 *           screenshot note must use real line breaks — a future edit must
 *           never let literal "\n" escape sequences leak into the UI or the
 *           API payload.
 *  AUDIT-2  First paint claimed "All Clear!" while tickets were still
 *           loading (no loading state at all on first load).
 *  AUDIT-3  A failed tickets fetch still rendered the celebratory
 *           "All Clear — your store is running smoothly" empty state with
 *           no retry path — an error masquerading as success.
 *  AUDIT-4  Past-ticket rows were clickable buttons that did nothing —
 *           no details ever expanded beneath them.
 *  AUDIT-5  A category card's "Read" button blindly toggled the full
 *           library, collapsing it again when it was already open.
 *  AUDIT-6  The empty state offered no way to re-check tickets without a
 *           full page reload.
 */

const ENVELOPE = (data: unknown): unknown => ({ ok: true, data, requestId: 'audit-test' })
const trialAccount = { subscription: null, trial: { expiresAt: Date.now() + 86_400_000 * 7, state: 'ACTIVE' }, gift: null }

let root: Root | null = null
let container: HTMLDivElement | null = null
let fetchMock: ReturnType<typeof vi.fn>

function ticketFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ticket-1',
    shopId: 'store-1',
    subject: '[General Question] Where is my report?',
    description: 'I cannot find the weekly report.',
    priority: 'NORMAL',
    status: 'OPEN',
    version: 0,
    createdAt: Date.now() - 3_600_000,
    updatedAt: Date.now() - 3_600_000,
    ...overrides,
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function mockBackend(tickets: readonly unknown[] = []): void {
  fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url.includes('/support/tickets') && (init?.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'))
      return json(201, ENVELOPE(ticketFixture({ id: 'ticket-created', ...body })))
    }
    if (url.includes('/support/tickets')) return json(200, ENVELOPE(tickets))
    if (url.includes('/billing')) return json(200, ENVELOPE(trialAccount))
    return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} } })
  })
  vi.stubGlobal('fetch', fetchMock)
}

async function mount(settle = true): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(StrictMode, null, createElement(AppProvider, { i18n: enTranslations as never }, createElement(HelpSupportPage, {
      context: { storeId: 'store-1', shop: 'demo.myshopify.com' },
      onToast: () => {},
      onNavigate: () => {},
      onNavigateBilling: () => {},
    }))))
  })
  if (settle) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
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
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!
  await act(async () => {
    setter.call(field, value)
    field!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  if (root) { await act(async () => root!.unmount()); root = null }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('AUDIT-1: no literal escape sequences leak into the UI or the API payload', () => {
  it('the description textarea placeholder uses a real line break, not literal \\n', async () => {
    mockBackend()
    await mount()
    await click('New ticket')
    const textarea = document.querySelector('textarea')
    expect(textarea).toBeTruthy()
    expect(textarea!.placeholder).toContain('\n')
    expect(textarea!.placeholder).not.toContain('\\n')
  })

  it('submits the screenshot note separated by real newlines', async () => {
    mockBackend()
    const created: Record<string, string>[] = []
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      if (url.includes('/support/tickets') && (init?.method ?? 'GET') === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        created.push(body)
        return json(201, ENVELOPE(ticketFixture({ id: 'ticket-created', ...body })))
      }
      if (url.includes('/support/tickets')) return json(200, ENVELOPE([]))
      if (url.includes('/billing')) return json(200, ENVELOPE(trialAccount))
      return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} } })
    })
    await mount()
    await click('New ticket')
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'screenshot.png', { type: 'image/png' })
    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await fill('Brief description of your issue', 'Report missing')
    await fill('Describe your issue in detail', 'The weekly report never arrived.')
    await click('Submit Ticket')
    expect(created).toHaveLength(1)
    const submitted = created[0] as Record<string, string>
    expect(submitted.description).toContain('\n\n📎 Screenshot attached: screenshot.png')
    expect(submitted.description).not.toContain('\\n')
  })
})

describe('AUDIT-2: honest loading state on first paint', () => {
  it('shows a loading card instead of a premature "All Clear" while tickets load', async () => {
    let release: (value: Response) => void = () => {}
    const gate = new Promise<Response>((resolve) => { release = resolve })
    fetchMock = vi.fn((input: string | URL | Request): Promise<Response> => {
      const url = String(input)
      if (url.includes('/support/tickets')) return gate
      if (url.includes('/billing')) return Promise.resolve(json(200, ENVELOPE(trialAccount)))
      return Promise.resolve(json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await mount(false)
    expect(document.querySelector('.support-loading')).toBeTruthy()
    expect(document.querySelector('.support-empty')).toBeNull()
    expect(document.body.textContent).not.toContain('running smoothly')
    await act(async () => { release(json(200, ENVELOPE([]))); await gate })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    expect(document.querySelector('.support-loading')).toBeNull()
    expect(document.querySelector('.support-empty')).toBeTruthy()
  })
})

describe('AUDIT-3: a failed load never masquerades as "All Clear"', () => {
  it('shows an error card with a working retry instead of the celebration', async () => {
    let fail = true
    fetchMock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input)
      if (url.includes('/support/tickets')) {
        return fail
          ? json(500, { ok: false, error: { code: 'INTERNAL', message: 'boom', details: {} } })
          : json(200, ENVELOPE([ticketFixture()]))
      }
      if (url.includes('/billing')) return json(200, ENVELOPE(trialAccount))
      return json(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not mocked', details: {} } })
    })
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    expect(document.querySelector('.support-load-error')).toBeTruthy()
    expect(document.querySelector('.support-empty')).toBeNull()
    expect(document.body.textContent).not.toContain('running smoothly')
    fail = false
    await click('Try again')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    expect(document.querySelector('.support-load-error')).toBeNull()
    expect(document.querySelector('.support-ticket-list')?.textContent).toContain('Where is my report?')
  })
})

describe('AUDIT-4: past ticket rows actually expand', () => {
  it('reveals the resolved ticket details on click and collapses again', async () => {
    mockBackend([ticketFixture({ id: 't-old', subject: 'Old billing question', status: 'RESOLVED', description: 'Refund was issued.' })])
    await mount()
    const row = document.querySelector('.support-past-row') as HTMLButtonElement
    expect(row).toBeTruthy()
    expect(document.querySelector('.support-past-details')).toBeNull()
    await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const details = document.querySelector('.support-past-details')
    expect(details?.textContent).toContain('Refund was issued.')
    expect(details?.textContent).toContain('Resolved')
    expect(row.getAttribute('aria-expanded')).toBe('true')
    await act(async () => { row.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(document.querySelector('.support-past-details')).toBeNull()
  })
})

describe('AUDIT-5: category "Read" reliably opens the library', () => {
  it('keeps the full library open when already expanded', async () => {
    mockBackend()
    await mount()
    await click('View all FAQs')
    expect(document.querySelectorAll('.support-faq-group')).toHaveLength(4)
    const gettingStarted = [...document.querySelectorAll('.support-faq-category')].find((card) => card.textContent?.includes('Getting Started'))!
    const readButton = [...gettingStarted.querySelectorAll('button')].find((button) => button.textContent?.includes('Read'))!
    await act(async () => { readButton.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(document.querySelectorAll('.support-faq-group')).toHaveLength(4)
    const firstQuestion = findButton('How do I sync my Shopify data?')
    expect(firstQuestion?.getAttribute('aria-expanded')).toBe('true')
  })

  it('opens the full library and the first question from the collapsed view', async () => {
    mockBackend()
    await mount()
    expect(document.querySelectorAll('.support-faq-group')).toHaveLength(0)
    const billingCard = [...document.querySelectorAll('.support-faq-category')].find((card) => card.textContent?.includes('Billing & Plans'))!
    const readButton = [...billingCard.querySelectorAll('button')].find((button) => button.textContent?.includes('Read'))!
    await act(async () => { readButton.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(document.querySelectorAll('.support-faq-group')).toHaveLength(4)
    const firstQuestion = findButton('How do I upgrade my plan?')
    expect(firstQuestion?.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('AUDIT-6: the empty state can re-check for tickets', () => {
  it('re-requests tickets from the "Check again" action', async () => {
    mockBackend()
    await mount()
    expect(document.querySelector('.support-empty')).toBeTruthy()
    const ticketCallsBefore = fetchMock.mock.calls.filter(([input]) => String(input).includes('/support/tickets')).length
    await click('Check again')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    const ticketCallsAfter = fetchMock.mock.calls.filter(([input]) => String(input).includes('/support/tickets')).length
    expect(ticketCallsAfter).toBeGreaterThan(ticketCallsBefore)
  })
})
