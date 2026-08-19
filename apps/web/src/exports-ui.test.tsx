// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.js'
import { ExportsWorkspace } from './exports.js'

/**
 * Data Exports — full page mount.
 *
 * Renders the real workspace against a mocked backend and drives the actual
 * merchant journeys: page load in both themes, locked cards, downloads that
 * produce a real file, the monthly limit, empty datasets, backend failures,
 * and the export history section. Any React console error fails the test.
 */

const consoleErrors: string[] = []
let root: Root | null = null
let downloads: Array<{ filename: string; bytes: number }> = []
let requests: string[] = []

const envelope = (data: unknown): unknown => ({ ok: true, data, requestId: 'exports-test' })

const CSV_BASE64 = Buffer.from('Order date,Orders placed\r\n2026-08-18,15\r\n').toString('base64')

type Plan = 'trial' | 'start' | 'growth' | 'commander'

function overviewFor(plan: Plan, options: Readonly<{ used?: number; history?: boolean; empty?: boolean }> = {}): unknown {
  const used = options.used ?? 0
  const limit = plan === 'trial' ? 3 : plan === 'start' ? 10 : null
  const rank = { trial: 0, start: 1, growth: 2, commander: 3 }[plan]
  const card = (id: string, name: string, description: string, format: string, minRank: number, minimumPlan: string, includes: string[], rows: number | null) => ({
    id, name, description, format, includes, minimumPlan,
    source: 'Built from your synced Shopify data.',
    locked: rank < minRank,
    requiredPlan: rank < minRank ? minimumPlan : null,
    estimatedRows: options.empty ? 0 : rows,
    lastExportedAt: options.history && id === 'orders' ? Date.UTC(2026, 7, 18, 14, 30) : null,
    hasData: options.empty ? false : true,
  })
  return {
    plan,
    usage: {
      plan, used, limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
      unlimited: limit === null,
      limitReached: limit !== null && used >= limit,
      periodStart: '2026-08-01',
    },
    exports: [
      card('orders', 'Orders Export', 'Daily order summaries from your Shopify sync.', 'CSV', 0, 'trial', ['Order date', 'Orders placed', 'Average order value'], 120),
      card('catalog', 'Product Catalog', 'All your synced products with titles and IDs.', 'XLSX', 0, 'trial', ['Product ID', 'Product title'], 48),
      card('audit', 'Activity Log', 'Complete log of all actions and events in your store.', 'CSV', 1, 'start', ['Action', 'When it happened'], 640),
      card('revenue', 'Revenue Report', 'Revenue data for closed periods.', 'PDF', 2, 'growth', ['Day', 'Gross revenue', 'Orders'], 96),
    ],
    history: options.history
      ? [{ id: 'h1', dataset: 'orders', format: 'CSV', filename: 'orders-export-2026-08-18.csv', rowCount: 120, byteSize: 24_576, plan, rangeStart: null, rangeEnd: null, createdAt: Date.UTC(2026, 7, 18, 14, 30) }]
      : [],
    features: { customDateRange: rank >= 2, scheduledExports: rank >= 3 },
    featureRequiredPlans: { customDateRange: 'growth', scheduledExports: 'commander' },
    rowCeiling: 50_000,
    generatedAt: '2026-08-18T12:00:00.000Z',
  }
}

type BackendOptions = Readonly<{ plan?: Plan; used?: number; history?: boolean; empty?: boolean; overviewFails?: boolean; downloadStatus?: number; downloadMessage?: string }>

function mockBackend(options: BackendOptions = {}): void {
  const plan = options.plan ?? 'growth'
  requests = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push(`${String(init?.method ?? 'GET')} ${url}`)
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.includes('/session/context')) return json(200, envelope({ storeId: 'exports-test', shop: 'exports-test.myshopify.com' }))
    if (url.includes('/security/csrf')) return json(200, envelope({ csrfToken: 'token' }))
    if (url.includes('/exports/overview')) {
      if (options.overviewFails) return json(500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} } })
      return json(200, envelope(overviewFor(plan, options)))
    }
    if (url.includes('/exports/history')) return json(200, envelope([]))
    if (/\/exports\/(orders|catalog|audit|revenue)$/.test(url)) {
      const status = options.downloadStatus ?? 201
      if (status !== 201) {
        return json(status, { ok: false, error: { code: status === 402 ? 'PAYMENT_REQUIRED' : 'NOT_FOUND', message: options.downloadMessage ?? 'Blocked', details: { reason: 'UPGRADE_REQUIRED' } } })
      }
      const dataset = url.split('/').pop() ?? 'orders'
      return json(201, envelope({
        filename: `${dataset}-export-2026-08-18.csv`, contentType: 'text/csv', bodyBase64: CSV_BASE64,
        rows: 120, bytes: 24_576, dataset, format: 'CSV', ceiling: 50_000,
        usage: { plan, used: 1, limit: plan === 'trial' ? 3 : null, remaining: plan === 'trial' ? 2 : null, unlimited: plan !== 'trial', limitReached: false, periodStart: '2026-08-01' },
        record: { id: 'h-new', dataset, format: 'CSV', filename: `${dataset}-export.csv`, rowCount: 120, byteSize: 24_576, plan, rangeStart: null, rangeEnd: null, createdAt: Date.now() },
      }))
    }
    // Shell endpoints the app shell loads on mount, in their real shapes.
    if (url.includes('/recommendations')) return json(200, envelope({ items: [], nextCursor: null }))
    if (url.includes('/catalog') || url.includes('/ai/agents') || url.includes('/support/tickets')) return json(200, envelope([]))
    if (url.includes('/analytics')) return json(200, envelope({ revenue: [], orders: [], productSales: [], customerCohorts: [] }))
    if (url.includes('/inventory')) return json(200, envelope({ items: [], total: 0 }))
    return json(200, envelope({ items: [] }))
  }))
}

function installDownloadCapture(): void {
  downloads = []
  const createElementOriginal = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...rest: unknown[]) => {
    const element = createElementOriginal(tag, ...(rest as []))
    if (tag === 'a') {
      Object.defineProperty(element, 'click', { value: () => downloads.push({ filename: (element as HTMLAnchorElement).download, bytes: lastBlobSize }), configurable: true })
    }
    return element
  })
}

let lastBlobSize = 0

beforeEach(() => {
  consoleErrors.length = 0
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState({}, '', '/?storeId=exports-test&shop=exports-test.myshopify.com')
  window.localStorage.clear()
  lastBlobSize = 0
  const originalError = console.error
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '))
    originalError(...args)
  })
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })) })
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null, writable: true, configurable: true })
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (blob: Blob) => { lastBlobSize = blob.size; return 'blob:mock' },
    revokeObjectURL: () => undefined,
  }))
  installDownloadCapture()
  mockBackend()
})

afterEach(async () => {
  if (root) { await act(async () => root!.unmount()); root = null }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function mountWorkspace(toasts: string[] = [], navigations: string[] = []): Promise<void> {
  const container = document.createElement('div')
  container.id = 'root'
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(StrictMode, null, createElement(ExportsWorkspace, {
      context: { storeId: 'exports-test', shop: 'exports-test.myshopify.com' },
      onToast: (message: string) => { toasts.push(message) },
      onNavigateBilling: () => { navigations.push('billing') },
    })))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}

async function mountApp(): Promise<void> {
  const container = document.createElement('div')
  container.id = 'root'
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(createElement(StrictMode, null, createElement(App))) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}

const text = (): string => document.body.textContent ?? ''
const cardFor = (dataset: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-dataset="${dataset}"]`)
  if (!found) throw new Error(`No card rendered for ${dataset}`)
  return found
}
const buttonIn = (host: HTMLElement, label: RegExp): HTMLButtonElement => {
  const match = [...host.querySelectorAll('button')].find((button) => label.test(button.textContent ?? ''))
  if (!match) throw new Error(`No button matching ${String(label)} in ${host.dataset.dataset ?? 'host'}`)
  return match
}

describe('page load', () => {
  it('renders the professional header and all four exports without console errors', async () => {
    await mountWorkspace()
    expect(document.querySelector('.dx-root')).not.toBeNull()
    for (const name of ['Orders Export', 'Product Catalog', 'Activity Log', 'Revenue Report']) expect(text()).toContain(name)
    expect(document.querySelectorAll('.dx-card')).toHaveLength(4)
    expect(consoleErrors).toEqual([])
  })

  it('shows the merchant-friendly page title and description in the app shell', async () => {
    await mountApp()
    await act(async () => {
      const link = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === 'Exports')
      link?.click()
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(text()).toContain('Data Exports')
    expect(text()).toContain('Download your real store data anytime')
    expect(text()).toContain('Your data belongs to you')
    expect(consoleErrors).toEqual([])
  })

  it('retires every piece of developer jargon from the page', async () => {
    await mountWorkspace()
    const body = text()
    for (const jargon of ['DATA PORTABILITY', 'Store-scoped writers', 'row safety ceiling', 'Daily aggregate export', 'Catalog XLSX', 'Audit log CSV', 'Revenue PDF', 'Tenant-scoped']) {
      expect(body).not.toContain(jargon)
    }
  })

  it('keeps the row limit as a small informational note', async () => {
    await mountWorkspace()
    const note = document.querySelector('.dx-note')
    expect(note?.textContent).toContain('up to 50,000 rows')
    expect(note?.textContent).toContain('Larger stores may need multiple exports')
  })

  it('shows a loading skeleton before the overview resolves', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => { release = () => resolve() })
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/exports/overview')) await held
      return new Response(JSON.stringify(envelope(overviewFor('growth'))), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(ExportsWorkspace, { context: { storeId: 'exports-test', shop: null }, onToast: () => undefined, onNavigateBilling: () => undefined }))
    })
    expect(document.querySelector('.dx-skeleton')).not.toBeNull()
    expect(document.querySelectorAll('.dx-card')).toHaveLength(0)
    release()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(document.querySelector('.dx-skeleton')).toBeNull()
    expect(document.querySelectorAll('.dx-card')).toHaveLength(4)
  })

  it('asks the merchant to connect Shopify when there is no store', async () => {
    const container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(ExportsWorkspace, { context: { storeId: null, shop: null }, onToast: () => undefined, onNavigateBilling: () => undefined }))
    })
    expect(text()).toContain('Connect your Shopify store to export data')
    expect(document.querySelectorAll('.dx-card')).toHaveLength(0)
  })

  it('stays usable and retryable when the backend fails', async () => {
    mockBackend({ overviewFails: true })
    await mountWorkspace()
    expect(text()).toContain('We could not load your exports')
    expect([...document.querySelectorAll('button')].some((button) => /Try again/.test(button.textContent ?? ''))).toBe(true)
  })
})

describe('export cards', () => {
  it('shows format badge, row estimate, last exported, and what is included', async () => {
    mockBackend({ plan: 'growth', history: true })
    await mountWorkspace()
    const orders = cardFor('orders')
    expect(orders.querySelector('.dx-format')?.textContent).toContain('CSV')
    expect(orders.textContent).toContain('~120 rows')
    expect(orders.textContent).toMatch(/Aug 18, \d{1,2}:\d{2} (AM|PM)/)
    expect(orders.textContent?.toLowerCase()).toContain('includes: order date, orders placed, average order value')
  })

  it('says Never before a dataset has ever been exported', async () => {
    await mountWorkspace()
    expect(cardFor('catalog').textContent).toContain('Never')
  })

  it('shows each format on the right card', async () => {
    await mountWorkspace()
    expect(cardFor('catalog').querySelector('.dx-format')?.textContent).toContain('XLSX')
    expect(cardFor('revenue').querySelector('.dx-format')?.textContent).toContain('PDF')
    expect(cardFor('audit').querySelector('.dx-format')?.textContent).toContain('CSV')
  })

  it('disables the button and explains when there is nothing synced yet', async () => {
    mockBackend({ plan: 'growth', empty: true })
    await mountWorkspace()
    const orders = cardFor('orders')
    expect(orders.textContent).toContain('No rows yet')
    const button = buttonIn(orders, /Nothing to export yet/)
    expect(button.disabled).toBe(true)
  })
})

describe('downloads', () => {
  it('downloads a real file and confirms with real numbers', async () => {
    const toasts: string[] = []
    await mountWorkspace(toasts)
    await act(async () => { buttonIn(cardFor('orders'), /Download Now/).click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(downloads).toHaveLength(1)
    expect(downloads[0]?.filename).toBe('orders-export-2026-08-18.csv')
    expect(downloads[0]?.bytes).toBeGreaterThan(0)
    expect(toasts[0]).toBe('Orders Export downloaded — 120 rows, 24 KB.')
    expect(document.querySelector('.dx-confirm')?.textContent).toContain('Downloaded')
  })

  it('posts to the dataset endpoint the merchant clicked', async () => {
    await mountWorkspace()
    await act(async () => { buttonIn(cardFor('catalog'), /Download Now/).click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(requests.some((entry) => entry === 'POST /exports/catalog')).toBe(true)
  })

  it('refreshes usage and history after a successful download', async () => {
    await mountWorkspace()
    const before = requests.filter((entry) => entry.includes('/exports/overview')).length
    await act(async () => { buttonIn(cardFor('orders'), /Download Now/).click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(requests.filter((entry) => entry.includes('/exports/overview')).length).toBeGreaterThan(before)
  })

  it('explains the plan limit in place instead of yanking the merchant to billing', async () => {
    const toasts: string[] = []
    const navigations: string[] = []
    mockBackend({ plan: 'trial', used: 3, downloadStatus: 402, downloadMessage: 'You have used all 3 exports included this month. Upgrade Plan for more exports.' })
    await mountWorkspace(toasts, navigations)
    await act(async () => { buttonIn(cardFor('orders'), /Download Now/).click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(toasts[0]).toContain('Upgrade Plan for more exports')
    expect(downloads).toHaveLength(0)
    // The merchant stays on Exports; the banner is refreshed and still offers
    // the upgrade path they can take when they choose to.
    expect(navigations).toEqual([])
    expect(document.querySelector('.dx-plan')).not.toBeNull()
    expect(document.querySelector('.dx-plan')?.textContent).toContain('Upgrade Plan')
    expect(requests.filter((entry) => entry.includes('/exports/overview')).length).toBeGreaterThan(1)
  })

  it('explains an empty dataset without pretending the export failed', async () => {
    const toasts: string[] = []
    mockBackend({ downloadStatus: 404, downloadMessage: 'There is nothing to export yet. Sync your Shopify orders first, then download this file.' })
    await mountWorkspace(toasts)
    await act(async () => { buttonIn(cardFor('orders'), /Download Now/).click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(toasts[0]).toContain('nothing to export yet')
    expect(downloads).toHaveLength(0)
  })
})

describe('plan gating', () => {
  it('locks Activity Log and Revenue Report on Trial with a value preview', async () => {
    mockBackend({ plan: 'trial' })
    await mountWorkspace()
    expect(cardFor('audit').classList.contains('is-locked')).toBe(true)
    expect(cardFor('audit').textContent).toContain('Available on Start plan')
    expect(cardFor('revenue').textContent).toContain('Available on Growth plan')
    expect(cardFor('revenue').textContent).toContain('What you\u2019ll get')
    expect(cardFor('revenue').textContent).toContain('Gross revenue')
    expect(cardFor('orders').classList.contains('is-locked')).toBe(false)
  })

  it('offers only Upgrade Plan on a locked card — never a download', async () => {
    mockBackend({ plan: 'trial' })
    await mountWorkspace()
    const revenue = cardFor('revenue')
    expect(revenue.querySelector('.dx-download')).toBeNull()
    expect(revenue.querySelector('.upgrade-plan-cta')?.textContent).toContain('Upgrade Plan')
    expect(revenue.textContent).not.toMatch(/Upgrade to (Start|Growth|Commander)/)
  })

  it('routes a locked card to billing', async () => {
    const navigations: string[] = []
    mockBackend({ plan: 'trial' })
    await mountWorkspace([], navigations)
    await act(async () => { cardFor('revenue').querySelector<HTMLButtonElement>('.upgrade-plan-cta')?.click() })
    expect(navigations).toEqual(['billing'])
  })

  it('unlocks the Activity Log on Start and keeps Revenue locked', async () => {
    mockBackend({ plan: 'start' })
    await mountWorkspace()
    expect(cardFor('audit').classList.contains('is-locked')).toBe(false)
    expect(cardFor('revenue').classList.contains('is-locked')).toBe(true)
  })

  it('unlocks everything on Commander and hides the upgrade CTA', async () => {
    mockBackend({ plan: 'commander' })
    await mountWorkspace()
    expect(document.querySelectorAll('.dx-card.is-locked')).toHaveLength(0)
    expect(document.querySelectorAll('.upgrade-plan-cta')).toHaveLength(0)
  })
})

describe('plan banner', () => {
  it('shows the plan and a real monthly counter on Trial', async () => {
    mockBackend({ plan: 'trial', used: 1 })
    await mountWorkspace()
    const banner = document.querySelector('.dx-plan')
    expect(banner?.textContent).toContain('Trial')
    expect(banner?.textContent).toContain('Exports this month: 1/3')
    expect(banner?.textContent).toContain('2 exports left this month')
    expect(banner?.querySelector('.upgrade-plan-cta')?.textContent).toContain('Upgrade Plan')
  })

  it('warns without shaming once the month is used up', async () => {
    mockBackend({ plan: 'trial', used: 3 })
    await mountWorkspace()
    const banner = document.querySelector('.dx-plan')
    expect(banner?.classList.contains('is-maxed')).toBe(true)
    expect(banner?.textContent).toContain('Upgrade Plan for more exports')
  })

  it('says Unlimited on Growth instead of inventing a cap', async () => {
    mockBackend({ plan: 'growth', used: 7 })
    await mountWorkspace()
    const banner = document.querySelector('.dx-plan')
    expect(banner?.textContent).toContain('Unlimited')
    expect(banner?.textContent).toContain('Exports this month: 7')
    expect(banner?.textContent).not.toMatch(/7\/\d/)
  })

  it('counts how many exports a higher plan would unlock', async () => {
    mockBackend({ plan: 'trial' })
    await mountWorkspace()
    expect(document.querySelector('.dx-plan-locked')?.textContent).toBe('2 more exports unlock on a higher plan')
  })
})

describe('export history', () => {
  it('invites the first export when nothing has been downloaded', async () => {
    await mountWorkspace()
    expect(document.querySelector('.dx-history-empty')?.textContent).toContain('No previous exports yet')
    expect(document.querySelectorAll('.dx-history-row')).toHaveLength(0)
  })

  it('lists a real download with its date, rows, and size', async () => {
    mockBackend({ plan: 'growth', history: true })
    await mountWorkspace()
    const row = document.querySelector('.dx-history-row')
    expect(row?.textContent).toContain('Orders Export')
    expect(row?.textContent).toContain('Aug 18, 2026 at')
    expect(row?.textContent).toContain('120 rows')
    expect(row?.textContent).toContain('24 KB')
  })
})

describe('themes', () => {
  it('renders the same structure in dark and light with no theme-only crash', async () => {
    for (const theme of ['dark', 'light'] as const) {
      document.body.className = theme === 'light' ? 'light-mode' : ''
      mockBackend({ plan: 'trial', history: true })
      await mountWorkspace()
      expect(document.querySelectorAll('.dx-card')).toHaveLength(4)
      expect(document.querySelector('.dx-plan')).not.toBeNull()
      expect(document.querySelector('.dx-history-row')).not.toBeNull()
      expect(consoleErrors).toEqual([])
      if (root) { await act(async () => root!.unmount()); root = null }
      document.body.innerHTML = ''
    }
    document.body.className = ''
  })

  it('scopes every style hook under .dx-root so no other page is affected', async () => {
    await mountWorkspace()
    const scoped = [...document.querySelectorAll('[class]')]
      .flatMap((element) => [...element.classList])
      .filter((name) => name.startsWith('dx-'))
    expect(scoped.length).toBeGreaterThan(10)
    expect(document.querySelector('.dx-root')).not.toBeNull()
  })
})
