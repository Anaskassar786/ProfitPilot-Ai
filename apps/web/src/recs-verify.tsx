/**
 * Visual verification harness for the Recommendations UX refresh — dev only,
 * not part of the production build (vite builds index.html only; this mirrors
 * verify.html / preview.html). Mocks the API in-page so the real
 * RecommendationsWorkspace renders empty, populated, and plan-limit states in
 * both themes without a backend: run the dev server and open /recs-verify.html.
 */
import { Button } from './polaris-ui.js'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './dashboard.css'
import './final-polish.css'
import './recommendations.css'
import { RecommendationsWorkspace, AnalysisProgressModal, AnalysisReportPanel, RuleDetailModal } from './recommendations.js'
import type { AnalysisReport, RecommendationSummary, RecommendationView } from './recommendations-model.js'

const now = Date.now()

function view(overrides: Partial<RecommendationView> = {}): RecommendationView {
  return { id: 'r1', storeId: 's1', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Restock "Everyday Hoodie — Black / M" before it sells out', reason: 'At the current sales velocity this variant has 4 days of cover left — under your 7-day reorder window. Restocking now protects a steady seller.', impactValue: 1240, impactLabel: 'revenue at risk', currency: 'USD', confidence: .82, confidenceLevel: 'HIGH', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: { ruleVersion: '1.1.0', sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' }, explanation: 'This variant sells about 6 units a day and only 26 remain. A reorder placed today lands before the weekend traffic peak.', explanationStatus: 'AI_GENERATED', model: 'gpt-4o-mini', version: 0, createdAt: new Date(now - 2 * 3_600_000).toISOString(), entityKey: 'gid-shopify-product-884211', expiresAt: new Date(now + 26 * 3_600_000).toISOString(), decidedAt: null, decidedBy: null, rejectReason: null, snoozedUntil: null, ...overrides }
}

const populatedItems: RecommendationView[] = [
  view(),
  view({ id: 'r2', agent: 'CUSTOMER_AGENT', ruleId: 'CHURN_RISK', title: 'Win back a VIP customer who went quiet', reason: 'A customer with $612 lifetime value has not ordered in 81 days — past the 75-day churn window.', impactValue: 480, impactLabel: 'customer LTV at risk', confidence: .64, confidenceLevel: 'MEDIUM', actionType: 'SEND_EMAIL', actionRisk: 'APPROVAL_REQUIRED', createdAt: new Date(now - 26 * 3_600_000).toISOString(), expiresAt: null, explanationStatus: 'AI_UNAVAILABLE', explanation: null }),
  view({ id: 'r3', agent: 'CUSTOMER_AGENT', ruleId: 'CART_ABANDONMENT', title: 'Recover an abandoned $214 cart', reason: 'A checkout created 9 hours ago is still inside the 48-hour recovery window.', impactValue: 24, impactLabel: 'expected recovery', confidence: .55, confidenceLevel: 'MEDIUM', status: 'APPROVED', decidedAt: new Date(now - 50 * 60_000).toISOString(), createdAt: new Date(now - 9 * 3_600_000).toISOString() }),
]

const emptySummary: RecommendationSummary = {
  counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 },
  total: 0,
  pendingImpact: [],
  approvedThisMonth: { count: 0, impact: [] },
  byAgent: [],
  byRule: [],
  approvalRate: { allTime: null, last30d: null },
  averageDecisionMs: null,
  recentDecisions: [],
  generatedTrend: [],
  plan: 'trial',
  usage: { feature: 'ai_recommendations_month', used: 0, limit: 10, remaining: 10 },
}

const populatedSummary: RecommendationSummary = {
  counts: { PENDING: 2, APPROVED: 4, REJECTED: 1, EXECUTED: 1, FAILED: 0, EXPIRED: 0 },
  total: 8,
  pendingImpact: [{ currency: 'USD', value: 1720 }],
  approvedThisMonth: { count: 4, impact: [{ currency: 'USD', value: 935 }] },
  byAgent: [
    { agent: 'INVENTORY_AGENT', pending: 1, approved: 2, rejected: 0, total: 3 },
    { agent: 'CUSTOMER_AGENT', pending: 1, approved: 1, rejected: 1, total: 3 },
    { agent: 'CUSTOMER_AGENT', pending: 0, approved: 1, rejected: 0, total: 2 },
  ],
  byRule: [
    { ruleId: 'STOCKOUT_RISK', total: 3 },
    { ruleId: 'CHURN_RISK', total: 3 },
    { ruleId: 'CART_ABANDONMENT', total: 2 },
  ],
  approvalRate: { allTime: 71, last30d: 80 },
  averageDecisionMs: 5_400_000,
  recentDecisions: [
    view({ id: 'd1', status: 'APPROVED', decidedAt: new Date(now - 50 * 60_000).toISOString() }),
    view({ id: 'd2', title: 'Invite a repeat purchase from a 3x buyer', ruleId: 'REPEAT_PURCHASE', agent: 'CUSTOMER_AGENT', status: 'REJECTED', rejectReason: 'BAD_TIMING', decidedAt: new Date(now - 5 * 3_600_000).toISOString() }),
  ],
  generatedTrend: Array.from({ length: 30 }, (_, i) => ({ day: new Date(now - (29 - i) * 86_400_000).toISOString().slice(0, 10), generated: i % 6 === 0 ? 3 : i % 3 === 0 ? 2 : i % 2 === 0 ? 1 : 0, approved: i % 6 === 0 ? 2 : i % 4 === 0 ? 1 : 0 })),
  plan: 'growth',
  usage: { feature: 'ai_recommendations_month', used: 8, limit: 100, remaining: 92 },
}

const limitSummary: RecommendationSummary = { ...emptySummary, usage: { feature: 'ai_recommendations_month', used: 10, limit: 10, remaining: 0 } }

const demoReport: AnalysisReport = {
  storeId: 's1',
  generatedAt: new Date(now - 2 * 60_000).toISOString(),
  receivedAt: new Date(now - 2 * 60_000).toISOString(),
  elapsedMs: 4_300,
  recommendations: [],
  deduplicated: 0,
  rulesChecked: 8,
  health: { score: 84, method: 'deterministic-v1' },
  snapshotStats: { products: 42, customers: 128, checkouts: 7, orders: 913, dataFreshAt: new Date(now - 38 * 60_000).toISOString(), currency: 'USD' },
}

type Scenario = 'empty' | 'populated' | 'limit'

function analyzePayload(scenario: Scenario) {
  return {
    storeId: 's1',
    generatedAt: new Date().toISOString(),
    recommendations: scenario === 'populated' ? [populatedItems[0]] : [],
    deduplicated: 0,
    cacheHits: 0,
    rulesChecked: 8,
    health: { score: 84, method: 'deterministic-v1', components: [] },
    snapshotStats: { products: 42, customers: 128, checkouts: 7, orders: 913, dataFreshAt: new Date().toISOString(), currency: 'USD' },
  }
}

let scenarioStore: Scenario = 'empty'
let analyzeCount = 0

function installMock(scenario: Scenario) {
  scenarioStore = scenario
  analyzeCount = 0
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const respond = (data: unknown, status = 200) => ({ ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: status < 400, data }) }) as Response
    if (url.startsWith('/recommendations/analyze')) {
      analyzeCount += 1
      await new Promise((resolve) => setTimeout(resolve, 3600))
      return respond(analyzePayload(scenarioStore))
    }
    if (url.startsWith('/recommendations/summary')) {
      const summary = scenarioStore === 'populated' ? (analyzeCount > 0 ? { ...populatedSummary, usage: { ...populatedSummary.usage, used: 9, remaining: 91 } } : populatedSummary) : scenarioStore === 'limit' ? limitSummary : (analyzeCount > 0 ? { ...emptySummary } : emptySummary)
      return respond(summary)
    }
    if (url.startsWith('/recommendations') && !init?.method) {
      const items = scenarioStore === 'populated' ? populatedItems : []
      return respond({ items, total: items.length, cursor: 0, limit: 50, hasMore: false })
    }
    return respond({ note: 'unmocked', url })
  }) as typeof fetch
}

function Harness() {
  const [scenario, setScenario] = useState<Scenario>('populated')
  const [light, setLight] = useState(false)
  const [mountKey, setMountKey] = useState(0)
  const [toasts, setToasts] = useState<string[]>([])
  const [nav, setNav] = useState<string>('—')
  const [ruleModal, setRuleModal] = useState(false)
  const switchScenario = (next: Scenario) => { setScenario(next); installMock(next); setMountKey((k) => k + 1) }
  return (
    <div className={`app-shell ${light ? 'light-mode' : ''}`} style={{ minHeight: '100vh' }}>
      <style>{`
        .harness-inline .modal-overlay { position: static; padding: 0; background: transparent; backdrop-filter: none; }
        .harness-inline .recs-tip-bubble { opacity: 1; transform: none; }
      `}</style>
      <div style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-secondary, rgb(20, 22, 28))', flexWrap: 'wrap', color: 'var(--text)', fontSize: 12 }}>
        <strong style={{ marginRight: 6 }}>Recs UX verification</strong>
        {(['empty', 'populated', 'limit'] as Scenario[]).map((id) => (
          <Button key={id} onClick={() => switchScenario(id)} className={`button secondary compact ${scenario === id ? 'primary' : ''}`}>{id}</Button>
        ))}
        <Button onClick={() => setRuleModal(true)} className="button secondary compact">rule modal</Button>
        <span style={{ color: 'var(--text-tertiary)' }}>nav → {nav}</span>
        <span style={{ flex: 1 }} />
        <Button onClick={() => setLight((v) => !v)} className="button secondary compact">{light ? 'Dark' : 'Light'} mode</Button>
      </div>
      <div className="page-content" style={{ padding: 22, maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 26 }}>
        <section>
          <h3 style={{ color: 'var(--text)' }}>Full workspace — {scenario}</h3>
          <RecommendationsWorkspace
            key={mountKey}
            context={{ shop: 'demo-store.myshopify.com', storeId: 's1' } as never}
            onToast={(message) => setToasts((current) => [...current.slice(-2), message])}
            onNavigateBilling={() => setNav('billing')}
            onNavigateSection={(section) => setNav(section)}
          />
        </section>
        <section>
          <h3 style={{ color: 'var(--text)' }}>Analysis report panel (as rendered after a 0-result run)</h3>
          <AnalysisReportPanel report={demoReport} onDismiss={() => setNav('dismiss')} onNavigateSection={(s) => setNav(s)} onHow={() => setNav('how-it-works')} onRerun={() => setNav('rerun')} rerunBlocked={false} />
        </section>
        <section className="harness-inline">
          <h3 style={{ color: 'var(--text)' }}>Analysis progress modal (step 3 of 6)</h3>
          <AnalysisProgressModal step={2} elapsedMs={2600} onHide={() => setNav('hide')} />
        </section>
        <section className="harness-inline">
          <h3 style={{ color: 'var(--text)' }}>KPI tooltip hover simulation</h3>
          <div className="recs-kpis" style={{ maxWidth: 340 }}>
            <div className="recs-kpi">
              <span className="recs-tip" tabIndex={0} aria-label="Total modeled revenue value waiting in pending recommendations. Approving is how you capture it.">
                <span className="recs-kpi-label">Revenue opportunity pending</span>
                <span className="recs-tip-bubble" role="tooltip">Total modeled revenue value waiting in pending recommendations. Approving is how you capture it.</span>
              </span>
              <strong className="recs-kpi-value accent">$1,720</strong>
              <small>2 pending recommendations awaiting your call</small>
            </div>
          </div>
        </section>
      </div>
      {ruleModal && <RuleDetailModal ruleId="STOCKOUT_RISK" plan={scenario === 'empty' || scenario === 'limit' ? 'trial' : 'growth'} onClose={() => setRuleModal(false)} onUpgrade={() => setNav('billing')} />}
      <div style={{ position: 'fixed', right: 18, bottom: 18, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 90 }}>
        {toasts.map((toast, i) => <div key={i} className="toast info" style={{ position: 'static' }}><span className="toast-icon" /><span>{toast}</span></div>)}
      </div>
    </div>
  )
}

installMock('populated')
const root = document.getElementById('root')
if (!root) throw new Error('verify root missing')
createRoot(root).render(<StrictMode><Harness /></StrictMode>)
