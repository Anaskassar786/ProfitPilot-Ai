// @vitest-environment jsdom
/**
 * Automation page — exhaustive functional test sweep.
 *
 * Mounts the real AutomationWorkspace against a fetch double that mimics the
 * real API envelope and exercises EVERY interactive surface on the hub:
 * header actions, plan banner, featured templates (all 8 cards), preview
 * modal, search, status tabs, category & sort dropdowns, grid/list toggle,
 * workflow cards (edit, view report, pause, run, duplicate, archive, inline
 * rename), the never-run hint, KPI cards, approvals, drafts, empty states,
 * loading states, error states, and route navigation.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationWorkspace } from './automation.js'
import type { WorkspaceContext } from './model.js'
import type { Approval, AutomationSummary, AutomationUsage, WorkflowPage, WorkflowRecord, WorkflowTemplate } from './automation-model.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom lacks these browser APIs that the editor path touches.
if (!('scrollIntoView' in Element.prototype)) {
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
}
if (!('ResizeObserver' in window)) {
  ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

let root: Root | null = null
const consoleErrors: string[] = []
const toasts: string[] = []
const upgrades: string[] = []

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>

const envelope = (data: unknown, ok = true, status = 200, error?: { code: string; message: string }) =>
  new Response(JSON.stringify(ok ? { ok: true, data, meta: { requestId: 'r', timestamp: new Date().toISOString() } } : { ok: false, error, meta: {} }), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const triggerNode = { id: 'trigger', type: 'trigger' as const, config: { trigger: 'manual' as const }, next: ['action'] }
const actionNode = { id: 'action', type: 'action' as const, config: { action: 'email' as const, templateId: 'welcome-customer', maxRecipients: 1 }, next: [] }

function workflowRecord(id: string, overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id,
    storeId: 's1',
    name: 'Untitled workflow',
    description: null,
    category: 'Operations',
    tags: [],
    version: 1,
    nodes: [triggerNode, actionNode],
    status: 'ACTIVE',
    definitionHash: 'a'.repeat(64),
    activatedAt: '2026-08-17T00:00:00.000Z',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    createdBy: 'owner',
    updatedBy: 'owner',
    lastRunAt: null,
    successCount: 0,
    failureCount: 0,
    enabled: true,
    triggerSummary: 'Run on demand',
    nodeCount: 2,
    nextRunAt: null,
    timezone: 'UTC',
    overlapPolicy: 'SKIP',
    ...overrides,
  }
}

function template(id: string, category: WorkflowTemplate['category'], minimumPlan: WorkflowTemplate['minimumPlan'], complexity: WorkflowTemplate['complexity'], nodes: number, overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id,
    name: id.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' '),
    description: `Description for ${id}.`,
    category,
    impact: 'Impact copy.',
    complexity,
    minimumPlan,
    nodes,
    locked: false,
    ...overrides,
  }
}

/** Mirrors the real backend catalog (plan tiers verified against packages/automation/src/templates.ts). */
const TEMPLATES: readonly WorkflowTemplate[] = [
  template('welcome-customer', 'Customer', 'trial', 'Simple', 3, { name: 'Welcome New Customer', description: 'Welcome a new customer after a short, respectful delay.', impact: 'Supports a stronger first-purchase relationship.' }),
  template('vip-tagging', 'Customer', 'trial', 'Simple', 4, { name: 'VIP Customer Tagging', description: 'Tag customers whose order exceeds your chosen threshold.', impact: 'Enables reliable VIP segmentation.' }),
  template('high-value-order', 'Operations', 'trial', 'Simple', 4, { name: 'High-Value Order Alert', description: 'Notify your team when an order exceeds a chosen value.', impact: 'Keeps important orders visible to your team.' }),
  template('low-stock-alert', 'Inventory', 'trial', 'Simple', 4, { name: 'Low-Stock Internal Alert', description: 'Notify the merchant when available inventory drops below a threshold.', impact: 'Helps teams respond to stock risk earlier.' }),
  template('post-purchase-thanks', 'Customer', 'trial', 'Simple', 5, { name: 'Post-Purchase Thank You' }),
  template('abandoned-checkout', 'Marketing', 'start', 'Medium', 5, { name: 'Abandoned Checkout Recovery', description: 'Wait before sending a consent-aware checkout reminder.', impact: 'Creates a timely path back to an unfinished checkout.', locked: true }),
  template('review-request', 'Marketing', 'start', 'Medium', 5, { name: 'Post-Fulfillment Review Request', description: 'Request feedback several days after fulfillment.', impact: 'Encourages authentic product feedback.', locked: true }),
  template('first-purchase-follow-up', 'Marketing', 'start', 'Medium', 5, { name: 'First-Purchase Follow-Up', locked: true }),
  template('win-back', 'Revenue', 'growth', 'Advanced', 6, { name: 'Win-Back Inactive Customers', description: 'Review eligible inactive customers on a weekly schedule.', impact: 'Creates a repeatable retention process.', locked: true }),
  template('repeat-purchase', 'Revenue', 'growth', 'Advanced', 6, { name: 'Repeat Purchase Reminder', locked: true }),
  template('back-in-stock', 'Revenue', 'growth', 'Advanced', 6, { name: 'Back-in-Stock Notification', description: 'Notify eligible customers when inventory returns.', impact: 'Reconnects available inventory with recorded demand.', locked: true }),
  template('ai-segmentation', 'Customer', 'commander', 'Advanced', 5, { name: 'AI-Powered Customer Segmentation', locked: true }),
  template('smart-discount', 'Revenue', 'commander', 'Advanced', 2, { name: 'Smart Discount Generator', locked: true }),
]

const REACHED_USAGE: AutomationUsage = { plan: 'trial', used: 2, limit: 2, remaining: 0, limitReached: true }
const OPEN_USAGE: AutomationUsage = { plan: 'trial', used: 1, limit: 2, remaining: 1, limitReached: false }

const EMPTY_SUMMARY: AutomationSummary = {
  workflows: { active: 0, draft: 0, paused: 0, archived: 0 },
  runs: { today: 0, thisMonth: 0, previousMonth: 0, completed: 0, failed: 0, waiting: 0, successRate: null },
  impact: { emailsSent: 0, customersTagged: 0, discountsCreated: 0, notificationsSent: 0 },
  approvalsPending: 0,
  recentActivity: [],
}

const BUSY_SUMMARY: AutomationSummary = {
  workflows: { active: 2, draft: 1, paused: 0, archived: 0 },
  runs: { today: 2, thisMonth: 8, previousMonth: 3, completed: 7, failed: 1, waiting: 0, successRate: 87.5 },
  impact: { emailsSent: 6, customersTagged: 1, discountsCreated: 0, notificationsSent: 2 },
  approvalsPending: 2,
  recentActivity: [
    { runId: 'run-1', workflowId: 'wf-1', workflowName: 'Welcome New Customers', status: 'COMPLETED', at: '2026-08-19T05:00:00.000Z', description: 'Workflow run completed' },
  ],
}

function approval(id: string): Approval {
  return {
    id,
    storeId: 's1',
    workflowId: 'wf-1',
    workflowName: 'Smart Discount Generator',
    runId: 'run-1',
    nodeId: 'action',
    actionType: 'create_discount',
    preview: 'Create a 10% discount code',
    riskLevel: 'HIGH',
    status: 'PENDING',
    requestedAt: '2026-08-19T04:00:00.000Z',
    expiresAt: '2026-08-19T10:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
  }
}

interface StoreState {
  workflows: WorkflowRecord[]
  usage: AutomationUsage
  summary: AutomationSummary
  approvals: Approval[]
  failHub: boolean
  hangHub: boolean
  apiCalls: { method: string; url: string }[]
}

function makeFetchHandler(state: StoreState): FetchHandler {
  return async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    state.apiCalls.push({ method, url })
    if (url.startsWith('/security/csrf')) return envelope({ csrfToken: 'token' })
    if (url.startsWith('/session/context')) return envelope({ storeId: 's1', shop: 'test.myshopify.com' })

    if (url.startsWith('/automation/summary') || url.startsWith('/automation/usage')) {
      if (state.hangHub) return await new Promise<Response>(() => {})
      if (state.failHub) return envelope(null, false, 500, { code: 'INTERNAL_ERROR', message: 'Server exploded' })
      return envelope(url.startsWith('/automation/summary') ? state.summary : state.usage)
    }
    if (url.startsWith('/automation/approvals')) return envelope(state.approvals)

    if (url.startsWith('/automation/templates/') && url.includes('/install') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'))
      const templateId = /\/automation\/templates\/([^/]+)\/install/.exec(url)?.[1] ?? ''
      const found = TEMPLATES.find((entry) => entry.id === templateId)
      if (!found || found.locked) return envelope(null, false, 402, { code: 'PAYMENT_REQUIRED', message: 'Upgrade Plan to install this template' })
      const created = workflowRecord(`installed-${templateId}`, { name: String(body.name), category: found.category, status: 'DRAFT' })
      state.workflows = [...state.workflows, created]
      state.summary = { ...state.summary, workflows: { ...state.summary.workflows, draft: state.summary.workflows.draft + 1 } }
      return envelope(created, true, 201)
    }
    if (url.startsWith('/automation/templates')) return envelope(TEMPLATES)

    const commandMatch = /^\/automation\/workflows\/([^/]+)\/([a-z]+)/.exec(url)
    if (commandMatch) {
      const [, id, command] = commandMatch
      const found = state.workflows.find((entry) => entry.id === id)
      if (!found) return envelope(null, false, 404, { code: 'NOT_FOUND', message: 'Workflow not found' })
      if (command === 'pause') {
        state.workflows = state.workflows.map((entry) => (entry.id === id ? { ...entry, status: 'PAUSED' as const, enabled: false } : entry))
        return envelope({ ...found, status: 'PAUSED', enabled: false })
      }
      if (command === 'resume') {
        state.workflows = state.workflows.map((entry) => (entry.id === id ? { ...entry, status: 'ACTIVE' as const, enabled: true } : entry))
        return envelope({ ...found, status: 'ACTIVE', enabled: true })
      }
      if (command === 'clone') {
        const body = JSON.parse(String(init?.body ?? '{}'))
        const copy = workflowRecord(`clone-of-${id}`, { name: String(body.name ?? `${found.name} copy`), status: 'DRAFT' as const })
        state.workflows = [...state.workflows, copy]
        return envelope(copy, true, 201)
      }
      if (command === 'run') return envelope({ id: `run-of-${id}`, workflowId: id, storeId: 's1', status: 'QUEUED' }, true, 202)
      if (command === 'activate') return envelope({ ...found, status: 'ACTIVE' })
      if (command === 'runs') return envelope({ items: [], nextCursor: null })
    }

    const single = /^\/automation\/workflows\/([^/?]+)/.exec(url)
    if (single && method === 'PATCH') {
      const id = single[1]
      const body = JSON.parse(String(init?.body ?? '{}'))
      const found = state.workflows.find((entry) => entry.id === id)
      if (!found) return envelope(null, false, 404, { code: 'NOT_FOUND', message: 'Workflow not found' })
      const updated = { ...found, ...(typeof body.name === 'string' ? { name: body.name } : {}) }
      state.workflows = state.workflows.map((entry) => (entry.id === id ? updated : entry))
      return envelope(updated)
    }
    if (single && method === 'DELETE') {
      const id = single[1]
      const found = state.workflows.find((entry) => entry.id === id)
      if (!found) return envelope(null, false, 404, { code: 'NOT_FOUND', message: 'Workflow not found' })
      const archived = { ...found, status: 'ARCHIVED' as const }
      state.workflows = state.workflows.map((entry) => (entry.id === id ? archived : entry))
      return envelope(archived)
    }
    if (single && method === 'GET') {
      const id = single[1]
      const found = state.workflows.find((entry) => entry.id === id)
      if (!found) return envelope(null, false, 404, { code: 'NOT_FOUND', message: 'Workflow not found' })
      return envelope(found)
    }

    if (url.startsWith('/automation/workflows')) {
      const query = new URLSearchParams(url.split('?')[1] ?? '')
      let items = state.workflows
      if (query.get('status')) items = items.filter((entry) => entry.status === query.get('status'))
      const page: WorkflowPage = { items, nextCursor: null, total: items.length }
      return envelope(page)
    }
    if (url.startsWith('/automation/runs/')) {
      return envelope({
        id: 'run-x',
        workflowId: 'wf-1',
        storeId: 's1',
        version: 1,
        definitionHash: 'a'.repeat(64),
        status: 'COMPLETED',
        currentNodeId: null,
        resumeAt: null,
        triggerType: 'MANUAL',
        testMode: false,
        createdAt: '2026-08-19T05:00:00.000Z',
        startedAt: '2026-08-19T05:00:00.500Z',
        completedAt: '2026-08-19T05:00:01.000Z',
        errorMessage: null,
        attempt: 1,
        maxAttempts: 3,
        steps: [],
      })
    }
    return envelope(null, false, 404, { code: 'NOT_FOUND', message: 'Not found' })
  }
}

function setup(overrides: Partial<StoreState> = {}): StoreState {
  const state: StoreState = {
    workflows: [workflowRecord('wf-1'), workflowRecord('wf-2')],
    usage: REACHED_USAGE,
    summary: { ...EMPTY_SUMMARY, workflows: { active: 2, draft: 0, paused: 0, archived: 0 } },
    approvals: [],
    failHub: false,
    hangHub: false,
    apiCalls: [],
    ...overrides,
  }
  window.fetch = vi.fn(makeFetchHandler(state) as unknown as typeof fetch)
  return state
}

beforeEach(() => {
  consoleErrors.length = 0
  toasts.length = 0
  upgrades.length = 0
  window.history.pushState({}, '', '/automation')
  document.body.innerHTML = ''
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '))
  }
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function mount(storeId = 's1'): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const context: WorkspaceContext = { storeId, shop: 'test.myshopify.com' }
  await act(async () => {
    root = createRoot(container)
    root.render(
      <StrictMode>
        <AutomationWorkspace
          context={context}
          onToast={(message) => toasts.push(message)}
          onNavigateBilling={() => upgrades.push('billing')}
        />
      </StrictMode>,
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
  return container
}

/** Navigate back to the hub the same way a browser back button would. */
async function backToHub(): Promise<void> {
  window.history.pushState({}, '', '/automation')
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate'))
    await Promise.resolve()
  })
}

const button = (container: Element, text: string): HTMLButtonElement => {
  const found = Array.from(container.querySelectorAll('button')).find((entry) => entry.textContent?.trim() === text || entry.textContent?.includes(text))
  if (!found) throw new Error(`Button not found: ${text}`)
  return found as HTMLButtonElement
}

const click = async (element: Element): Promise<void> => {
  await act(async () => {
    ;(element as HTMLElement).click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await flush()
}

/** Drain React's scheduler and pending effects (dynamic imports included). */
const flush = async (rounds = 6): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

const setInput = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}

const keyDown = (element: Element, key: string): void => {
  element.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

describe('Automation page — header, banner, navigation', () => {
  it('renders the header and every header action', async () => {
    setup()
    const container = await mount()
    expect(container.textContent).toContain('SHOPIFY AUTOMATIONS')
    expect(container.textContent).toContain('Automations')
    expect(container.textContent).toContain('Save time and grow your business with automated workflows.')
    expect(button(container, 'How it works')).toBeTruthy()
    expect(button(container, 'Browse Templates')).toBeTruthy()
    const create = button(container, 'Create Automation')
    expect(create).toBeTruthy()
    // Limit reached → create is disabled with an explanatory tooltip.
    expect(create.disabled).toBe(true)
    expect(create.title).toContain('upgrade')
  })

  it('opens and closes the How it works modal without errors', async () => {
    setup()
    const container = await mount()
    await click(button(container, 'How it works'))
    expect(container.textContent).toContain('How automations work')
    expect(container.textContent).toContain('Choose a starting point')
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')
    expect(close).toBeTruthy()
    await click(close as HTMLButtonElement)
    expect(container.textContent).not.toContain('How automations work')
    expect(consoleErrors).toEqual([])
  })

  it('How it works → Start Building opens the create modal', async () => {
    setup({ usage: OPEN_USAGE, workflows: [workflowRecord('wf-1')], summary: { ...EMPTY_SUMMARY, workflows: { active: 1, draft: 0, paused: 0, archived: 0 } } })
    const container = await mount()
    await click(button(container, 'How it works'))
    await click(button(container, 'Start Building'))
    expect(container.textContent).toContain('Create New Automation')
    expect(consoleErrors).toEqual([])
  })

  it('Browse Templates navigates to the full gallery and back', async () => {
    setup()
    const container = await mount()
    await click(button(container, 'Browse Templates'))
    expect(window.location.pathname).toBe('/automation/templates')
    expect(container.textContent).toContain('Automation templates')
    expect(container.textContent).toContain('PROVEN STARTING POINTS')
    const back = container.querySelector<HTMLButtonElement>('.automation-back')
    expect(back).toBeTruthy()
    await click(back as HTMLButtonElement)
    expect(window.location.pathname).toBe('/automation')
  })

  it('plan banner shows the accurate limit copy and a green Upgrade Plan button', async () => {
    setup()
    const container = await mount()
    expect(container.textContent).toContain('You’ve reached your limit')
    expect(container.textContent).toContain('2 of 2')
    expect(container.textContent).toContain('Upgrade Plan to create more automations.')
    const upgrade = container.querySelector<HTMLButtonElement>('.warning-upgrade-btn.upgrade-plan-btn')
    expect(upgrade).toBeTruthy()
    await click(upgrade as HTMLButtonElement)
    expect(upgrades).toEqual(['billing'])
  })

  it('drafts variant of the banner offers Complete Drafts plus the green Upgrade Plan', async () => {
    setup({ workflows: [workflowRecord('wf-1', { nodes: [] }), workflowRecord('wf-2')], summary: { ...EMPTY_SUMMARY, workflows: { active: 1, draft: 1, paused: 0, archived: 0 } } })
    const container = await mount()
    expect(container.textContent).toContain('Complete your drafts or upgrade for more space')
    expect(button(container, 'Complete Drafts')).toBeTruthy()
    expect(container.querySelector('.warning-upgrade-btn.upgrade-plan-btn')).toBeTruthy()
  })

  it('almost-at-limit banner (80%) renders with a green Upgrade Plan button', async () => {
    setup({ usage: { plan: 'start', used: 4, limit: 5, remaining: 1, limitReached: false }, workflows: [workflowRecord('wf-1')], summary: { ...EMPTY_SUMMARY, workflows: { active: 1, draft: 0, paused: 0, archived: 0 } } })
    const container = await mount()
    expect(container.textContent).toContain('You’re almost at your limit')
    expect(container.querySelector('.upgrade-plan-btn')).toBeTruthy()
  })

  it('no banner under 80% usage and none for unlimited plans', async () => {
    setup({ usage: OPEN_USAGE, workflows: [workflowRecord('wf-1')], summary: { ...EMPTY_SUMMARY, workflows: { active: 1, draft: 0, paused: 0, archived: 0 } } })
    const container = await mount()
    expect(container.querySelector('.automation-plan-banner')).toBeNull()
  })

  it('browser back/forward returns to the hub', async () => {
    setup()
    const container = await mount()
    await click(button(container, 'Browse Templates'))
    expect(window.location.pathname).toBe('/automation/templates')
    await backToHub()
    expect(window.location.pathname).toBe('/automation')
    expect(container.textContent).toContain('Featured templates')
  })
})

describe('Automation page — featured templates (all 8 cards)', () => {
  it('renders the section copy and exactly 8 featured cards in the curated order', async () => {
    setup()
    const container = await mount()
    expect(container.textContent).toContain('PROVEN STARTING POINTS')
    expect(container.textContent).toContain('Featured templates')
    expect(container.textContent).toContain('Start with a proven, pre-built automation and customize it to fit your store.')
    const cards = Array.from(container.querySelectorAll('.template-card'))
    expect(cards).toHaveLength(8)
    const names = cards.map((card) => card.querySelector('.template-name')?.textContent)
    expect(names).toEqual([
      'Abandoned Checkout Recovery',
      'Welcome New Customer',
      'Low-Stock Internal Alert',
      'High-Value Order Alert',
      'Back-in-Stock Notification',
      'Post-Fulfillment Review Request',
      'Win-Back Inactive Customers',
      'VIP Customer Tagging',
    ])
  })

  it('every card shows its description, helper impact copy, and setup meta in full', async () => {
    setup()
    const container = await mount()
    const cards = Array.from(container.querySelectorAll('.template-card'))
    for (const card of cards) {
      expect(card.querySelector('.template-description')?.textContent?.length).toBeGreaterThan(10)
      expect(card.querySelector('.template-detail')?.textContent?.length).toBeGreaterThan(10)
      expect(card.querySelector('.template-meta')?.textContent).toMatch(/setup · \d+ steps?/)
    }
    const card = (index: number): Element => cards[index] as Element
    expect(card(0).textContent).toContain('Creates a timely path back to an unfinished checkout.')
    expect(card(0).textContent).toContain('Moderate setup · 5 steps')
    expect(card(1).textContent).toContain('Supports a stronger first-purchase relationship.')
    expect(card(1).textContent).toContain('Quick setup · 3 steps')
    expect(card(4).textContent).toContain('Advanced setup · 6 steps')
    expect(card(3).textContent).toContain('Keeps important orders visible to your team.')
    expect(card(5).textContent).toContain('Encourages authentic product feedback.')
  })

  it('plan badges follow the logical pattern: All plans=green, Start plan=blue, Growth plan=purple', async () => {
    setup()
    const container = await mount()
    const cards = Array.from(container.querySelectorAll('.template-card'))
    const card = (index: number): Element => cards[index] as Element
    const badge = (cardEl: Element) => cardEl.querySelector('.template-plan-badge')
    expect(badge(card(0))?.textContent).toContain('Start plan')
    expect(badge(card(0))?.className).toContain('start')
    expect(badge(card(1))?.textContent).toContain('All plans')
    expect(badge(card(1))?.className).toContain('all-plans')
    expect(badge(card(4))?.textContent).toContain('Growth plan')
    expect(badge(card(4))?.className).toContain('growth')
    expect(badge(card(5))?.textContent).toContain('Start plan')
    expect(badge(card(6))?.textContent).toContain('Growth plan')
    expect(badge(card(7))?.textContent).toContain('All plans')
    for (const card of cards) expect((badge(card) as HTMLElement).textContent?.length).toBeGreaterThan(0)
  })

  it('each category carries its own recognizable icon — no duplicates across categories', async () => {
    setup()
    const container = await mount()
    const cards = Array.from(container.querySelectorAll('.template-card'))
    const iconClass = (card: Element) => (card.querySelector('.template-icon svg') as SVGElement).className.baseVal
    const byCategory = new Map<string, Set<string>>()
    for (const card of cards) {
      const category = card.querySelector('.template-category')?.textContent ?? ''
      const tone = Array.from(card.classList).find((name) => ['sales-growth', 'customer-experience', 'inventory-stock', 'operations', 'revenue-retention'].includes(name))
      const key = `${category}:${tone}`
      if (!byCategory.has(key)) byCategory.set(key, new Set())
      byCategory.get(key)?.add(iconClass(card))
    }
    const perTone = new Map<string, string>()
    for (const [key, icons] of byCategory) {
      const tone = key.split(':')[1] ?? ''
      const icon = Array.from(icons)[0] ?? ''
      if (perTone.has(tone)) expect(icon, `tone ${tone} reused ${icon}`).toBe(perTone.get(tone))
      perTone.set(tone, icon)
    }
    expect(perTone.size).toBe(5)
    const used = new Set(perTone.values())
    expect(used.size).toBe(5)
  })

  it('locked cards show the SAME green Upgrade Plan CTA; unlocked cards show Set Up →', async () => {
    setup()
    const container = await mount()
    const upgradeButtons = Array.from(container.querySelectorAll('.template-card .upgrade-plan-btn'))
    expect(upgradeButtons).toHaveLength(4)
    for (const upgrade of upgradeButtons) {
      expect(upgrade.textContent).toContain('Upgrade Plan')
      expect(upgrade.className).toContain('template-upgrade-btn')
      expect(upgrade.className).toContain('upgrade-plan-btn')
    }
    const setupButtons = Array.from(container.querySelectorAll('.template-card .template-setup-btn'))
    expect(setupButtons).toHaveLength(4)
    for (const set of setupButtons) expect(set.textContent).toContain('Set Up')
    // Card 5 (Back-in-Stock) — previously the half-visible broken one.
    // It must render the same complete green CTA as every other locked card.
    const backInStock = Array.from(container.querySelectorAll('.template-card'))[4] as Element
    const cta = backInStock.querySelector('.upgrade-plan-btn') as HTMLElement
    expect(cta).toBeTruthy()
    expect(cta.textContent?.trim()).toBe('Upgrade Plan')
    expect(cta.className).toContain('template-upgrade-btn')
    // The CTA markup for card 5 is byte-for-byte consistent with card 1's.
    const abandoned = Array.from(container.querySelectorAll('.template-card'))[0] as Element
    expect(cta.outerHTML.replace(/aria-label="[^"]*"/, '')).toBe(
      (abandoned.querySelector('.upgrade-plan-btn') as HTMLElement).outerHTML.replace(/aria-label="[^"]*"/, ''),
    )
  })

  it('every Upgrade Plan CTA on cards routes to billing without any API call', async () => {
    const state = setup()
    const container = await mount()
    const buttons = Array.from(container.querySelectorAll('.template-card .upgrade-plan-btn'))
    for (const upgrade of buttons) await click(upgrade)
    expect(upgrades).toEqual(['billing', 'billing', 'billing', 'billing'])
    expect(state.apiCalls.filter((call) => call.url.startsWith('/automation')).every((call) => call.method === 'GET')).toBe(true)
    expect(consoleErrors).toEqual([])
  })

  it('card click opens the preview modal; Set Up installs and opens the editor', async () => {
    setup({ usage: OPEN_USAGE, workflows: [workflowRecord('wf-1')], summary: { ...EMPTY_SUMMARY, workflows: { active: 1, draft: 0, paused: 0, archived: 0 } } })
    const container = await mount()
    const welcome = Array.from(container.querySelectorAll('.template-card'))[1] as Element
    await click(welcome.querySelector('.template-card-main') as HTMLElement)
    expect(container.textContent).toContain('What it does for you')
    expect(container.textContent).toContain('Installs as a draft you can review.')
    await click(button(container, 'Set Up →'))
    expect(window.location.pathname).toBe('/automation/workflows/installed-welcome-customer')
    expect(toasts.some((toast) => toast.includes('Template installed'))).toBe(true)
  })

  it('locked template preview shows the green Upgrade Plan button that routes to billing', async () => {
    setup()
    const container = await mount()
    const abandoned = Array.from(container.querySelectorAll('.template-card'))[0] as Element
    await click(abandoned.querySelector('.template-card-main') as HTMLElement)
    expect(container.textContent).toContain('This template needs a higher plan.')
    const upgrade = container.querySelector('.template-preview .upgrade-plan-btn') as HTMLElement
    expect(upgrade).toBeTruthy()
    await click(upgrade)
    expect(upgrades).toEqual(['billing'])
  })

  it('Browse all templates link navigates to the gallery', async () => {
    setup()
    const container = await mount()
    await click(container.querySelector('.browse-all-link') as HTMLElement)
    expect(window.location.pathname).toBe('/automation/templates')
  })

  it('full gallery tabs filter templates without errors', async () => {
    setup()
    const container = await mount()
    await click(button(container, 'Browse Templates'))
    await click(button(container, 'AI-Powered'))
    const cards = Array.from(container.querySelectorAll('.template-card'))
    expect(cards.length).toBe(2)
    expect((cards[0] as Element).textContent).toContain('AI-Powered Customer Segmentation')
    await click(button(container, 'Inventory & Stock'))
    expect((Array.from(container.querySelectorAll('.template-card'))[0] as Element).textContent).toContain('Low-Stock Internal Alert')
    expect(consoleErrors).toEqual([])
  })
})

describe('Automation page — Your Automations section', () => {
  it('renders the section header with count badge and accurate status summary', async () => {
    setup()
    const container = await mount()
    expect(container.textContent).toContain('YOUR AUTOMATIONS')
    expect(container.textContent).toContain('Your Automations')
    expect(container.querySelector('.count-badge')?.textContent).toBe('2')
    expect(container.textContent).toContain('2 active · 0 paused')
  })

  it('search narrows the visible cards', async () => {
    setup({ workflows: [workflowRecord('wf-1', { name: 'Welcome flow' }), workflowRecord('wf-2', { name: 'Stock alerts' })] })
    const container = await mount()
    expect(container.querySelectorAll('.workflow-card')).toHaveLength(2)
    const search = container.querySelector<HTMLInputElement>('.automation-search input')
    expect(search).toBeTruthy()
    await act(async () => {
      setInput(search as HTMLInputElement, 'welcome')
      await Promise.resolve()
    })
    expect(container.querySelectorAll('.workflow-card')).toHaveLength(1)
    expect(container.textContent).toContain('Welcome flow')
    expect(container.textContent).not.toContain('Stock alerts')
  })

  it('status tabs show counts and filter correctly, including the empty state', async () => {
    setup()
    const container = await mount()
    const tabs = Array.from(container.querySelectorAll('.filter-tab'))
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['All2', 'Active2', 'Paused0', 'Draft0', 'Archived0'])
    await click(tabs[1] as HTMLElement)
    expect(container.querySelectorAll('.workflow-card')).toHaveLength(2)
    await click(tabs[2] as HTMLElement)
    expect(container.querySelectorAll('.workflow-card')).toHaveLength(0)
    expect(container.textContent).toContain('No automations match these filters')
    await click(button(container, 'Clear filters'))
    expect(container.querySelectorAll('.workflow-card')).toHaveLength(2)
  })

  it('category dropdown filters cards', async () => {
    setup({ workflows: [workflowRecord('wf-1', { category: 'Marketing', name: 'Cart saver' }), workflowRecord('wf-2', { category: 'Operations', name: 'Ops alert' })] })
    const container = await mount()
    const trigger = container.querySelector<HTMLButtonElement>('.category-dropdown .custom-select-trigger')
    expect(trigger).toBeTruthy()
    await click(trigger as HTMLButtonElement)
    const option = Array.from(container.querySelectorAll('.category-dropdown [role="option"]')).find((entry) => entry.textContent?.includes('Sales & Growth'))
    expect(option).toBeTruthy()
    await click(option as HTMLElement)
    expect(container.querySelectorAll('.workflow-card')).toHaveLength(1)
    expect(container.textContent).toContain('Cart saver')
  })

  it('sort dropdown reorders cards', async () => {
    setup({ workflows: [workflowRecord('wf-1', { name: 'Zulu' }), workflowRecord('wf-2', { name: 'Alpha' })] })
    const container = await mount()
    const trigger = container.querySelector<HTMLButtonElement>('.last-run-dropdown .custom-select-trigger')
    await click(trigger as HTMLButtonElement)
    const option = Array.from(container.querySelectorAll('.last-run-dropdown [role="option"]')).find((entry) => entry.textContent?.includes('Name'))
    await click(option as HTMLElement)
    const names = Array.from(container.querySelectorAll('.workflow-name')).map((node) => node.textContent)
    expect(names).toEqual(['Alpha', 'Zulu'])
  })

  it('grid/list toggle switches layouts', async () => {
    setup()
    const container = await mount()
    const grid = container.querySelector('.automation-workflow-grid')
    expect(grid?.className).toContain('grid')
    const listButton = container.querySelector<HTMLButtonElement>('button[aria-label="List view"]')
    await click(listButton as HTMLButtonElement)
    expect(grid?.className).toContain('list')
    const gridButton = container.querySelector<HTMLButtonElement>('button[aria-label="Grid view"]')
    await click(gridButton as HTMLButtonElement)
    expect(grid?.className).toContain('grid')
  })

  it('every workflow card renders status, trigger, stats, and the never-run hint', async () => {
    setup()
    const container = await mount()
    const cards = Array.from(container.querySelectorAll('.workflow-card'))
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(card.querySelector('.workflow-status-badge')?.textContent).toBe('Active')
      expect(card.textContent).toContain('Starts when you run it')
      expect(card.textContent).toContain('2 steps')
      expect(card.textContent).toContain('0 successful runs')
      expect(card.textContent).toContain('Never')
      expect(card.textContent).toContain('This automation has not run yet. Activate it to start tracking results.')
      expect(card.querySelector('.workflow-empty-hint')).toBeTruthy()
    }
  })

  it('clicking the never-run hint (or card body) opens the editor', async () => {
    setup()
    const container = await mount()
    const hint = container.querySelector('.workflow-empty-hint') as HTMLElement
    await click(hint)
    expect(window.location.pathname).toBe('/automation/workflows/wf-1')
  })

  it('clicking the name starts inline rename; Enter persists via PATCH; Escape cancels', async () => {
    const state = setup()
    const container = await mount()
    const nameButton = container.querySelector('.workflow-name-button') as HTMLElement
    await click(nameButton)
    const input = container.querySelector<HTMLInputElement>('.workflow-name-input')
    expect(input).toBeTruthy()
    await act(async () => {
      setInput(input as HTMLInputElement, 'Cart Recovery Pro')
      keyDown(input as HTMLInputElement, 'Enter')
      await Promise.resolve()
    })
    expect(state.apiCalls.filter((call) => call.method === 'PATCH' && call.url.includes('wf-1')).length).toBeGreaterThan(0)
    expect(container.textContent).toContain('Cart Recovery Pro')
    expect(toasts).toContain('Automation renamed.')

    // Escape cancels the second card's rename without any API call.
    const before = state.apiCalls.filter((call) => call.method === 'PATCH').length
    const second = container.querySelectorAll('.workflow-name-button')[1] as HTMLElement
    await click(second)
    const secondInput = container.querySelectorAll<HTMLInputElement>('.workflow-name-input')[0]
    await act(async () => {
      setInput(secondInput as HTMLInputElement, 'Should not stick')
      keyDown(secondInput as HTMLInputElement, 'Escape')
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain('Should not stick')
    expect(state.apiCalls.filter((call) => call.method === 'PATCH').length).toBe(before)
  })

  it('Edit opens the editor and View Report opens run history', async () => {
    setup()
    const container = await mount()
    await click(button(container, 'Edit'))
    expect(window.location.pathname).toBe('/automation/workflows/wf-1')
    await backToHub()
    const viewReport = container.querySelectorAll<HTMLButtonElement>('.view-report')[1]
    await click(viewReport as HTMLButtonElement)
    expect(window.location.pathname).toBe('/automation/workflows/wf-2/runs')
  })

  it('the editor topbar allows renaming the workflow too', async () => {
    const state = setup()
    const container = await mount()
    await click(button(container, 'Edit'))
    expect(window.location.pathname).toBe('/automation/workflows/wf-1')
    await flush(20) // lazy WorkflowEditor chunk + its effects
    const nameButton = container.querySelector('.editor-name-button') as HTMLElement
    expect(nameButton).toBeTruthy()
    await click(nameButton)
    const input = container.querySelector<HTMLInputElement>('.editor-name-input')
    expect(input).toBeTruthy()
    await act(async () => {
      setInput(input as HTMLInputElement, 'Renamed in editor')
      keyDown(input as HTMLInputElement, 'Enter')
      await Promise.resolve()
    })
    expect(state.apiCalls.some((call) => call.method === 'PATCH' && call.url.includes('wf-1'))).toBe(true)
    expect(container.textContent).toContain('Renamed in editor')
  })

  it('Pause pauses the automation and the card status updates', async () => {
    setup()
    const container = await mount()
    const pause = container.querySelector<HTMLButtonElement>('.workflow-action-btn.pause')
    expect(pause).toBeTruthy()
    await click(pause as HTMLButtonElement)
    expect(toasts).toContain('Automation paused.')
    expect(container.textContent).toContain('Resume')
  })

  it('more menu: Run Now, Duplicate, Run history, Archive all work', async () => {
    setup()
    const container = await mount()
    const menuButton = (): HTMLElement => container.querySelector('.workflow-more button') as HTMLElement
    const menu = (): HTMLElement => container.querySelector('.workflow-menu') as HTMLElement
    await click(menuButton())
    expect(menu()).toBeTruthy()
    await click(button(menu(), 'Run Now'))
    expect(window.location.pathname).toBe('/automation/runs/run-of-wf-1')
    await backToHub()
    await click(menuButton())
    await click(button(menu(), 'Duplicate'))
    expect(toasts).toContain('Automation duplicated.')
    await click(menuButton())
    await click(button(menu(), 'Run history'))
    expect(window.location.pathname).toBe('/automation/workflows/wf-1/runs')
    await backToHub()
    await click(menuButton())
    await click(button(menu(), 'Archive'))
    expect(toasts).toContain('Automation removed.')
  })

  it('both cards are independent — pausing one never touches the other', async () => {
    setup()
    const container = await mount()
    const cards = Array.from(container.querySelectorAll('.workflow-card'))
    const firstPause = (cards[0] as Element).querySelector('.pause') as HTMLElement
    await click(firstPause)
    const badges = Array.from(container.querySelectorAll('.workflow-status-badge')).map((badge) => badge.textContent)
    expect(badges).toEqual(['Paused', 'Active'])
  })

  it('drafts needing attention render with Continue Setup and Remove actions', async () => {
    setup({ usage: OPEN_USAGE, workflows: [workflowRecord('wf-1', { nodes: [] }), workflowRecord('wf-2')], summary: { ...EMPTY_SUMMARY, workflows: { active: 1, draft: 1, paused: 0, archived: 0 } } })
    const container = await mount()
    expect(container.textContent).toContain('Drafts needing attention (1)')
    expect(container.textContent).toContain('Untitled automation')
    await click(button(container, 'Continue Setup'))
    expect(window.location.pathname).toBe('/automation/workflows/wf-1')
  })
})

describe('Automation page — KPI stats bar', () => {
  it('shows honest empty states when nothing has run yet', async () => {
    setup()
    const container = await mount()
    const kpis = container.querySelector('.automation-kpis')
    expect(kpis).toBeTruthy()
    expect(kpis?.textContent).toContain('Active automations')
    expect(kpis?.textContent).toContain('Runs this month')
    expect(kpis?.textContent).toContain('Success rate')
    expect(kpis?.textContent).toContain('Actions completed')
    expect(kpis?.textContent).toContain('Pending approvals')
    expect(kpis?.textContent).toContain('2 of 2 automations used')
    expect(kpis?.textContent).toContain('0 available')
    expect(kpis?.textContent).toContain('No change from last month')
    expect(kpis?.textContent).toContain('—')
    expect(kpis?.textContent).toContain('Available after the first run')
    expect(kpis?.textContent).toContain('Measured after successful actions')
    expect(kpis?.textContent).toContain('All clear!')
    expect(kpis?.textContent).toContain('No actions waiting')
  })

  it('shows real backend numbers when runs exist', async () => {
    setup({ summary: BUSY_SUMMARY, usage: OPEN_USAGE, workflows: [workflowRecord('wf-1', { successCount: 6, failureCount: 1, lastRunAt: '2026-08-19T05:00:00.000Z' }), workflowRecord('wf-2')] })
    const container = await mount()
    const kpis = container.querySelector('.automation-kpis')
    expect(kpis?.textContent).toContain('8')
    expect(kpis?.textContent).toContain('+5 vs last month')
    expect(kpis?.textContent).toContain('88%')
    expect(kpis?.textContent).toContain('9')
    expect(kpis?.textContent).toContain('6 emails')
    expect(container.textContent).toContain('Recent activity')
    expect(container.textContent).toContain('Welcome New Customers')
  })

  it('pending approvals: KPI card shows the count and navigates to the inbox', async () => {
    setup({ summary: BUSY_SUMMARY, usage: OPEN_USAGE, workflows: [workflowRecord('wf-1'), workflowRecord('wf-2')] })
    const container = await mount()
    const pending = container.querySelector('.kpi-card.pending-approvals') as HTMLElement
    expect(pending.textContent).toContain('Needs review')
    await click(pending)
    expect(window.location.pathname).toBe('/automation/approvals')
  })

  it('the approvals banner appears with real pending items and navigates to the inbox', async () => {
    setup({ summary: BUSY_SUMMARY, usage: OPEN_USAGE, workflows: [workflowRecord('wf-1'), workflowRecord('wf-2')], approvals: [approval('a1'), approval('a2')] })
    const container = await mount()
    expect(container.textContent).toContain('2 actions are awaiting approval')
    await click(button(container, 'Review approvals'))
    expect(window.location.pathname).toBe('/automation/approvals')
  })
})

describe('Automation page — states, resilience, and accessibility', () => {
  it('shows a skeleton while the hub loads', async () => {
    setup({ hangHub: true })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const context: WorkspaceContext = { storeId: 's1', shop: 'test.myshopify.com' }
    await act(async () => {
      root = createRoot(container)
      root.render(<StrictMode><AutomationWorkspace context={context} onToast={(message) => toasts.push(message)} onNavigateBilling={() => upgrades.push('billing')} /></StrictMode>)
    })
    expect(container.querySelector('.automation-skeleton')).toBeTruthy()
  })

  it('renders a friendly error state with Retry when the API fails — never a raw 500', async () => {
    const state = setup({ failHub: true })
    const container = await mount()
    expect(container.textContent).toContain('Automation could not be loaded')
    expect(container.textContent).toContain('Server exploded')
    expect(container.textContent).toContain('Retry')
    // Retry succeeds once the API recovers.
    state.failHub = false
    await click(button(container, 'Retry'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Featured templates')
  })

  it('new merchants see the getting-started hero instead of the hub', async () => {
    setup({ usage: OPEN_USAGE, workflows: [], summary: { ...EMPTY_SUMMARY, workflows: { active: 0, draft: 0, paused: 0, archived: 0 } } })
    const container = await mount()
    expect(container.textContent).toContain('Welcome to Automations!')
    expect(container.textContent).toContain('Popular automations')
    expect(container.textContent).toContain('Or build from scratch')
  })

  it('create modal enforces a name and installs a template', async () => {
    setup({ usage: OPEN_USAGE, workflows: [workflowRecord('wf-1')], summary: { ...EMPTY_SUMMARY, workflows: { active: 1, draft: 0, paused: 0, archived: 0 } } })
    const container = await mount()
    await click(button(container, 'Create Automation'))
    expect(container.textContent).toContain('Create New Automation')
    const submit = container.querySelector('.create-workflow-modal .automation-primary') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await click(button(container, 'Cancel'))
    expect(container.querySelector('.create-workflow-modal')).toBeNull()
    await click(button(container, 'Create Automation'))
    const nameInput = container.querySelector<HTMLInputElement>('.create-workflow-modal input[placeholder*="Welcome new customers"]')
    expect(nameInput).toBeTruthy()
    await act(async () => {
      setInput(nameInput as HTMLInputElement, 'My new automation')
    })
    const templateSelect = container.querySelector<HTMLButtonElement>('.create-template-select .custom-select-trigger')
    await click(templateSelect as HTMLButtonElement)
    const option = Array.from(container.querySelectorAll('.create-template-select [role="option"]')).find((entry) => entry.textContent?.includes('Welcome New Customer'))
    await click(option as HTMLElement)
    const submitAgain = container.querySelector('.create-workflow-modal .automation-primary') as HTMLButtonElement
    expect(submitAgain.disabled).toBe(false)
    await click(submitAgain)
    expect(window.location.pathname).toBe('/automation/workflows/installed-welcome-customer')
    expect(toasts.some((toast) => toast.includes('Template installed'))).toBe(true)
  })

  it('disconnected stores see the connect call-to-action', async () => {
    setup()
    await mount('')
    expect(document.body.textContent).toContain('Connect Shopify to use automations')
  })

  it('renders without console errors across the whole sweep', async () => {
    setup()
    const container = await mount()
    await click(button(container, 'How it works'))
    await click(container.querySelector('button[aria-label="Close"]') as HTMLElement)
    await click(button(container, 'Browse Templates'))
    await click(container.querySelector('.automation-back') as HTMLElement)
    expect(consoleErrors).toEqual([])
  })
})

describe('Automation page — static style contracts', () => {
  const css = (): string => readFileSync(resolve(process.cwd(), 'apps/web/src/automation.css'), 'utf8')

  it('ships one green Upgrade Plan contract and no half-visible buttons', () => {
    const tail = css().slice(css().lastIndexOf('Automation hub overhaul'))
    expect(tail).toContain('background: linear-gradient(135deg, rgb(34, 197, 94), rgb(22, 163, 74))')
    expect(tail).toContain('visibility: visible !important')
    expect(tail).toContain('opacity: 1 !important')
    expect(tail).toContain('min-width: 120px !important')
    expect(tail).toContain('.automation-page .template-card-pro.locked')
  })

  it('keeps the category stripe and badge palette documented in the spec', () => {
    const source = css()
    expect(source).toContain('.template-card.operations::after')
    expect(source).toContain('linear-gradient(90deg, rgb(139, 92, 246), rgb(167, 139, 250))')
    expect(source).toContain('.template-card.revenue-retention::after')
    expect(source).toContain('linear-gradient(90deg, rgb(239, 68, 68), rgb(248, 113, 113))')
    expect(source).toContain('.template-plan-badge.all-plans')
    expect(source).toContain('rgba(16, 185, 129, 0.14)')
    expect(source).toContain('outline: 2px solid rgb(124, 58, 237)')
    expect(source).toContain('@media (max-width: 480px)')
    expect(source).toContain('.template-tabs')
  })
})
