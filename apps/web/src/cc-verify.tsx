/**
 * Visual verification harness for the AI Command Center light theme — dev
 * only, not part of the production build (vite builds index.html only; this
 * mirrors verify.html / recs-verify.html / preview.html). It mocks the API in
 * page so the real CommandCenterWorkspace renders the fresh-store and
 * populated states in both themes without a backend:
 *
 *   corepack pnpm --filter @profitpilot/web dev
 *   open /cc-verify.html            → light theme (default)
 *   open /cc-verify.html?theme=dark → dark theme (must stay untouched)
 *   open /cc-verify.html?data=populated
 *
 * No production component, layout, or data path is changed by this file.
 */
import { Button } from './polaris-ui.js'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './f4.css'
import './f5.css'
import './f6.css'
import './f8.css'
import './jarvis-orb.css'
import './f9.css'
import './dashboard.css'
import './orders.css'
import './customers.css'
import './inventory.css'
import './analytics.css'
import './automation.css'
import './command-center.css'
import './ai-command.css'
import './store-coach.css'
import './recommendations.css'
import './patternai.css'
import './upgrade-overrides.css'
import './final-polish.css'
import './command-center-light.css'
import { CommandCenterWorkspace } from './command-center.js'
import type { WorkspaceContext } from './model.js'

const DAY = 86_400_000
const now = Date.now()
const iso = (msAgo: number) => new Date(now - msAgo).toISOString()
const day = (ago: number) => new Date(now - ago * DAY).toISOString().slice(0, 10)

type Scenario = 'fresh' | 'populated'

const AGENTS = [
  { id: 'REVENUE_AGENT', label: 'Revenue Agent', requiredPlan: 'trial', tagline: 'Watches revenue, margin, and cart recovery for money left on the table.', sampleInsight: 'Revenue is up 12% but margin slipped 3 points — three SKUs explain it.' },
  { id: 'INVENTORY_AGENT', label: 'Inventory Agent', requiredPlan: 'trial', tagline: 'Tracks stock cover so best sellers never run dry and cash is not stuck.', sampleInsight: 'Espresso Grinder Pro has 4 days of cover left at current velocity.' },
  { id: 'CUSTOMER_AGENT', label: 'Customer Agent', requiredPlan: 'start', tagline: 'Spots churn risk and win-back moments across your customer base.', sampleInsight: 'A $612 lifetime-value customer has gone quiet for 81 days.' },
  { id: 'PRICING_AGENT', label: 'Pricing Agent', requiredPlan: 'growth', tagline: 'Finds pricing headroom and discount leakage in closed-period data.', sampleInsight: 'Gooseneck Kettle sustains a 6% price rise with no volume loss modelled.' },
  { id: 'PRODUCT_AGENT', label: 'Product Agent', requiredPlan: 'commander', tagline: 'Reviews catalog performance, bundles, and dead stock candidates.', sampleInsight: 'Ceramic Mug Duo has not sold in 140 days — bundle or retire it.' },
  { id: 'EXECUTIVE_AGENT', label: 'Executive Agent', requiredPlan: 'commander', tagline: 'Rolls every agent up into a board-ready read on the business.', sampleInsight: 'Quarter to date is 9% ahead of plan, carried by repeat customers.' },
] as const

const PLAN_ORDER = ['trial', 'start', 'growth', 'commander'] as const

function overview(scenario: Scenario) {
  const agents = AGENTS.map((agent) => ({
    id: agent.id,
    label: agent.label,
    promptVersion: '1.1.0',
    execution: 'READY',
    languageOnly: true,
    locked: PLAN_ORDER.indexOf(agent.requiredPlan) > 0,
    requiredPlan: agent.requiredPlan,
    paused: scenario === 'populated' && agent.id === 'INVENTORY_AGENT',
    tagline: agent.tagline,
    sampleInsight: agent.sampleInsight,
  }))
  return { plan: 'trial', unlockedCount: 2, totalCount: agents.length, agents }
}

const RECOMMENDATIONS = [
  { id: 'r1', storeId: 's1', agent: 'REVENUE_AGENT', ruleId: 'MARGIN_LEAK', title: 'Recover margin on Espresso Grinder Pro', reason: 'Discount depth on this SKU grew 6 points while volume stayed flat.', impactValue: 1240, impactLabel: 'margin at risk', currency: 'USD', confidence: .82, confidenceLevel: 'HIGH', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { ruleVersion: '1.1.0', sha256: 'a'.repeat(64) }, explanation: null, explanationStatus: 'AI_GENERATED', model: 'gpt-4o-mini', version: 0, createdAt: iso(2 * 3_600_000), entityKey: 'gid-1', expiresAt: null, decidedAt: null, decidedBy: null, rejectReason: null, snoozedUntil: null },
  { id: 'r2', storeId: 's1', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Restock Espresso Grinder Pro before it sells out', reason: 'Four days of cover left at the current 2.4 units/day velocity.', impactValue: 890, impactLabel: 'revenue at risk', currency: 'USD', confidence: .74, confidenceLevel: 'HIGH', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'APPROVED', evidencePack: { ruleVersion: '1.1.0', sha256: 'b'.repeat(64) }, explanation: null, explanationStatus: 'AI_GENERATED', model: 'gpt-4o-mini', version: 1, createdAt: iso(26 * 3_600_000), entityKey: 'gid-2', expiresAt: null, decidedAt: iso(3 * 3_600_000), decidedBy: 'owner', rejectReason: null, snoozedUntil: null },
  { id: 'r3', storeId: 's1', agent: 'REVENUE_AGENT', ruleId: 'CART_ABANDONMENT', title: 'Recover an abandoned $214 checkout', reason: 'A checkout created 9 hours ago is still inside the 48-hour window.', impactValue: 214, impactLabel: 'expected recovery', currency: 'USD', confidence: .55, confidenceLevel: 'MEDIUM', actionType: 'SEND_EMAIL', actionRisk: 'APPROVAL_REQUIRED', status: 'EXECUTED', evidencePack: { ruleVersion: '1.1.0', sha256: 'c'.repeat(64) }, explanation: null, explanationStatus: 'AI_GENERATED', model: 'gpt-4o-mini', version: 2, createdAt: iso(9 * 3_600_000), entityKey: 'gid-3', expiresAt: null, decidedAt: iso(60 * 60_000), decidedBy: 'owner', rejectReason: null, snoozedUntil: null },
]

const freshSummary = {
  counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 },
  total: 0, pendingImpact: [], approvedThisMonth: { count: 0, impact: [] }, byAgent: [], byRule: [],
  approvalRate: { allTime: null, last30d: null }, averageDecisionMs: null, recentDecisions: [],
  generatedTrend: Array.from({ length: 30 }, (_, i) => ({ day: day(29 - i), generated: 0, approved: 0 })),
  plan: 'trial', usage: { feature: 'ai_recommendations_month', used: 0, limit: 10, remaining: 10 },
}

const populatedSummary = {
  ...freshSummary,
  counts: { PENDING: 1, APPROVED: 1, REJECTED: 0, EXECUTED: 1, FAILED: 0, EXPIRED: 0 },
  total: 3,
  generatedTrend: Array.from({ length: 30 }, (_, i) => ({ day: day(29 - i), generated: [0, 1, 2, 1, 3, 2, 4][i % 7], approved: [0, 1, 1, 0, 2, 1, 2][i % 7] })),
  usage: { feature: 'ai_recommendations_month', used: 3, limit: 10, remaining: 7 },
}

const freshHealth = { score: null, method: 'deterministic-v1', components: [], orderCount: 4, historyDays: 6 }
const populatedHealth = { score: 78, method: 'deterministic-v1', components: [{ key: 'revenue', score: 82, weight: .3, reason: 'Revenue is growing.' }], orderCount: 231, historyDays: 120 }
const freshPageMetrics = {
  customers: { total: null, inactive30Days: null, repeat: null, potentialRecoverableRevenue: null },
  products: { active: null, lowStock: null, deadStock: null, crossSellPairs: null },
  orders: { total: null, pending: null, todayCount: null },
  revenue: { today: null, yesterday: null, changePercent: null, currency: null },
  storeHealth: { score: null, status: null },
  subscription: { currentPlan: 'trial', basicAgentCount: 2 },
  availability: { customers: false, products: false, orders: false, inventoryHistory: false, storeHealth: false },
  generatedAt: new Date(now).toISOString(),
}
const populatedPageMetrics = {
  customers: { total: 245, inactive30Days: 42, repeat: 89, potentialRecoverableRevenue: 12450 },
  products: { active: 156, lowStock: 8, deadStock: 23, crossSellPairs: 34 },
  orders: { total: 892, pending: 5, todayCount: 12 },
  revenue: { today: 1245, yesterday: 980, changePercent: 27, currency: 'USD' },
  storeHealth: { score: 82, status: 'Healthy' },
  subscription: { currentPlan: 'trial', basicAgentCount: 2 },
  availability: { customers: true, products: true, orders: true, inventoryHistory: true, storeHealth: true },
  generatedAt: new Date(now).toISOString(),
}

const RULES = [
  { id: 'STOCKOUT_RISK', name: 'Stockout risk', agent: 'INVENTORY_AGENT', purpose: 'Flags best sellers about to run out of cover.', threshold: 'cover < 7 days', inputs: ['inventory_units', 'average_daily_units'], impact: 'Revenue protected' },
  { id: 'MARGIN_LEAK', name: 'Margin leak', agent: 'REVENUE_AGENT', purpose: 'Finds discount depth growing faster than volume.', threshold: 'discount delta > 5pts', inputs: ['orders', 'unit_cost'], impact: 'Margin recovered' },
]

let scenarioStore: Scenario = 'fresh'

function installMock(scenario: Scenario) {
  scenarioStore = scenario
  window.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    const respond = (data: unknown) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: true, data }) }) as Response
    if (new URLSearchParams(window.location.search).get('state') === 'loading') return new Promise<Response>(() => {})
    if (url.startsWith('/api/ai-command/page-metrics')) return respond(scenarioStore === 'populated' ? populatedPageMetrics : freshPageMetrics)
    if (url.startsWith('/ai/agents/')) return respond(scenarioStore === 'populated' ? RECOMMENDATIONS : [])
    if (url.startsWith('/ai/agents')) return respond(overview(scenarioStore))
    if (url.startsWith('/ai/health')) return respond(scenarioStore === 'populated' ? populatedHealth : freshHealth)
    if (url.startsWith('/ai/rules')) return respond(RULES)
    if (url.startsWith('/recommendations/summary')) return respond(scenarioStore === 'populated' ? populatedSummary : freshSummary)
    if (url.startsWith('/recommendations')) {
      const items = scenarioStore === 'populated' ? RECOMMENDATIONS : []
      return respond({ items, total: items.length, cursor: 0, limit: 50, hasMore: false })
    }
    return respond({ note: 'unmocked', url })
  }) as typeof fetch
}

const params = new URLSearchParams(window.location.search)
const pageState = params.get('state') ?? 'ready'

function Harness() {
  const [light, setLight] = useState(params.get('theme') !== 'dark')
  const [scenario, setScenario] = useState<Scenario>(params.get('data') === 'populated' ? 'populated' : 'fresh')
  const [mountKey, setMountKey] = useState(0)
  const [note, setNote] = useState('—')
  const switchScenario = (next: Scenario) => { setScenario(next); installMock(next); setMountKey((key) => key + 1) }
  return (
    <div className={`app-shell ${light ? 'light-mode' : ''}`} style={{ minHeight: '100vh' }}>
      <div data-harness-bar style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderBottom: '1px solid var(--border-soft)', background: 'var(--card)', flexWrap: 'wrap', color: 'var(--text)', fontSize: 12 }}>
        <strong style={{ marginRight: 6 }}>AI Command Center — theme verification</strong>
        {(['fresh', 'populated'] as Scenario[]).map((id) => (
          <Button key={id} onClick={() => switchScenario(id)} className={`button ${scenario === id ? 'primary' : 'secondary'}`}>{id}</Button>
        ))}
        <span style={{ color: 'var(--text-tertiary)' }}>event → {note}</span>
        <span style={{ flex: 1 }} />
        <Button onClick={() => setLight((value) => !value)} className="button secondary">{light ? 'Dark' : 'Light'} mode</Button>
      </div>
      <div className="page-scroll">
        <div className="page-content">
          <div className="page-header">
            <div>
              <div className="page-eyebrow">AI employee</div>
              <h1>AI Command Center</h1>
              <p>Your AI workforce, always working for you. Every insight backed by real data — never invented.</p>
            </div>
          </div>
          <CommandCenterWorkspace
            key={`${mountKey}-${scenario}`}
            context={{ shop: 'demo-store.myshopify.com', storeId: pageState === 'nostore' ? '' : 's1' } as WorkspaceContext}
            onToast={(message) => setNote(message)}
            onNavigate={(page) => setNote(`navigate:${page}`)}
          />
        </div>
      </div>
    </div>
  )
}

installMock(params.get('data') === 'populated' ? 'populated' : 'fresh')
const root = document.getElementById('root')
if (!root) throw new Error('cc-verify root missing')
createRoot(root).render(<StrictMode><Harness /></StrictMode>)
