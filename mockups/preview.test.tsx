/**
 * One-off snapshot renderer: renders the REAL KpiHero + InsightsSidebar
 * components (from apps/web/src/recommendations.tsx) with the REAL stylesheet,
 * and writes mockups/out/live-preview.html so the redesign can be viewed in a
 * browser without a backend. Not part of the vitest suite (outside include
 * globs) — run explicitly: npx vitest run mockups/preview.test.tsx
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { it } from 'vitest'
import { KpiHero, InsightsSidebar } from '../apps/web/src/recommendations.js'
import { usageState } from '../apps/web/src/recommendations-model.js'
import fs from 'node:fs'
import path from 'node:path'

function trend(last30 = 30) {
  const out = []
  const base = Date.UTC(2026, 7, 1) // Aug 1 2026
  const gen = [12, 20, 15, 30, 22, 34, 28, 42, 26, 18, 36, 30, 46, 24, 32, 20, 40, 34, 26, 44, 30, 38, 22, 34, 42, 26, 36, 20, 30, 38]
  const app = [4, 8, 6, 12, 9, 14, 11, 18, 10, 8, 15, 12, 20, 9, 13, 7, 17, 14, 10, 18, 12, 16, 9, 13, 17, 10, 14, 8, 12, 15]
  for (let i = 0; i < Math.min(last30, 30); i++) {
    const day = new Date(base + i * 86400000).toISOString().slice(0, 10)
    out.push({ day, generated: gen[i] ?? 10, approved: app[i] ?? 5 })
  }
  return out
}

const summary = {
  counts: { PENDING: 6, APPROVED: 8, REJECTED: 2, EXECUTED: 1, FAILED: 0, EXPIRED: 1 },
  total: 18,
  pendingImpact: [{ currency: 'USD', value: 12480 }],
  approvedThisMonth: { count: 8, impact: [{ currency: 'USD', value: 3240 }] },
  byAgent: [
    { agent: 'INVENTORY_AGENT', pending: 2, approved: 3, rejected: 0, total: 5 },
    { agent: 'REVENUE_AGENT', pending: 2, approved: 2, rejected: 1, total: 5 },
    { agent: 'PRICING_AGENT', pending: 1, approved: 1, rejected: 1, total: 3 },
    { agent: 'CAMPAIGN_AGENT', pending: 1, approved: 2, rejected: 0, total: 3 },
  ],
  byRule: [
    { ruleId: 'STOCKOUT_RISK', total: 5 },
    { ruleId: 'CART_ABANDONMENT', total: 4 },
    { ruleId: 'PRICING_UPLIFT', total: 3 },
    { ruleId: 'REPEAT_PURCHASE', total: 3 },
    { ruleId: 'CHURN_RISK', total: 2 },
  ],
  approvalRate: { allTime: 67.2, last30d: 71.4 },
  averageDecisionMs: 42 * 60 * 1000,
  recentDecisions: [
    { id: 'd1', title: 'Restock the Everyday Hoodie before stockout', status: 'APPROVED', decidedAt: new Date(Date.now() - 2 * 3600000).toISOString(), impactValue: 1240, impactLabel: 'revenue at risk', currency: 'USD', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', reason: '', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', confidence: 0.84, confidenceLevel: 'HIGH', explanationStatus: 'AI_UNAVAILABLE', explanation: null, model: null, version: 1, createdAt: new Date().toISOString(), entityKey: null, expiresAt: null, rejectReason: null, snoozedUntil: null, evidencePack: {} },
    { id: 'd2', title: 'Send a win-back email to a quiet VIP customer', status: 'APPROVED', decidedAt: new Date(Date.now() - 5 * 3600000).toISOString(), impactValue: 640, impactLabel: 'expected recovery', currency: 'USD', agent: 'CUSTOMER_AGENT', ruleId: 'CHURN_RISK', reason: '', actionType: 'SEND_EMAIL', actionRisk: 'APPROVAL_REQUIRED', confidence: 0.7, confidenceLevel: 'MEDIUM', explanationStatus: 'AI_GENERATED', explanation: 'This customer ordered weekly for 6 months and has been quiet for 2.', model: 'gpt-4o-mini', version: 1, createdAt: new Date().toISOString(), entityKey: null, expiresAt: null, rejectReason: null, snoozedUntil: null, evidencePack: {} },
    { id: 'd3', title: 'Apply a 5% bundle discount on repeat pairs', status: 'APPROVED', decidedAt: new Date(Date.now() - 26 * 3600000).toISOString(), impactValue: 410, impactLabel: 'modeled 30-day uplift', currency: 'USD', agent: 'PRICING_AGENT', ruleId: 'REPEAT_PURCHASE', reason: '', actionType: 'CREATE_DISCOUNT', actionRisk: 'APPROVAL_REQUIRED', confidence: 0.66, confidenceLevel: 'MEDIUM', explanationStatus: 'AI_REJECTED', explanation: null, model: null, version: 1, createdAt: new Date().toISOString(), entityKey: null, expiresAt: null, rejectReason: null, snoozedUntil: null, evidencePack: {} },
  ],
  generatedTrend: trend(30),
  plan: 'growth',
  usage: { feature: 'ai_recommendations_month', used: 4, limit: 10, remaining: 6 },
}

it('renders the live preview HTML', () => {
  const kpi = renderToStaticMarkup(createElement(KpiHero, { summary: summary as never, usage: usageState(4, 10), plan: 'growth', onUpgrade: () => undefined }))
  const side = renderToStaticMarkup(createElement(InsightsSidebar, { summary: summary as never, plan: 'growth', onFilterAgent: () => undefined, onInspectRule: () => undefined, onUpgrade: () => undefined }))
  const styles = fs.readFileSync(path.resolve(__dirname, '../apps/web/src/styles.css'), 'utf8') + '\n' + fs.readFileSync(path.resolve(__dirname, '../apps/web/src/recommendations.css'), 'utf8')
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>ProfitPilot — Recommendations redesign (live render)</title>
<style>${styles}</style></head>
<body>
<div class="app-shell">
  <div class="recs-workspace" style="max-width: 1280px; margin: 0 auto; padding: 24px;">
    <div class="recs-section" aria-label="Overview">
      <div class="recs-section-head"><h3>Overview</h3><p>A quick pulse on the money waiting, how you are deciding, and this month's usage. <em>Live render of the real components — mock data.</em></p></div>
      ${kpi}
    </div>
    <div class="recs-body" style="grid-template-columns: minmax(0, 1fr) 300px;">
      <div></div>
      <aside class="recs-sidebar" aria-label="Insights">
        <div class="recs-section-head recs-section-head-side"><h3>Insights</h3><p>Your team, your timeline, your patterns.</p></div>
        ${side}
      </aside>
    </div>
  </div>
</div>
</body></html>`
  fs.mkdirSync(path.resolve(__dirname, 'out'), { recursive: true })
  fs.writeFileSync(path.resolve(__dirname, 'out/live-preview.html'), html)
})
