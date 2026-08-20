// Local-only mock API for visually verifying the PR #46 Recommendations page.
// Not part of the shipped product. Serves the recommendation endpoint shapes
// with realistic data on :3000 so the Vite dev proxy has something to talk to.
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'

const now = Date.now()
const iso = (offsetMs) => new Date(now - offsetMs).toISOString()

function pack(ruleId, fields) {
  const id = randomUUID()
  const sorted = [...fields].sort((a, b) => a.key.localeCompare(b.key))
  const generatedAt = iso(3 * 3600e3)
  const canonical = JSON.stringify({ id, storeId: 'demo-store', ruleId, ruleVersion: '1.0.0', fields: sorted, generatedAt })
  return { id, storeId: 'demo-store', ruleId, ruleVersion: '1.0.0', fields: sorted, generatedAt, sha256: createHash('sha256').update(canonical, 'utf8').digest('hex') }
}

let recs = [
  { id: 'rec-1', storeId: 'demo-store', agent: 'INVENTORY_AGENT', ruleId: 'STOCKOUT_RISK', title: 'Reorder Alpine Hoodie before stockout', reason: 'Alpine Hoodie has 3.2 days of cover at current velocity.', impactValue: 1840, impactLabel: 'revenue at risk', currency: 'USD', confidence: 0.75, confidenceLevel: 'MEDIUM', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'PENDING', evidencePack: pack('STOCKOUT_RISK', [{ key: 'days_of_cover', label: 'Days of cover', value: 3.2, source: 'products.inventory_units / products.average_daily_units' }, { key: 'average_daily_units', label: 'Average daily units', value: 6, source: 'products.average_daily_units' }]), explanation: 'This product is close to its stockout threshold based on how quickly it has been selling.', explanationStatus: 'AI_GENERATED', model: 'gpt-4o-mini', version: 0, createdAt: iso(3 * 3600e3), entityKey: 'prod-9912', expiresAt: iso(-18 * 3600e3), decidedAt: null, decidedBy: null, rejectReason: null, snoozedUntil: null },
  { id: 'rec-2', storeId: 'demo-store', agent: 'CUSTOMER_AGENT', ruleId: 'CHURN_RISK', title: 'Win back a high-value customer', reason: 'A high-LTV customer has been inactive for 82 days.', impactValue: 640, impactLabel: 'customer LTV at risk', currency: 'USD', confidence: 0.71, confidenceLevel: 'MEDIUM', actionType: 'SEND_EMAIL', actionRisk: 'APPROVAL_REQUIRED', status: 'PENDING', evidencePack: pack('CHURN_RISK', [{ key: 'lifetime_value', label: 'Lifetime value', value: 640, source: 'customers.lifetime_value' }, { key: 'days_inactive', label: 'Days inactive', value: 82, source: 'customers.last_order_at' }]), explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 0, createdAt: iso(26 * 3600e3), entityKey: 'cust-5541230098', expiresAt: iso(-12 * 24 * 3600e3), decidedAt: null, decidedBy: null, rejectReason: null, snoozedUntil: null },
  { id: 'rec-3', storeId: 'demo-store', agent: 'CUSTOMER_AGENT', ruleId: 'CART_ABANDONMENT', title: 'Recover an abandoned checkout', reason: 'A checkout is still within the 21-hour recovery window.', impactValue: 96.8, impactLabel: 'expected recovery', currency: 'USD', confidence: 0.68, confidenceLevel: 'MEDIUM', actionType: 'SEND_EMAIL', actionRisk: 'APPROVAL_REQUIRED', status: 'PENDING', evidencePack: pack('CART_ABANDONMENT', [{ key: 'checkout_total', label: 'Checkout total', value: 880, source: 'checkouts.total' }, { key: 'age_hours', label: 'Checkout age in hours', value: 21, source: 'checkouts.created_at' }]), explanation: null, explanationStatus: 'AI_REJECTED', model: null, version: 0, createdAt: iso(2 * 3600e3), entityKey: 'chk-33019', expiresAt: iso(-6 * 3600e3), decidedAt: null, decidedBy: null, rejectReason: null, snoozedUntil: null },
  { id: 'rec-4', storeId: 'demo-store', agent: 'PRICING_AGENT', ruleId: 'PRICING_UPLIFT', title: 'Test a measured uplift on Trail Socks', reason: 'Trail Socks clears the configured margin floor with active demand.', impactValue: 412.5, impactLabel: 'modeled 30-day uplift', currency: 'USD', confidence: 0.64, confidenceLevel: 'MEDIUM', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'APPROVED', evidencePack: pack('PRICING_UPLIFT', [{ key: 'margin', label: 'Current gross margin', value: 0.62, source: 'products.unit_price - products.unit_cost' }]), explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 1, createdAt: iso(2 * 24 * 3600e3), entityKey: 'prod-1180', expiresAt: null, decidedAt: iso(20 * 3600e3), decidedBy: 'user-1', rejectReason: null, snoozedUntil: null },
  { id: 'rec-5', storeId: 'demo-store', agent: 'PRODUCT_AGENT', ruleId: 'CROSS_SELL', title: 'Pair products that already travel together', reason: 'The observed co-purchase rate is 14%, above the configured threshold.', impactValue: 210, impactLabel: 'modeled basket value', currency: 'USD', confidence: 0.55, confidenceLevel: 'LOW', actionType: 'CREATE_RECOMMENDATION', actionRisk: 'SAFE', status: 'REJECTED', evidencePack: pack('CROSS_SELL', [{ key: 'co_purchase_rate', label: 'Co-purchase rate', value: 0.14, source: 'orders.product_pairs' }]), explanation: null, explanationStatus: 'AI_UNAVAILABLE', model: null, version: 1, createdAt: iso(3 * 24 * 3600e3), entityKey: 'prod-7810', expiresAt: null, decidedAt: iso(40 * 3600e3), decidedBy: 'user-1', rejectReason: 'NOT_RELEVANT', snoozedUntil: null },
]

const agents = ['REVENUE_AGENT', 'INVENTORY_AGENT', 'CUSTOMER_AGENT', 'PRICING_AGENT', 'CUSTOMER_AGENT', 'PRODUCT_AGENT', 'EXECUTIVE_AGENT'].map((id, i) => ({ id, label: id.replaceAll('_', ' '), promptVersion: '1.0.0', enabled: true, execution: 'READY', languageOnly: true }))

const PLAN = process.env.MOCK_PLAN ?? 'trial'
const LIMIT = PLAN === 'commander' ? null : PLAN === 'growth' ? 150 : PLAN === 'start' ? 30 : 10
let used = Number(process.env.MOCK_USED ?? 6)

function summary() {
  const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, EXECUTED: 0, FAILED: 0, EXPIRED: 0 }
  for (const r of recs) counts[r.status] += 1
  const pending = recs.filter((r) => r.status === 'PENDING')
  const byCur = {}
  for (const r of pending) byCur[r.currency] = (byCur[r.currency] ?? 0) + r.impactValue
  const byAgent = {}
  for (const r of recs) {
    byAgent[r.agent] ??= { agent: r.agent, pending: 0, approved: 0, rejected: 0, total: 0 }
    byAgent[r.agent].total += 1
    if (r.status === 'PENDING') byAgent[r.agent].pending += 1
    else if (r.status === 'APPROVED' || r.status === 'EXECUTED') byAgent[r.agent].approved += 1
    else if (r.status === 'REJECTED') byAgent[r.agent].rejected += 1
  }
  const byRule = {}
  for (const r of recs) byRule[r.ruleId] = (byRule[r.ruleId] ?? 0) + 1
  const trend = Array.from({ length: 14 }, (_, i) => ({ day: new Date(now - (13 - i) * 864e5).toISOString().slice(0, 10), generated: (i * 7) % 5, approved: (i * 3) % 3 }))
  return {
    counts, total: recs.length,
    pendingImpact: Object.entries(byCur).map(([currency, value]) => ({ currency, value })),
    approvedThisMonth: { count: recs.filter((r) => r.status === 'APPROVED').length, impact: [{ currency: 'USD', value: 412.5 }] },
    byAgent: Object.values(byAgent), byRule: Object.entries(byRule).map(([ruleId, total]) => ({ ruleId, total })),
    approvalRate: { allTime: 50, last30d: 67 },
    averageDecisionMs: 5.5 * 3600e3,
    recentDecisions: recs.filter((r) => r.decidedAt).slice(0, 10),
    generatedTrend: trend,
    plan: PLAN,
    usage: { feature: 'ai_recommendations_month', used, limit: LIMIT, remaining: LIMIT === null ? null : Math.max(0, LIMIT - used) },
  }
}

const ok = (data) => JSON.stringify({ ok: true, data, meta: {}, requestId: 'mock' })

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(ok(data)) }
  const fail = (message, status = 400, details = {}) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message, details } })) }
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const parsed = body ? JSON.parse(body) : {}
    if (url.pathname === '/security/csrf') return send({ csrfToken: 'mock-token' })
    if (url.pathname === '/session/context') return send({ storeId: 'demo-store', shop: 'demo-store.myshopify.com' })
    if (url.pathname === '/ai/agents') return send(agents)
    if (url.pathname === '/recommendations/summary') return send(summary())
    if (url.pathname === '/recommendations/analyze') {
      if (LIMIT !== null && used >= LIMIT) return fail(`Your ${PLAN} plan includes ${LIMIT} AI recommendations per month and all ${LIMIT} are used. Upgrade to keep generating.`, 403, { reason: 'UPGRADE_REQUIRED' })
      used += 1
      const fresh = { ...recs[0], id: randomUUID(), title: 'Reorder Summit Beanie before stockout', createdAt: new Date().toISOString(), status: 'PENDING', decidedAt: null, version: 0 }
      recs = [fresh, ...recs]
      return send({ storeId: 'demo-store', recommendations: [fresh], generatedAt: new Date().toISOString() })
    }
    if (url.pathname === '/recommendations') {
      let items = [...recs]
      const status = url.searchParams.get('status')
      if (status) items = items.filter((r) => r.status === status)
      const agent = url.searchParams.get('agent')
      if (agent) items = items.filter((r) => r.agent === agent)
      const sort = url.searchParams.get('sort') ?? 'created'
      const dir = url.searchParams.get('direction') === 'asc' ? 1 : -1
      items.sort((a, b) => dir * (sort === 'impact' ? a.impactValue - b.impactValue : sort === 'confidence' ? a.confidence - b.confidence : a.createdAt.localeCompare(b.createdAt)))
      return send({ items, total: items.length, cursor: 0, limit: 50, hasMore: false })
    }
    const verify = url.pathname.match(/^\/recommendations\/([^/]+)\/evidence\/verify$/)
    if (verify) {
      const rec = recs.find((r) => r.id === verify[1])
      if (!rec) return fail('Not found', 404)
      return send({ verified: true, sha256: rec.evidencePack.sha256, ruleVersion: '1.0.0', generatedAt: rec.evidencePack.generatedAt })
    }
    const action = url.pathname.match(/^\/recommendations\/([^/]+)\/(approve|reject|undo|snooze)$/)
    if (action) {
      const rec = recs.find((r) => r.id === action[1])
      if (!rec) return fail('Not found', 404)
      if (action[2] === 'approve' || action[2] === 'reject') {
        if (rec.status !== 'PENDING') return fail('Recommendation changed; reload before deciding', 409)
        rec.status = action[2] === 'approve' ? 'APPROVED' : 'REJECTED'
        rec.version += 1
        rec.decidedAt = new Date().toISOString()
        rec.decidedBy = 'user-1'
        rec.rejectReason = action[2] === 'reject' ? parsed.reason ?? null : null
      } else if (action[2] === 'undo') {
        rec.status = 'PENDING'; rec.version += 1; rec.decidedAt = null; rec.decidedBy = null; rec.rejectReason = null
      } else if (action[2] === 'snooze') {
        rec.snoozedUntil = new Date(now + (parsed.hours ?? 1) * 3600e3).toISOString()
      }
      return send(rec)
    }
    if (url.pathname === '/recommendations/bulk-decide') {
      const results = (parsed.decisions ?? []).map((d) => {
        const rec = recs.find((r) => r.id === d.id)
        if (!rec || rec.status !== 'PENDING') return { id: d.id, ok: false, error: { code: 'CONFLICT', message: 'Recommendation changed', status: 409 } }
        rec.status = d.decision === 'approve' ? 'APPROVED' : 'REJECTED'
        rec.version += 1
        rec.decidedAt = new Date().toISOString()
        return { id: d.id, ok: true, recommendation: rec }
      })
      return send({ results })
    }
    const single = url.pathname.match(/^\/recommendations\/([^/]+)$/)
    if (single) {
      const rec = recs.find((r) => r.id === single[1])
      return rec ? send(rec) : fail('Not found', 404)
    }
    if (url.pathname === '/analytics') return send({ revenue: [], orders: [], productSales: [], customerCohorts: [] })
    if (url.pathname === '/catalog') return send([])
    if (url.pathname === '/inventory') return send({ items: [], locations: [], coverage: {}, kpis: {} })
    if (url.pathname.startsWith('/jarvis/preferences')) return send({ storeId: 'demo-store', engagementMode: 'quiet', onlyAnswerWhenAsked: true, silenceUntil: null, voiceEnabled: false, language: 'en' })
    send({})
  })
}).listen(3000, '0.0.0.0', () => console.log(`PR46 mock API on :3000 (plan=${PLAN}, used=${used}/${LIMIT ?? '∞'})`))
