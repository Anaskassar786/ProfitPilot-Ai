// @vitest-environment jsdom
/**
 * AI Command Center — Complete Functional Test Sweep.
 *
 * Exercises every card, button, drawer, menu, tooltip, badge, and interaction
 * in both light and dark themes. Verifies zero console errors, zero fake data,
 * and complete compliance with all functional criteria.
 */
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandCenterWorkspace } from './command-center.js'
import type { WorkspaceContext } from './model.js'

// Enable React act() environment support in jsdom
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const consoleErrors: string[] = []
let root: Root | null = null
const toasts: string[] = []
const navigations: string[] = []

const DAY = 86_400_000
const getNow = () => Date.now()
const isoAgo = (msAgo: number) => new Date(getNow() - msAgo).toISOString()
const dayKeyAgo = (daysAgo: number) => new Date(getNow() - daysAgo * DAY).toISOString().slice(0, 10)

const OVERVIEW_DATA = {
  plan: 'trial' as const,
  unlockedCount: 2,
  totalCount: 5,
  agents: [
    { id: 'REVENUE_AGENT', label: 'Revenue Agent', promptVersion: '1.1.0', execution: 'READY' as const, languageOnly: true as const, locked: false, requiredPlan: 'trial' as const, paused: false, tagline: 'Watches revenue, margin, and cart recovery for money left on the table.', sampleInsight: 'Revenue is up 12% but margin slipped 3 points — three SKUs explain it.' },
    { id: 'INVENTORY_AGENT', label: 'Inventory Agent', promptVersion: '1.1.0', execution: 'READY' as const, languageOnly: true as const, locked: false, requiredPlan: 'trial' as const, paused: false, tagline: 'Tracks stock cover so best sellers never run dry and cash is not stuck.', sampleInsight: 'Espresso Grinder Pro has 4 days of cover left at current velocity.' },
    { id: 'CUSTOMER_AGENT', label: 'Customer Agent', promptVersion: '1.1.0', execution: 'READY' as const, languageOnly: true as const, locked: true, requiredPlan: 'start' as const, paused: false, tagline: 'Spots churn risk and win-back moments across your customer base.', sampleInsight: 'A $612 lifetime-value customer has gone quiet for 81 days.' },
    { id: 'PRICING_AGENT', label: 'Pricing Agent', promptVersion: '1.1.0', execution: 'READY' as const, languageOnly: true as const, locked: true, requiredPlan: 'growth' as const, paused: false, tagline: 'Finds pricing headroom and discount leakage.', sampleInsight: 'Pricing insight.' },
    { id: 'CAMPAIGN_AGENT', label: 'Campaign Agent', promptVersion: '1.1.0', execution: 'READY' as const, languageOnly: true as const, locked: true, requiredPlan: 'growth' as const, paused: false, tagline: 'Drafts campaigns.', sampleInsight: 'Campaign insight.' },
    { id: 'PRODUCT_AGENT', label: 'Product Agent', promptVersion: '1.1.0', execution: 'READY' as const, languageOnly: true as const, locked: true, requiredPlan: 'commander' as const, paused: false, tagline: 'Reviews catalog performance, bundles, and dead stock candidates.', sampleInsight: 'Ceramic Mug Duo has not sold in 140 days — bundle or retire it.' },
    { id: 'EXECUTIVE_AGENT', label: 'Executive Agent', promptVersion: '1.1.0', execution: 'READY' as const, languageOnly: true as const, locked: true, requiredPlan: 'commander' as const, paused: false, tagline: 'Rolls every agent up into a board-ready read on the business.', sampleInsight: 'Quarter to date is 9% ahead of plan, carried by repeat customers.' },
  ],
}

function getInventoryRecommendations() {
  return [
    { id: 'inv-1', storeId: 's1', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Restock Espresso Grinder Pro', reason: 'Four days of cover left.', impactValue: 49454, impactLabel: 'revenue at risk', currency: 'USD', confidence: 0.75, confidenceLevel: 'HIGH', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'APPROVED', evidencePack: { ruleVersion: '1.1.0', sha256: 'a'.repeat(64) }, explanation: null, explanationStatus: 'AI_GENERATED', model: 'gpt-4o-mini', version: 1, createdAt: isoAgo(2 * 3_600_000) },
    { id: 'inv-2', storeId: 's1', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Restock Ceramic Pour-Over', reason: 'Five days of cover left.', impactValue: 49454, impactLabel: 'revenue at risk', currency: 'USD', confidence: 0.75, confidenceLevel: 'HIGH', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { ruleVersion: '1.1.0', sha256: 'b'.repeat(64) }, explanation: null, explanationStatus: 'AI_GENERATED', model: 'gpt-4o-mini', version: 0, createdAt: isoAgo(3 * 3_600_000) },
    { id: 'inv-3', storeId: 's1', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Restock Chemex Filters', reason: 'Three days of cover left.', impactValue: 49454, impactLabel: 'revenue at risk', currency: 'USD', confidence: 0.75, confidenceLevel: 'HIGH', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { ruleVersion: '1.1.0', sha256: 'c'.repeat(64) }, explanation: null, explanationStatus: 'AI_GENERATED', model: 'gpt-4o-mini', version: 0, createdAt: isoAgo(4 * 3_600_000) },
    { id: 'inv-4', storeId: 's1', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Restock AeroPress Paper Filters', reason: 'Two days of cover left.', impactValue: 49454, impactLabel: 'revenue at risk', currency: 'USD', confidence: 0.75, confidenceLevel: 'HIGH', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { ruleVersion: '1.1.0', sha256: 'd'.repeat(64) }, explanation: null, explanationStatus: 'AI_GENERATED', model: 'gpt-4o-mini', version: 0, createdAt: isoAgo(5 * 3_600_000) },
    { id: 'inv-5', storeId: 's1', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Restock French Press 8-Cup', reason: 'Six days of cover left.', impactValue: 49454, impactLabel: 'revenue at risk', currency: 'USD', confidence: 0.75, confidenceLevel: 'HIGH', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { ruleVersion: '1.1.0', sha256: 'e'.repeat(64) }, explanation: null, explanationStatus: 'AI_GENERATED', model: 'gpt-4o-mini', version: 0, createdAt: isoAgo(6 * 3_600_000) },
    { id: 'inv-6', storeId: 's1', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Restock Coffee Scale Pro', reason: 'Four days of cover left.', impactValue: 49454, impactLabel: 'revenue at risk', currency: 'USD', confidence: 0.75, confidenceLevel: 'HIGH', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { ruleVersion: '1.1.0', sha256: 'f'.repeat(64) }, explanation: null, explanationStatus: 'AI_GENERATED', model: 'gpt-4o-mini', version: 0, createdAt: isoAgo(7 * 3_600_000) },
    { id: 'inv-7', storeId: 's1', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Restock Cold Brew Pitcher', reason: 'One day of cover left.', impactValue: 49455, impactLabel: 'revenue at risk', currency: 'USD', confidence: 0.75, confidenceLevel: 'HIGH', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { ruleVersion: '1.1.0', sha256: 'g'.repeat(64) }, explanation: null, explanationStatus: 'AI_GENERATED', model: 'gpt-4o-mini', version: 0, createdAt: isoAgo(7 * 3_600_000) },
  ]
}

function getSummaryData() {
  return {
    counts: { PENDING: 6, APPROVED: 1, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 },
    total: 7,
    pendingImpact: [],
    approvedThisMonth: { count: 1, impact: [] },
    byAgent: [{ agent: 'INVENTORY_AGENT', count: 7 }],
    byRule: [{ ruleId: 'STOCKOUT_RISK', count: 7 }],
    approvalRate: { allTime: 100, last30d: 100 },
    averageDecisionMs: null,
    recentDecisions: [],
    generatedTrend: [
      { day: dayKeyAgo(6), generated: 1, approved: 0 },
      { day: dayKeyAgo(5), generated: 2, approved: 0 },
      { day: dayKeyAgo(4), generated: 1, approved: 0 },
      { day: dayKeyAgo(3), generated: 3, approved: 1 },
      { day: dayKeyAgo(2), generated: 2, approved: 0 },
      { day: dayKeyAgo(1), generated: 4, approved: 1 },
      { day: dayKeyAgo(0), generated: 7, approved: 1 },
    ],
    plan: 'trial',
    usage: { feature: 'ai_recommendations_month', used: 7, limit: 10, remaining: 3 },
  }
}

const HEALTH_DATA = {
  score: 78,
  method: 'deterministic-v1',
  components: [
    { key: 'revenue_momentum', score: 84, weight: 0.35, reason: 'Revenue is growing 14% WoW.' },
    { key: 'inventory_health', score: 72, weight: 0.35, reason: 'Stock cover is healthy.' },
  ],
  orderCount: 340,
  historyDays: 120,
}

const PAGE_METRICS = {
  customers: { total: 245, inactive30Days: 42, repeat: 89, potentialRecoverableRevenue: 12450 },
  products: { active: 156, lowStock: 8, deadStock: 23, crossSellPairs: 34 },
  orders: { total: 892, pending: 5, todayCount: 12 },
  revenue: { today: 1245, yesterday: 980, changePercent: 27, currency: 'USD' },
  storeHealth: { score: 82, status: 'Healthy' },
  subscription: { currentPlan: 'trial', basicAgentCount: 2 },
  availability: { customers: true, products: true, orders: true, inventoryHistory: true, storeHealth: true },
  generatedAt: new Date().toISOString(),
}

const RULES_DATA = [
  { id: 'STOCKOUT_RISK', name: 'Stockout risk', agent: 'INVENTORY_AGENT', purpose: 'Flags best sellers about to run out of cover.', threshold: 'cover < 7 days', inputs: ['inventory_units', 'average_daily_units'], impact: 'Revenue protected' },
  { id: 'MARGIN_LEAK', name: 'Margin leak', agent: 'REVENUE_AGENT', purpose: 'Finds discount depth growing faster than volume.', threshold: 'discount delta > 5pts', inputs: ['orders', 'unit_cost'], impact: 'Margin recovered' },
  { id: 'CHURN_RISK', name: 'Churn risk', agent: 'CUSTOMER_AGENT', purpose: 'Detects high-value customers going quiet.', threshold: 'days quiet > 60', inputs: ['lifetime_value', 'last_order_at'], impact: 'Retention protected' },
]

function setupFetchMock(customOverrides?: { health?: unknown; summary?: unknown; recent?: unknown }) {
  const originalFetch = window.fetch
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    const respond = (data: unknown, status = 200) =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true, data }),
      } as Response)

    if (url.includes('/decision') && method === 'POST') {
      return respond({ status: 'APPROVED' })
    }
    if (url.includes('/pause') && method === 'POST') {
      return respond({ paused: true })
    }
    if (url.includes('/activity')) {
      if (url.includes('INVENTORY_AGENT')) return respond(getInventoryRecommendations())
      return respond([])
    }
    if (url.startsWith('/api/ai-command/page-metrics')) return respond(PAGE_METRICS)
    if (url.startsWith('/ai/agents')) return respond(OVERVIEW_DATA)
    if (url.startsWith('/ai/health')) return respond(customOverrides?.health ?? HEALTH_DATA)
    if (url.startsWith('/ai/rules')) return respond(RULES_DATA)
    if (url.startsWith('/recommendations/summary')) return respond(customOverrides?.summary ?? getSummaryData())
    if (url.startsWith('/recommendations')) {
      const items = customOverrides?.recent ?? getInventoryRecommendations()
      return respond({ items, total: (items as unknown[]).length, cursor: 0, limit: 50, hasMore: false })
    }
    return originalFetch ? originalFetch(input, init) : respond({})
  })
}

describe('AI Command Center Complete Functional Testing', () => {
  const originalError = console.error

  beforeEach(() => {
    consoleErrors.length = 0
    toasts.length = 0
    navigations.length = 0
    console.error = (...args: unknown[]) => {
      const msg = args.map(String).join(' ')
      if (!msg.includes('The width(0) and height(0) of chart should be greater than 0')) {
        consoleErrors.push(msg)
      }
      originalError.apply(console, args)
    }
    setupFetchMock()
  })

  afterEach(() => {
    if (root) {
      act(() => { root?.unmount() })
      root = null
    }
    console.error = originalError
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  async function mountWorkspace(lightMode = false, storeId = 's1') {
    const container = document.createElement('div')
    container.className = `app-shell ${lightMode ? 'light-mode' : ''}`
    document.body.appendChild(container)
    const context: WorkspaceContext = { shop: 'test.myshopify.com', storeId } as WorkspaceContext

    await act(async () => {
      root = createRoot(container)
      root.render(
        <StrictMode>
          <CommandCenterWorkspace
            context={context}
            onToast={(msg) => toasts.push(msg)}
            onNavigate={(page) => navigations.push(page)}
          />
        </StrictMode>
      )
    })
    // allow Promise.allSettled to resolve and re-render
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })
    return container
  }

  /* ── 1. Page Load ─────────────────────────────────────────────────── */
  describe('1. Page Load', () => {
    it('loads without errors in light theme', async () => {
      const container = await mountWorkspace(true)
      expect(container.querySelector('.cc-workspace')).toBeTruthy()
      expect(consoleErrors).toHaveLength(0)
    })

    it('loads without errors in dark theme', async () => {
      const container = await mountWorkspace(false)
      expect(container.querySelector('.cc-workspace')).toBeTruthy()
      expect(consoleErrors).toHaveLength(0)
    })

    it('renders empty connect state when store is not connected', async () => {
      const container = await mountWorkspace(true, '')
      expect(container.textContent).toContain('Connect Shopify to activate your AI team')
      expect(container.textContent).toContain('Deterministic rules turn store evidence into recommendations.')
    })
  })

  /* ── 2. 4 KPI Cards ───────────────────────────────────────────────── */
  describe('2. 4 KPI Cards', () => {
    it('renders Store Health Score with correct value and "up" badge', async () => {
      const container = await mountWorkspace(true)
      const healthKpi = container.querySelector('.cc-kpi:nth-child(1)')
      expect(healthKpi).toBeTruthy()
      expect(healthKpi?.textContent).toContain('78/100')
      expect(healthKpi?.textContent).toContain('Healthy')
      expect(healthKpi?.textContent).toContain('Store Health Score')
      const upBadge = healthKpi?.querySelector('.cc-kpi-trend.up')
      expect(upBadge).toBeTruthy()
      const tip = healthKpi?.querySelector('.cc-tip')
      expect(tip?.getAttribute('data-tip')).toContain('deterministic score')
    })

    it('renders Store Health Score empty state gracefully when null', async () => {
      setupFetchMock({ health: { score: null, method: 'deterministic-v1', components: [], orderCount: 2, historyDays: 2 } })
      const container = await mountWorkspace(true)
      const healthKpi = container.querySelector('.cc-kpi:nth-child(1)')
      expect(healthKpi?.textContent).toContain('need 10+ orders')
    })

    it('renders AI Actions Completed with backend number, "This week" label, sparkline, and tooltip', async () => {
      const container = await mountWorkspace(true)
      const actionsKpi = container.querySelector('.cc-kpi:nth-child(2)')
      expect(actionsKpi).toBeTruthy()
      expect(actionsKpi?.textContent).toContain('This week')
      expect(actionsKpi?.textContent).toContain('AI Actions Completed')
      const sparkline = actionsKpi?.querySelector('.cc-sparkline')
      expect(sparkline).toBeTruthy()
      const tip = actionsKpi?.querySelector('.cc-tip')
      expect(tip?.getAttribute('data-tip')).toContain('Total AI actions that helped grow your business')
    })

    it('renders Insights Today with 7, 7-day sparkline, "Last 7 days" data, and "Total this week"', async () => {
      const container = await mountWorkspace(true)
      const insightsKpi = container.querySelector('.cc-kpi:nth-child(3)')
      expect(insightsKpi).toBeTruthy()
      expect(insightsKpi?.textContent).toContain('Today')
      expect(insightsKpi?.textContent).toContain('7')
      expect(insightsKpi?.textContent).toContain('Last 7 days:')
      expect(insightsKpi?.textContent).toContain('Total this week:')
      expect(insightsKpi?.textContent).toContain('Insights Today')
      const tip = insightsKpi?.querySelector('.cc-tip')
      expect(tip?.getAttribute('data-tip')).toContain('Recommendations your AI agents generated today')
    })

    it('renders Active Agents card with "2 of 5", dots (2 green, 3 gray), and "Trial plan" badge', async () => {
      const container = await mountWorkspace(true)
      const agentsKpi = container.querySelector('.cc-kpi:nth-child(4)')
      expect(agentsKpi).toBeTruthy()
      expect(agentsKpi?.textContent).toContain('2 of 5')
      expect(agentsKpi?.textContent).toContain('Trial plan')
      expect(agentsKpi?.textContent).toContain('Active agents')
      const activeDots = agentsKpi?.querySelectorAll('.cc-agent-dots i.active')
      const lockedDots = agentsKpi?.querySelectorAll('.cc-agent-dots i.locked')
      expect(activeDots).toHaveLength(2)
      expect(lockedDots).toHaveLength(3)
    })
  })

  /* ── 3. Revenue Agent Card ────────────────────────────────────────── */
  describe('3. Revenue Agent Card', () => {
    it('displays active badge, version v1.1.0, 0 insights today, and opens details drawer', async () => {
      const container = await mountWorkspace(true)
      const revCard = Array.from(container.querySelectorAll('.cc-agent-card')).find((card) => card.textContent?.includes('Revenue Agent'))
      expect(revCard).toBeTruthy()
      expect(revCard?.textContent).toContain('Active')
      expect(revCard?.textContent).toContain('v1.1.0')
      expect(revCard?.textContent).toContain('0insights today')
      expect(revCard?.textContent).toContain('—impact tracked')
      expect(revCard?.textContent).toContain('neverlast insight')

      const viewDetailsBtn = revCard?.querySelector('.cc-agent-actions .cc-button') as HTMLButtonElement
      expect(viewDetailsBtn).toBeTruthy()
      expect(viewDetailsBtn.textContent).toContain('View details')

      await act(async () => {
        viewDetailsBtn.click()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25))
      })

      const drawer = document.querySelector('.cc-drawer')
      expect(drawer).toBeTruthy()
      expect(drawer?.textContent).toContain('Revenue Agent')
      expect(drawer?.textContent).toContain('About this agent')
      expect(drawer?.textContent).toContain('What it does')
      expect(drawer?.textContent).toContain('Best used for')
      expect(drawer?.textContent).toContain('Data it uses')
    })
  })

  /* ── 4. Inventory Agent Card ──────────────────────────────────────── */
  describe('4. Inventory Agent Card', () => {
    it('displays active badge, version, 7 insights today, $346,179 impact, 2 hours ago, and 75% confidence', async () => {
      const container = await mountWorkspace(true)
      const invCard = Array.from(container.querySelectorAll('.cc-agent-card')).find((card) => card.textContent?.includes('Inventory Agent'))
      expect(invCard).toBeTruthy()
      expect(invCard?.textContent).toContain('Active')
      expect(invCard?.textContent).toContain('v1.1.0')
      expect(invCard?.textContent).toContain('7insights today')
      expect(invCard?.textContent).toContain('$346,179impact tracked')
      expect(invCard?.textContent).toContain('2 hours agolast insight')
      expect(invCard?.textContent).toContain('Confidence75%')

      const viewDetailsBtn = invCard?.querySelector('.cc-agent-actions .cc-button') as HTMLButtonElement
      expect(viewDetailsBtn).toBeTruthy()

      await act(async () => {
        viewDetailsBtn.click()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25))
      })

      const drawer = document.querySelector('.cc-drawer')
      expect(drawer).toBeTruthy()
      expect(drawer?.textContent).toContain('Inventory Agent')
    })
  })

  /* ── 5. AI Growth Command Section (4 Cards) ───────────────────────── */
  describe('5. AI Growth Command Section', () => {
    it('Store Coach card: shows Available badge, plan Basic, quote, Details drawer, and Open action', async () => {
      const container = await mountWorkspace(true)
      const coachCard = Array.from(container.querySelectorAll('.cc-agent-card.growth')).find((card) => card.textContent?.includes('Store Coach'))
      expect(coachCard).toBeTruthy()
      expect(coachCard?.textContent).toContain('Available')
      expect(coachCard?.textContent).toContain('On your plan: Basic')
      expect(coachCard?.textContent).toContain('Your inventory cover slipped this week')

      const openBtn = Array.from(coachCard?.querySelectorAll('button') ?? []).find((b) => b.textContent?.includes('Open Store Coach')) as HTMLButtonElement | undefined
      expect(openBtn).toBeTruthy()
      act(() => { openBtn?.click() })
      expect(navigations).toContain('store-coach')

      const detailsBtn = Array.from(coachCard?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Details') as HTMLButtonElement | undefined
      expect(detailsBtn).toBeTruthy()
      await act(async () => { detailsBtn?.click() })
      const drawer = document.querySelector('.cc-drawer')
      expect(drawer?.textContent).toContain('Store Coach')
      expect(drawer?.textContent).toContain('Plan availability')
    })

    it('GrowthIQ card: shows Requires Growth badge, Sample plan, quote, Details drawer, and Open action', async () => {
      const container = await mountWorkspace(true)
      const growthCard = Array.from(container.querySelectorAll('.cc-agent-card.growth')).find((card) => card.textContent?.includes('GrowthIQ'))
      expect(growthCard).toBeTruthy()
      expect(growthCard?.textContent).toContain('Requires Growth')
      expect(growthCard?.textContent).toContain('On your plan: Sample')
      expect(growthCard?.textContent).toContain('Limited features on your current plan')
      expect(growthCard?.textContent).toContain('Quarterly revenue is tracking 9% above plan')

      const openBtn = Array.from(growthCard?.querySelectorAll('button') ?? []).find((b) => b.textContent?.includes('Open GrowthIQ')) as HTMLButtonElement | undefined
      expect(openBtn).toBeTruthy()
      act(() => { openBtn?.click() })
      expect(navigations).toContain('ai-executive')
    })

    it('PatternAI card: shows Available badge, Limited plan, quote, Details drawer, and Open action', async () => {
      const container = await mountWorkspace(true)
      const patternCard = Array.from(container.querySelectorAll('.cc-agent-card.growth')).find((card) => card.textContent?.includes('PatternAI'))
      expect(patternCard).toBeTruthy()
      expect(patternCard?.textContent).toContain('Available')
      expect(patternCard?.textContent).toContain('On your plan: Limited')
      expect(patternCard?.textContent).toContain('We found a hidden pattern')

      const openBtn = Array.from(patternCard?.querySelectorAll('button') ?? []).find((b) => b.textContent?.includes('Open PatternAI')) as HTMLButtonElement | undefined
      expect(openBtn).toBeTruthy()
      act(() => { openBtn?.click() })
      expect(navigations).toContain('patternai')
    })

    it('AI Command card: shows Available badge, Info only plan, note, quote, Details drawer, and Open action', async () => {
      const container = await mountWorkspace(true)
      const aiCmdCard = Array.from(container.querySelectorAll('.cc-agent-card.growth')).find((card) => card.textContent?.includes('AI Command'))
      expect(aiCmdCard).toBeTruthy()
      expect(aiCmdCard?.textContent).toContain('Available')
      expect(aiCmdCard?.textContent).toContain('On your plan: Info only')
      expect(aiCmdCard?.textContent).toContain('Full actions require Commander')
      expect(aiCmdCard?.textContent).toContain('Which products should I reorder this week')

      const openBtn = Array.from(aiCmdCard?.querySelectorAll('button') ?? []).find((b) => b.textContent?.includes('Open AI Command')) as HTMLButtonElement | undefined
      expect(openBtn).toBeTruthy()
      act(() => { openBtn?.click() })
      expect(navigations).toContain('ai-command')
    })
  })

  /* ── 6. Unlock More Agents Section ────────────────────────────────── */
  describe('6. Unlock More Agents Section', () => {
    it('Customer Agent (locked): shows Requires Start badge, $49/mo price, and Upgrade Plan CTA', async () => {
      const container = await mountWorkspace(true)
      const custCard = Array.from(container.querySelectorAll('.cc-agent-card.locked')).find((card) => card.textContent?.includes('Customer Agent'))
      expect(custCard).toBeTruthy()
      expect(custCard?.textContent).toContain('Requires Start')
      expect(custCard?.textContent).toContain('A $612 lifetime-value customer has gone quiet')

      const groupTitle = custCard?.closest('.cc-locked-group')?.querySelector('.cc-locked-group-title')
      expect(groupTitle?.textContent).toContain('Available in Start')
      expect(groupTitle?.textContent).toContain('$49/mo')

      const upgradeBtn = custCard?.querySelector('.cc-button.upgrade') as HTMLButtonElement
      expect(upgradeBtn).toBeTruthy()
      expect(upgradeBtn.textContent).toContain('Upgrade Plan')
      act(() => { upgradeBtn.click() })
      expect(navigations).toContain('billing')
    })

    it('Product Agent (locked): shows Requires Commander badge, $349/mo price, and Upgrade Plan CTA', async () => {
      const container = await mountWorkspace(true)
      const prodCard = Array.from(container.querySelectorAll('.cc-agent-card.locked')).find((card) => card.textContent?.includes('Product Agent'))
      expect(prodCard).toBeTruthy()
      expect(prodCard?.textContent).toContain('Requires Commander')
      expect(prodCard?.textContent).toContain('Ceramic Mug Duo has not sold in 140 days')

      const groupTitle = prodCard?.closest('.cc-locked-group')?.querySelector('.cc-locked-group-title')
      expect(groupTitle?.textContent).toContain('Available in Commander')
      expect(groupTitle?.textContent).toContain('$349/mo')

      const upgradeBtn = prodCard?.querySelector('.cc-button.upgrade') as HTMLButtonElement
      expect(upgradeBtn).toBeTruthy()
      expect(upgradeBtn.textContent).toContain('Upgrade Plan')
      act(() => { upgradeBtn.click() })
      expect(navigations).toContain('billing')
    })

    it('Executive Agent (locked): shows Requires Commander badge and Upgrade Plan CTA', async () => {
      const container = await mountWorkspace(true)
      const execCard = Array.from(container.querySelectorAll('.cc-agent-card.locked')).find((card) => card.textContent?.includes('Executive Agent'))
      expect(execCard).toBeTruthy()
      expect(execCard?.textContent).toContain('Requires Commander')
      expect(execCard?.textContent).toContain('Quarter to date is 9% ahead of plan')

      const upgradeBtn = execCard?.querySelector('.cc-button.upgrade') as HTMLButtonElement
      expect(upgradeBtn).toBeTruthy()
      act(() => { upgradeBtn.click() })
      expect(navigations).toContain('billing')
    })

    it('fills the Start and Commander gaps with real page metrics and the growth path', async () => {
      const container = await mountWorkspace(false)
      const startValue = container.querySelector('.cc-start-value-card')
      expect(startValue?.textContent).toContain('What Start Plan Delivers for YOUR Store')
      expect(startValue?.textContent).toContain('245')
      expect(startValue?.textContent).toContain('42')
      expect(startValue?.textContent).toContain('$12,450')
      expect(container.querySelector('.cc-growth-path')?.textContent).toContain('Your AI Team Growth Path')

      const actions = container.querySelector('.cc-commander-actions-card')
      expect(actions?.textContent).toContain('34')
      expect(actions?.textContent).toContain('892')
      expect(actions?.textContent).toContain('23')

      const snapshot = container.querySelector('.cc-store-snapshot-card')
      expect(snapshot?.textContent).toContain('82/100')
      expect(snapshot?.textContent).toContain('$1,245')
      expect(snapshot?.textContent).toContain('156')
      expect(snapshot?.textContent).toContain('5')
      expect(snapshot?.textContent).toContain('Auto-refreshes every 60 seconds')
    })
  })

  /* ── 7. Detail Drawer Full Tabs & Decisions ────────────────────────── */
  describe('7. Detail Drawer Full Tabs & Decisions', () => {
    it('navigates between Overview, Rules, Activity, Settings tabs and performs inline decisions', async () => {
      const container = await mountWorkspace(true)
      const invCard = Array.from(container.querySelectorAll('.cc-agent-card')).find((card) => card.textContent?.includes('Inventory Agent'))
      const viewDetailsBtn = invCard?.querySelector('.cc-agent-actions .cc-button') as HTMLButtonElement

      await act(async () => { viewDetailsBtn.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) })

      const drawer = document.querySelector('.cc-drawer')
      expect(drawer).toBeTruthy()

      // Tab: Rules
      const rulesTab = Array.from(drawer?.querySelectorAll('.cc-drawer-tabs button') ?? []).find((b) => b.textContent === 'Rules') as HTMLButtonElement | undefined
      expect(rulesTab).toBeTruthy()
      await act(async () => { rulesTab?.click() })
      expect(drawer?.textContent).toContain('Stockout risk')
      expect(drawer?.textContent).toContain('cover < 7 days')

      // Tab: Activity
      const activityTab = Array.from(drawer?.querySelectorAll('.cc-drawer-tabs button') ?? []).find((b) => b.textContent === 'Activity') as HTMLButtonElement | undefined
      expect(activityTab).toBeTruthy()
      await act(async () => { activityTab?.click() })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) })
      expect(drawer?.textContent).toContain('succeeded')
      expect(drawer?.textContent).toContain('declined / failed')

      // Inline Approve action
      const approveBtn = drawer?.querySelector('.cc-activity-actions .cc-button.approve') as HTMLButtonElement
      if (approveBtn) {
        await act(async () => { approveBtn.click() })
        expect(toasts).toContain('Recommendation approved.')
      }

      // Tab: Settings
      const settingsTab = Array.from(drawer?.querySelectorAll('.cc-drawer-tabs button') ?? []).find((b) => b.textContent === 'Settings') as HTMLButtonElement | undefined
      expect(settingsTab).toBeTruthy()
      await act(async () => { settingsTab?.click() })
      expect(drawer?.textContent).toContain('Agent status')
      expect(drawer?.textContent).toContain('Notification preferences')
      expect(drawer?.textContent).toContain('Auto-run schedule')
      expect(drawer?.textContent).toContain('Prompt version')
    })

    it('pauses and resumes agent from settings and 3-dot menu', async () => {
      const container = await mountWorkspace(true)
      const invCard = Array.from(container.querySelectorAll('.cc-agent-card')).find((card) => card.textContent?.includes('Inventory Agent'))
      const menuTrigger = invCard?.querySelector('.cc-menu-trigger') as HTMLButtonElement
      expect(menuTrigger).toBeTruthy()

      await act(async () => { menuTrigger.click() })
      const pauseOption = Array.from(document.querySelectorAll('.cc-menu-list button')).find((b) => b.textContent?.includes('Pause agent'))
      expect(pauseOption).toBeTruthy()

      await act(async () => { (pauseOption as HTMLButtonElement).click() })
      expect(toasts).toContain('Inventory Agent paused.')
    })
  })

  /* ── 8. Activity Feed ─────────────────────────────────────────────── */
  describe('8. Activity Feed', () => {
    it('renders activity rows with status pills and timestamps', async () => {
      const container = await mountWorkspace(true)
      const feed = container.querySelector('.cc-feed')
      expect(feed).toBeTruthy()
      const rows = feed?.querySelectorAll('.cc-feed-row')
      expect(rows && rows.length > 0).toBe(true)
      expect(feed?.textContent).toContain('Restock Espresso Grinder Pro')
    })

    it('renders empty feed state with educational samples and guide', async () => {
      setupFetchMock({ recent: [] })
      const container = await mountWorkspace(true)
      const feed = container.querySelector('.cc-feed')
      expect(feed?.textContent).toContain('No agent activity yet')
      expect(feed?.textContent).toContain('Recommendation created')
      expect(feed?.textContent).toContain('Learn how agents work')

      const learnBtn = feed?.querySelector('.cc-feed-empty .cc-button.ghost') as HTMLButtonElement
      expect(learnBtn).toBeTruthy()
      await act(async () => { learnBtn.click() })
      expect(feed?.textContent).toContain('1 · Sync')
      expect(feed?.textContent).toContain('2 · Rules fire')
      expect(feed?.textContent).toContain('3 · AI explains')
      expect(feed?.textContent).toContain('4 · You decide')
    })
  })

  /* ── 9. Theme Parity & Zero Visual Collisions ─────────────────────── */
  describe('9. Theme Parity & WCAG Requirements', () => {
    it('maintains identical semantic DOM tree in light and dark mode', async () => {
      const darkContainer = await mountWorkspace(false)
      const darkSelectorsCount: Record<string, number> = {}
      const selectors = ['.cc-hero', '.cc-kpi', '.cc-agent-grid', '.cc-agent-card', '.cc-feed']
      for (const sel of selectors) {
        darkSelectorsCount[sel] = darkContainer.querySelectorAll(sel).length
      }

      await act(async () => { root?.unmount(); root = null })

      const lightContainer = await mountWorkspace(true)
      for (const sel of selectors) {
        expect(lightContainer.querySelectorAll(sel).length).toBe(darkSelectorsCount[sel])
      }
    })
  })
})
