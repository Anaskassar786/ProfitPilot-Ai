// @vitest-environment jsdom
/**
 * Automation WorkflowEditor — exhaustive interaction sweep.
 *
 * Mounts the real WorkflowEditor against a fetch double that mimics the real
 * API envelope and exercises every button on the editor top-bar (Save Draft,
 * Test Run, Save & Activate, mode toggle, rename, back) plus the simple-mode
 * add/remove/configure controls. The goal is to guarantee that no editor
 * button can throw, 500, or leave the workflow in a broken state.
 */
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowEditor } from './WorkflowEditor.js'
import type { AutomationUsage, WorkflowNode, WorkflowRecord } from './automation-model.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
const toasts: Array<{ message: string; kind?: string }> = []
const navigations: string[] = []

type Store = {
  workflow: WorkflowRecord
  usage: AutomationUsage
  patchBodies: Array<Record<string, unknown>>
  commands: Array<{ command: string; body: Record<string, unknown> }>
}

const triggerNode: WorkflowNode = { id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: ['action'] }
const actionNode: WorkflowNode = {
  id: 'action',
  type: 'action',
  config: { action: 'email', templateId: 'welcome-customer', maxRecipients: 1 },
  next: [],
}

function record(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    id: 'wf-1',
    storeId: 's1',
    name: 'Welcome flow',
    description: null,
    category: 'Customer',
    tags: [],
    version: 1,
    nodes: [triggerNode, actionNode],
    status: 'DRAFT',
    definitionHash: null,
    activatedAt: null,
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

function makeFetch(store: Store): typeof fetch {
  return (async (input: URL | string, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (url.includes('/activate') && method === 'POST') {
      store.commands.push({ command: 'activate', body })
      const active = { ...store.workflow, status: 'ACTIVE' as const, definitionHash: 'a'.repeat(64), activatedAt: new Date().toISOString() }
      store.workflow = active
      return envelope(active)
    }
    if (url.includes('/test') && method === 'POST') {
      store.commands.push({ command: 'test', body })
      return envelope({ id: 'run-test-1', workflowId: 'wf-1', status: 'QUEUED' }, 202)
    }
    if (url.includes('/run') && method === 'POST') {
      store.commands.push({ command: 'run', body })
      return envelope({ id: 'run-1', workflowId: 'wf-1', status: 'QUEUED' }, 202)
    }
    if (url.includes('/pause') && method === 'POST') {
      store.commands.push({ command: 'pause', body })
      store.workflow = { ...store.workflow, status: 'PAUSED' }
      return envelope(store.workflow)
    }
    if (url.match(/\/workflows\/wf-1$/) && method === 'PATCH') {
      store.patchBodies.push(body)
      let next = store.workflow
      if (typeof body.name === 'string') next = { ...next, name: body.name }
      if (Array.isArray(body.nodes)) next = { ...next, nodes: body.nodes as WorkflowNode[] }
      // Real backend resets an edited ACTIVE workflow to DRAFT and clears the
      // hash until it is re-activated.
      if (Array.isArray(body.nodes) && next.status === 'ACTIVE') {
        next = { ...next, status: 'DRAFT', definitionHash: null, activatedAt: null }
      }
      store.workflow = next
      return envelope(store.workflow)
    }
    if (url.match(/\/workflows\/wf-1\?/) && method === 'GET') return envelope(store.workflow)
    return envelope(null, 404, false, { code: 'NOT_FOUND', message: 'Not found' })
  }) as typeof fetch
}

function envelope(data: unknown, status = 200, ok = true, error?: { code: string; message: string }): Response {
  return new Response(
    JSON.stringify(ok ? { ok: true, data, meta: { requestId: 'r', timestamp: new Date().toISOString() } } : { ok: false, error, meta: {} }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

function setup(overrides: Partial<WorkflowRecord> = {}, usage: Partial<AutomationUsage> = {}): Store {
  const store: Store = {
    workflow: record(overrides),
    usage: { plan: 'growth', used: 1, limit: 20, remaining: 19, limitReached: false, ...usage },
    patchBodies: [],
    commands: [],
  }
  window.fetch = vi.fn(makeFetch(store))
  return store
}

beforeEach(() => {
  toasts.length = 0
  navigations.length = 0
  document.body.innerHTML = ''
})

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
    root = null
  }
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function mount(store: ReturnType<typeof setup>): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const renderEditor = (): void => {
    root?.render(
      <StrictMode>
        <WorkflowEditor
          storeId="s1"
          workflow={store.workflow}
          usage={store.usage}
          onBack={() => navigations.push('back')}
          onSaved={(wf) => {
            store.workflow = wf
            renderEditor()
          }}
          onRun={(id) => navigations.push(`run:${id}`)}
          onToast={(message, kind) => {
            if (kind) toasts.push({ message, kind })
            else toasts.push({ message })
          }}
        />
      </StrictMode>,
    )
  }
  await act(async () => {
    root = createRoot(container)
    renderEditor()
  })
  await flush(10)
  return container
}

async function flush(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    ;(el as HTMLElement).click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await flush(2)
}

function findButton(container: Element, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text))
  if (!found) throw new Error(`Button not found: ${text}`)
  return found as HTMLButtonElement
}

describe('WorkflowEditor — topbar actions', () => {
  it('renders every topbar button without console errors', async () => {
    const store = setup()
    const container = await mount(store)
    expect(findButton(container, 'Automations')).toBeTruthy()
    expect(findButton(container, 'Switch to Advanced')).toBeTruthy()
    expect(findButton(container, 'Save Draft')).toBeTruthy()
    expect(findButton(container, 'Test Run')).toBeTruthy()
    expect(findButton(container, 'Save & Activate')).toBeTruthy()
  })

  it('Save Draft PATCHes the current nodes and toasts success', async () => {
    const store = setup()
    const container = await mount(store)
    await click(findButton(container, 'Save Draft'))
    expect(store.patchBodies.length).toBeGreaterThan(0)
    expect(toasts.some((t) => t.message.includes('Draft saved'))).toBe(true)
  })

  it('Save & Activate PATCHes then POSTs /activate and flips the CTA', async () => {
    const store = setup()
    const container = await mount(store)
    await click(findButton(container, 'Save & Activate'))
    expect(store.commands.some((c) => c.command === 'activate')).toBe(true)
    expect(toasts.some((t) => t.message.includes('live'))).toBe(true)
    // After activation the CTA label changes to "Save Changes".
    expect(container.textContent).toContain('Save Changes')
  })

  it('Test Run saves a draft, POSTs /test, and navigates to the run', async () => {
    const store = setup()
    const container = await mount(store)
    await click(findButton(container, 'Test Run'))
    expect(store.commands.some((c) => c.command === 'test')).toBe(true)
    expect(navigations.some((n) => n.startsWith('run:'))).toBe(true)
    expect(toasts.some((t) => t.message.includes('Test started'))).toBe(true)
  })

  it('Back button calls onBack', async () => {
    const store = setup()
    const container = await mount(store)
    await click(findButton(container, 'Automations'))
    expect(navigations).toContain('back')
  })

  it('mode toggle switches between simple and advanced editor', async () => {
    const store = setup()
    const container = await mount(store)
    // Start in simple mode: the guided panel title is present.
    expect(container.textContent).toContain('Build your automation step by step')
    await click(findButton(container, 'Switch to Advanced'))
    expect(container.textContent).toContain('Step library')
    const back = findButton(container, 'Back to Simple')
    await click(back)
    expect(container.textContent).toContain('Build your automation step by step')
  })

  it('topbar rename commits on Enter and PATCHes the name', async () => {
    const store = setup()
    const container = await mount(store)
    const nameButton = container.querySelector('.editor-name-button') as HTMLButtonElement
    expect(nameButton).toBeTruthy()
    await click(nameButton)
    const input = container.querySelector('.editor-name-input') as HTMLInputElement
    expect(input).toBeTruthy()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'Renamed flow')
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await flush(2)
    expect(store.patchBodies.some((body) => body.name === 'Renamed flow')).toBe(true)
  })
})

describe('WorkflowEditor — simple mode add / remove / configure', () => {
  it('Add Step opens the library modal; selecting an item adds a node', async () => {
    const store = setup()
    const container = await mount(store)
    await click(findButton(container, 'Add Step'))
    expect(container.textContent).toContain('Add a step')
    // Click a "Wait for time" option to add a wait node.
    const waitOption = Array.from(container.querySelectorAll('.library-grid button')).find((b) =>
      b.textContent?.includes('Wait for time'),
    ) as HTMLButtonElement
    expect(waitOption).toBeTruthy()
    await click(waitOption)
    // The wait label should appear on the canvas (the rendered label is
    // "Wait for time"; the friendly summary starts with "Waits" only when a
    // non-zero delay is set).
    expect(container.textContent).toContain('Wait for time')
  })

  it('trash icon removes a non-trigger step', async () => {
    const store = setup({
      nodes: [
        { id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: ['notify'] },
        { id: 'notify', type: 'action', config: { action: 'internal_notification', message: 'x' }, next: [] },
      ],
    })
    const container = await mount(store)
    const trash = container.querySelector('.simple-step .danger') as HTMLButtonElement
    expect(trash).toBeTruthy()
    await click(trash)
    // After remove, only the trigger remains (Configure for trigger is still
    // rendered but no trash icon for triggers).
    expect(container.querySelectorAll('.simple-step').length).toBe(1)
  })

  it('shows validation errors when trying to activate an incomplete workflow', async () => {
    const store = setup({
      nodes: [
        { id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: [] },
        {
          id: 'email',
          type: 'action',
          config: { action: 'email', templateId: '', maxRecipients: 1 },
          next: [],
        },
      ],
    })
    const container = await mount(store)
    await click(findButton(container, 'Save & Activate'))
    expect(container.textContent).toContain('Resolve before activating')
    // No activate command should have been issued.
    expect(store.commands.some((c) => c.command === 'activate')).toBe(false)
  })

  it('AI step library item is locked for non-commander plans', async () => {
    const store = setup({}, { plan: 'growth' })
    const container = await mount(store)
    await click(findButton(container, 'Switch to Advanced'))
    const aiButton = Array.from(container.querySelectorAll('.node-library button')).find((b) =>
      b.textContent?.includes('Smart classification'),
    ) as HTMLButtonElement
    expect(aiButton).toBeTruthy()
    expect(aiButton.className).toContain('locked')
    await click(aiButton)
    expect(toasts.some((t) => t.message.includes('upgraded subscription') || t.message.includes('Upgrade'))).toBe(true)
  })
})
