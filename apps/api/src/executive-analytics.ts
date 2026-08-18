/**
 * GrowthIQ (formerly "AI Executive") — deterministic analytics engine.
 *
 * Every health vital sign, risk, opportunity, scenario projection, decision
 * accuracy score, and roadmap progress value in GrowthIQ is computed
 * here from REAL synced store rows (`StoreSnapshot` from the F2 data plane
 * and `AnalyticsSnapshot` from the daily aggregation tables). The AI layer
 * only ever writes narrative language around these numbers — it is never
 * allowed to introduce a number of its own (the language firewall enforces
 * that at the boundary).
 *
 * Scenario projections are what-if models: they are computed from the
 * store's real historical baselines with EXPLICIT, stated planning
 * assumptions (elasticity, ROAS, ramp curves). Assumptions travel with the
 * result so the merchant always sees the model — never fabricated history.
 */
import type { AnalyticsSnapshot } from '@profitpilot/db'
import type { StoreSnapshot } from '@profitpilot/ai'
import type {
  BenchmarkPercentile,
  DecisionQuality,
  ExecutiveHealthDiagnosis,
  ExecutiveOpportunity,
  ExecutiveRisk,
  ExecutiveScenario,
  ExecutiveVitalSign,
  RiskLevel,
  RiskType,
  RoadmapMilestone,
  ScenarioInput,
  ScenarioType,
  VitalSignStatus,
} from './executive-model.js'

export type ExecutiveRiskDraft = Omit<ExecutiveRisk, 'id' | 'storeId' | 'status' | 'detectedAt' | 'resolvedAt'>
export type ExecutiveOpportunityDraft = Omit<ExecutiveOpportunity, 'id' | 'storeId' | 'status' | 'identifiedAt' | 'updatedAt'>

const DAY_MS = 86_400_000
const HEALTHY_SCORE = 85
const NEEDS_ATTENTION_SCORE = 65
const RISK_SCORE = 40
const CRITICAL_SCORE = 15

const VITAL_WEIGHTS: Readonly<Record<string, number>> = {
  revenue_growth: 20,
  retention: 15,
  inventory_turnover: 12,
  cash_conversion: 15,
  marketing_roi: 8,
  product_diversity: 10,
  order_velocity: 10,
  acquisition: 10,
}

// ────────────────────────────────────────────────────────────────────────────
// Business health diagnosis
// ────────────────────────────────────────────────────────────────────────────

export type VitalComputation = Readonly<{
  vitals: readonly ExecutiveVitalSign[]
  overallScore: number
  overallStatus: ExecutiveHealthDiagnosis['overallStatus']
  conditions: readonly Readonly<{ key: string; title: string; severity: VitalSignStatus; causes: string; treatment: string }>[]
  prescriptions: readonly Readonly<{ title: string; action: string; timeframe: string }>[]
}>

/** Computes all eight vital signs plus the weighted overall health score. */
export function diagnoseExecutiveHealth(snapshot: StoreSnapshot, analytics: AnalyticsSnapshot, now = Date.now()): VitalComputation {
  const vitals = computeExecutiveVitalSigns(snapshot, analytics, now)
  const overall = scoreExecutiveHealth(vitals)
  const conditions = buildConditions(vitals)
  const prescriptions = conditions.slice(0, 3).map((condition) => ({
    title: `Address ${condition.title}`,
    action: condition.treatment,
    timeframe: condition.severity === 'CRITICAL' ? 'Next 7 days' : condition.severity === 'RISK' ? 'Next 30 days' : 'Next 60 days',
  }))
  return { vitals, overallScore: overall.score, overallStatus: overall.status, conditions, prescriptions }
}

export function computeExecutiveVitalSigns(snapshot: StoreSnapshot, analytics: AnalyticsSnapshot, now = Date.now()): readonly ExecutiveVitalSign[] {
  const last30 = sinceDays(now, 30)
  const revenueGrowth = growthRate(snapshot.last30dRevenue, snapshot.previous30dRevenue)
  const retention = repeatPurchaseRate(snapshot)
  const inventory = inventoryTurnover(snapshot, analytics)
  const cash = cashConversion(analytics)
  const diversity = productDiversity(analytics)
  const velocity = orderVelocity(analytics)
  const acquisition = customerAcquisition(snapshot, last30)

  return [
    vital('revenue_growth', 'Revenue growth', revenueGrowth.value, revenueGrowth.trend,
      revenueGrowth.value === null ? 'Not enough revenue history to measure a growth trend yet.'
        : revenueGrowth.status === 'HEALTHY' ? `Revenue grew ${formatPct(revenueGrowth.value)} over the previous 30 days.`
        : revenueGrowth.status === 'NEEDS_ATTENTION' ? `Revenue is roughly flat (${formatPct(revenueGrowth.value)} vs the prior 30 days).`
        : revenueGrowth.status === 'RISK' ? `Revenue declined ${formatPct(Math.abs(revenueGrowth.value))} versus the prior 30 days.`
        : `Revenue has fallen ${formatPct(Math.abs(revenueGrowth.value))} — a material contraction.`,
      revenueGrowth.status, { last30dRevenue: snapshot.last30dRevenue, previous30dRevenue: snapshot.previous30dRevenue }),

    vital('retention', 'Customer retention', retention.value, retention.trend,
      retention.value === null ? 'No customer history is synced yet — retention is unmeasurable without order data.'
        : retention.status === 'HEALTHY' ? `${formatPct(retention.value)} of customers have ordered more than once.`
        : retention.status === 'NEEDS_ATTENTION' ? `Repeat-purchase rate is ${formatPct(retention.value)} — below the healthy 30% band.`
        : retention.status === 'RISK' ? `Only ${formatPct(retention.value)} of customers return — acquisition is doing all the work.`
        : `Repeat rate of ${formatPct(retention.value)} leaves revenue dependent on one-time buyers.`,
      retention.status, { repeatRate: retention.value, customers: snapshot.customers.length }),

    vital('inventory_turnover', 'Inventory turnover', inventory.value, inventory.trend,
      inventory.value === null ? 'Inventory or sales history is too thin to compute turnover.'
        : inventory.status === 'HEALTHY' ? `Stock cycles ${formatNum(inventory.value)}× per year — capital is working efficiently.`
        : inventory.status === 'NEEDS_ATTENTION' ? `Stock turns ${formatNum(inventory.value)}× per year; capital is sitting in inventory.`
        : inventory.status === 'RISK' ? `Turnover of ${formatNum(inventory.value)}× per year signals overstock or weak sell-through.`
        : `Turnover of ${formatNum(inventory.value)}× per year means most inventory value is dormant.`,
      inventory.status, { turnover: inventory.value, inventoryValue: inventory.evidenceInventoryValue }),

    vital('cash_conversion', 'Cash conversion', cash.value, cash.trend,
      cash.value === null ? 'No completed orders are synced yet — order completion is unmeasurable.'
        : cash.status === 'HEALTHY' ? `${formatPct(cash.value)} of orders are fulfilled without cancellation.`
        : cash.status === 'NEEDS_ATTENTION' ? `Cancellations absorb ${formatPct(cash.value)} of order volume.`
        : cash.status === 'RISK' ? `Cancellation leakage of ${formatPct(cash.value)} is pressuring cash flow.`
        : `Cancellation leakage of ${formatPct(cash.value)} is a material cash-flow strain.`,
      cash.status, { cancelledRatio: cash.value, orders30d: cash.orders30d }),

    vital('marketing_roi', 'Marketing ROI', null, 'unknown',
      'Marketing spend is not synced, so ROI is not computed. ProfitPilot never assumes a spend figure — connect ad-channel data to measure it.',
      'NEEDS_ATTENTION', { marketingSpendSynced: false }),

    vital('product_diversity', 'Product diversity', diversity.value, diversity.trend,
      diversity.value === null ? 'No product sales history is available for the concentration index.'
        : diversity.status === 'HEALTHY' ? `Sales are well spread (HHI ${formatNum(diversity.value)}).`
        : diversity.status === 'NEEDS_ATTENTION' ? `Sales concentrate (HHI ${formatNum(diversity.value)}) on a small set of products.`
        : diversity.status === 'RISK' ? `High concentration (HHI ${formatNum(diversity.value)}) — a few products carry the store.`
        : `Severe concentration (HHI ${formatNum(diversity.value)}) — the store is one product away from a revenue shock.`,
      diversity.status, { hhi: diversity.value, productsWithSales: diversity.productsWithSales }),

    vital('order_velocity', 'Order velocity', velocity.value, velocity.trend,
      velocity.value === null ? 'Not enough order history to measure velocity.'
        : velocity.status === 'HEALTHY' ? `Orders grew ${formatPct(velocity.value)} versus the prior 30 days.`
        : velocity.status === 'NEEDS_ATTENTION' ? `Order volume is flat (${formatPct(velocity.value)}).`
        : velocity.status === 'RISK' ? `Order volume declined ${formatPct(Math.abs(velocity.value))}.`
        : `Order volume fell ${formatPct(Math.abs(velocity.value))} — demand is contracting.`,
      velocity.status, { last30dOrders: velocity.last30dOrders, previous30dOrders: velocity.previous30dOrders }),

    vital('acquisition', 'Customer acquisition', acquisition.value, acquisition.trend,
      acquisition.value === null ? 'No customer history is synced yet.'
        : acquisition.status === 'HEALTHY' ? `${acquisition.newCustomers} new customers joined in the last 30 days (${formatPct(acquisition.value)} of base).`
        : acquisition.status === 'NEEDS_ATTENTION' ? `Only ${acquisition.newCustomers} new customers in 30 days (${formatPct(acquisition.value)} of base).`
        : acquisition.status === 'RISK' ? `Acquisition has slowed to ${acquisition.newCustomers} new customers in 30 days.`
        : 'No new customers in the last 30 days — the funnel has stalled.',
      acquisition.status, { newCustomers: acquisition.newCustomers, totalCustomers: snapshot.customers.length }),
  ]
}

/** Weighted overall score + status from the vital signs. */
export function scoreExecutiveHealth(vitals: readonly ExecutiveVitalSign[]): Readonly<{ score: number; status: ExecutiveHealthDiagnosis['overallStatus'] }> {
  const scored = vitals.filter((vital) => vital.value !== null)
  if (scored.length === 0) return { score: 0, status: 'CRITICAL' }
  const weights = scored.map((vital) => VITAL_WEIGHTS[vital.key] ?? 8)
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  const weighted = scored.reduce((sum, vital, index) => sum + vitalStatusScore(vital.status) * (weights[index] ?? 8), 0)
  const score = Math.round(weighted / weightSum)
  const status = score >= 80 ? 'STRONG' : score >= 62 ? 'HEALTHY' : score >= 40 ? 'AT_RISK' : 'CRITICAL'
  return { score, status }
}

function vitalStatusScore(status: VitalSignStatus): number {
  if (status === 'HEALTHY') return HEALTHY_SCORE
  if (status === 'NEEDS_ATTENTION') return NEEDS_ATTENTION_SCORE
  if (status === 'RISK') return RISK_SCORE
  return CRITICAL_SCORE
}

// ────────────────────────────────────────────────────────────────────────────
// Risk radar
// ────────────────────────────────────────────────────────────────────────────

/** Detects risks from real store rows. Empty data yields no risks — never invented ones. */
export function detectExecutiveRisks(snapshot: StoreSnapshot, analytics: AnalyticsSnapshot, now = Date.now()): readonly ExecutiveRiskDraft[] {
  const risks: ExecutiveRiskDraft[] = []
  const currency = snapshot.currency
  const annualizedRevenue = Math.max(0, snapshot.last30dRevenue) * 12
  const productRevenue = productRevenueShare(analytics)

  if (productRevenue.total > 0 && productRevenue.hhi >= 0.45) {
    const severity = productRevenue.hhi >= 0.7 ? 'CRITICAL' : productRevenue.hhi >= 0.58 ? 'HIGH' : 'MEDIUM'
    const topShare = productRevenue.topShare
    risks.push({
      riskType: 'CONCENTRATION',
      title: 'Revenue concentration in few products',
      description: `${formatPct(topShare)} of 120-day revenue comes from the top 3 products (concentration index ${formatNum(productRevenue.hhi)}). A demand shift or stockout in any of them moves the whole business.`,
      severity,
      probability: clamp(productRevenue.hhi, 0.1, 0.95),
      impactIfRealized: Math.round(annualizedRevenue * topShare),
      impactCurrency: currency,
      mitigationPlan: [
        { step: 'Introduce adjacent products to dilute the top-SKU share below 50% of revenue.', timeline: '60 days' },
        { step: 'Hold deeper safety stock on the top 3 revenue SKUs.', timeline: '14 days' },
        { step: 'Add cross-sell bundles to shift buyers toward secondary SKUs.', timeline: '30 days' },
      ],
    })
  }

  const customerConcentration = customerLtvConcentration(snapshot)
  if (customerConcentration !== null && customerConcentration.share >= 0.4) {
    const severity = customerConcentration.share >= 0.6 ? 'HIGH' : 'MEDIUM'
    risks.push({
      riskType: 'CONCENTRATION',
      title: 'Customer concentration in a small buyer base',
      description: `The top 10% of customers hold ${formatPct(customerConcentration.share)} of lifetime value. Losing a handful of buyers would remove a large share of future revenue.`,
      severity,
      probability: clamp(customerConcentration.share, 0.1, 0.9),
      impactIfRealized: Math.round(customerConcentration.share * annualizedRevenue),
      impactCurrency: currency,
      mitigationPlan: [
        { step: 'Launch a referral offer to widen the customer base.', timeline: '30 days' },
        { step: 'Create a win-back flow for one-time buyers to build a second revenue layer.', timeline: '45 days' },
      ],
    })
  }

  const seasonality = monthlySeasonality(analytics)
  if (seasonality !== null && seasonality.cv >= 0.45) {
    const severity = seasonality.cv >= 0.75 ? 'HIGH' : 'MEDIUM'
    risks.push({
      riskType: 'SEASONAL',
      title: 'High seasonal revenue volatility',
      description: `Monthly revenue varies with a coefficient of variation of ${formatNum(seasonality.cv)} (mean ${formatNum(seasonality.meanMonthly)}). Down months are deep and recurring.`,
      severity,
      probability: 0.5,
      impactIfRealized: Math.round(seasonality.meanMonthly * seasonality.cv * 2),
      impactCurrency: currency,
      mitigationPlan: [
        { step: 'Build a cash reserve equal to one weak month of revenue.', timeline: '90 days' },
        { step: 'Plan counter-seasonal offers and bundles ahead of the weakest months.', timeline: '60 days' },
      ],
    })
  }

  const cancellations = cancellationRisk(analytics)
  if (cancellations !== null && cancellations.ratio >= 0.05) {
    const severity = cancellations.ratio >= 0.12 ? 'HIGH' : 'MEDIUM'
    risks.push({
      riskType: 'CASHFLOW',
      title: 'Order cancellation leakage',
      description: `${formatPct(cancellations.ratio)} of recent orders were cancelled or unfulfilled, draining cash conversion and inflating support cost.`,
      severity,
      probability: clamp(cancellations.ratio * 4, 0.15, 0.9),
      impactIfRealized: Math.round(annualizedRevenue * cancellations.ratio),
      impactCurrency: currency,
      mitigationPlan: [
        { step: 'Review the top cancellation reasons on open orders.', timeline: '7 days' },
        { step: 'Tighten inventory accuracy on the most-cancelled SKUs.', timeline: '30 days' },
      ],
    })
  }

  if (snapshot.previous30dRevenue > 0 && snapshot.last30dRevenue / snapshot.previous30dRevenue < 0.8) {
    const drop = 1 - snapshot.last30dRevenue / snapshot.previous30dRevenue
    const severity = drop >= 0.4 ? 'CRITICAL' : drop >= 0.25 ? 'HIGH' : 'MEDIUM'
    risks.push({
      riskType: 'MARKET',
      title: 'Revenue contraction',
      description: `Revenue fell ${formatPct(drop)} versus the prior 30 days. If the trend holds, the annual run rate drops by ${formatNum(Math.round(annualizedRevenue * drop))}.`,
      severity,
      probability: clamp(0.35 + drop, 0.3, 0.9),
      impactIfRealized: Math.round(annualizedRevenue * drop),
      impactCurrency: currency,
      mitigationPlan: [
        { step: 'Isolate the drop by product and channel in analytics.', timeline: '7 days' },
        { step: 'Run a pricing and promotion scenario in GrowthIQ before cutting prices.', timeline: '14 days' },
      ],
    })
  }

  const stockouts = stockoutExposure(snapshot)
  if (stockouts.count > 0) {
    const severity = stockouts.count >= 5 ? 'HIGH' : 'MEDIUM'
    risks.push({
      riskType: 'OPERATIONAL',
      title: 'Selling products are out of stock',
      description: `${stockouts.count} products with real sales velocity now show zero inventory — approximately ${formatNum(Math.round(stockouts.monthlyRevenueAtRisk))} of monthly revenue is exposed.`,
      severity,
      probability: 0.6,
      impactIfRealized: Math.round(stockouts.monthlyRevenueAtRisk),
      impactCurrency: currency,
      mitigationPlan: [
        { step: 'Raise purchase orders for the stockout SKUs immediately.', timeline: '7 days' },
        { step: 'Set reorder points from each SKU’s daily velocity.', timeline: '30 days' },
      ],
    })
  }

  const competition = competitionSignal(snapshot, analytics)
  if (competition !== null) {
    risks.push({
      riskType: 'COMPETITION',
      title: 'Pricing or competition pressure on demand',
      description: `Orders fell ${formatPct(Math.abs(competition.orderChange))} while average order value rose ${formatPct(competition.aovChange)} — demand volume is shrinking even though prices are up, a classic competitive-pressure pattern.`,
      severity: competition.orderChange <= -0.25 ? 'HIGH' : 'MEDIUM',
      probability: clamp(0.3 + Math.abs(competition.orderChange), 0.3, 0.85),
      impactIfRealized: Math.round(Math.abs(competition.orderShortfall) * competition.aov * 12),
      impactCurrency: currency,
      mitigationPlan: [
        { step: 'Compare landed prices on best-sellers against visible competitors.', timeline: '14 days' },
        { step: 'Model a price repositioning in Scenario Planning before changing anything.', timeline: '30 days' },
      ],
    })
  }

  return risks
}

// ────────────────────────────────────────────────────────────────────────────
// Strategic opportunities
// ────────────────────────────────────────────────────────────────────────────

/** Identifies opportunities with real impact math. Insufficient data → no opportunity. */
export function identifyExecutiveOpportunities(snapshot: StoreSnapshot, analytics: AnalyticsSnapshot, now = Date.now()): readonly ExecutiveOpportunityDraft[] {
  const opportunities: ExecutiveOpportunityDraft[] = []
  const currency = snapshot.currency
  const productRevenue = productRevenueShare(analytics)

  const pricing = pricingHeadroom(snapshot)
  if (pricing.count > 0 && pricing.annualUplift > 0) {
    opportunities.push({
      category: 'PRICING',
      title: 'Reprice high-margin best-sellers',
      description: `${pricing.count} products carry margins well above the catalog median and still sell steadily. A conservative 5% test increase on those SKUs would add roughly ${formatNum(Math.round(pricing.annualUplift))} per year if volume holds.`,
      estimatedImpactAnnual: Math.round(pricing.annualUplift),
      impactCurrency: currency,
      confidence: clamp(0.5 + pricing.count / 20, 0.3, 0.8),
      effortLevel: 'LOW',
      timeline: '30_DAYS',
      actionPlan: [
        { step: 'Run the pricing scenario in Scenario Planning for the exact SKUs.', detail: 'Confirm elasticity assumptions against your own numbers.' },
        { step: 'Raise prices 5% on the candidate SKUs only.', detail: 'Keep control SKUs unchanged to measure the effect.' },
        { step: 'Re-evaluate after 30 days against the control group.', detail: 'Revert any SKU whose velocity falls more than the uplift.' },
      ],
    })
  }

  const crossSell = crossSellOpportunity(snapshot, analytics)
  if (crossSell.annualImpact > 0) {
    opportunities.push({
      category: 'CROSS_SELL',
      title: 'Bundle frequently co-purchased pairs',
      description: `Orders frequently pair ${crossSell.pairs.map((pair) => pair.label).join(' and ')}. Bundling these pairs captures approximately ${formatNum(Math.round(crossSell.annualImpact))} of attach revenue per year.`,
      estimatedImpactAnnual: Math.round(crossSell.annualImpact),
      impactCurrency: currency,
      confidence: clamp(0.45 + crossSell.pairs.length / 10, 0.35, 0.75),
      effortLevel: 'MEDIUM',
      timeline: '60_DAYS',
      actionPlan: [
        { step: 'Create one bundle product for the strongest pair.', detail: 'Price the bundle 8-10% below the sum of the parts.' },
        { step: 'Add the bundle to the product and cart pages.', detail: 'Measure attach rate weekly.' },
      ],
    })
  }

  const momentum = risingMomentum(snapshot, analytics)
  if (momentum.length > 0) {
    const annualImpact = momentum.reduce((sum, item) => sum + item.extraMonthly * 12, 0)
    opportunities.push({
      category: 'SEASONAL',
      title: 'Stock up on accelerating products',
      description: `${momentum.length} products grew unit velocity more than 30% versus the prior period (${momentum.slice(0, 3).map((item) => item.title).join(', ')}). Securing inventory ahead of the trend protects roughly ${formatNum(Math.round(annualImpact))} of incremental annual revenue.`,
      estimatedImpactAnnual: Math.round(annualImpact),
      impactCurrency: currency,
      confidence: clamp(0.4 + momentum.length / 15, 0.3, 0.7),
      effortLevel: 'LOW',
      timeline: '30_DAYS',
      actionPlan: [
        { step: 'Raise reorder points on the accelerating SKUs.', detail: 'Use 30-day velocity as the new baseline.' },
        { step: 'Prioritise these SKUs in the next purchase order.', detail: 'Avoid stockout during the upswing.' },
      ],
    })
  }

  const retention = retentionHeadroom(snapshot, analytics)
  if (retention !== null && retention.annualImpact > 0) {
    opportunities.push({
      category: 'EXPANSION',
      title: 'Turn one-time buyers into repeat customers',
      description: `Only ${formatPct(retention.repeatRate)} of customers return. Moving the repeat rate toward 30% would add approximately ${formatNum(Math.round(retention.annualImpact))} per year from the existing buyer base — no new acquisition cost.`,
      estimatedImpactAnnual: Math.round(retention.annualImpact),
      impactCurrency: currency,
      confidence: clamp(0.4 + snapshot.customers.length / 100, 0.3, 0.7),
      effortLevel: 'MEDIUM',
      timeline: '90_DAYS',
      actionPlan: [
        { step: 'Segment one-time buyers by product purchased.', detail: 'Create a post-purchase follow-up sequence.' },
        { step: 'Offer a second-purchase incentive within 30 days of the first order.', detail: 'Measure repeat rate monthly.' },
      ],
    })
  }

  if (productRevenue.total > 0 && productRevenue.distinctProducts > 0 && productRevenue.distinctProducts < 10 && snapshot.last30dRevenue > 0) {
    const medianMonthly = productRevenue.total / Math.max(productRevenue.distinctProducts, 1)
    opportunities.push({
      category: 'PRODUCT',
      title: 'Expand the catalog beyond the current line',
      description: `The store runs on ${productRevenue.distinctProducts} products. Adding one product at the store’s current per-product performance would add approximately ${formatNum(Math.round(medianMonthly * 12 * 0.8))} per year after ramp-up.`,
      estimatedImpactAnnual: Math.round(medianMonthly * 12 * 0.8),
      impactCurrency: currency,
      confidence: clamp(0.35 + productRevenue.distinctProducts / 25, 0.25, 0.6),
      effortLevel: 'HIGH',
      timeline: '90_DAYS',
      actionPlan: [
        { step: 'List 3 candidate products adjacent to the best-selling SKU.', detail: 'Prefer suppliers you already use.' },
        { step: 'Launch the strongest candidate with a 90-day sell-through target.', detail: 'Track against the store per-product median.' },
      ],
    })
  }

  return opportunities.sort((left, right) => right.estimatedImpactAnnual - left.estimatedImpactAnnual)
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario planning
// ────────────────────────────────────────────────────────────────────────────

export type ScenarioProjection = Readonly<{
  baseline: Readonly<Record<string, number>>
  projected: Readonly<Record<string, number>>
  delta: Readonly<Record<string, number>>
  horizonMonths: number
  assumptions: readonly string[]
}>

/**
 * Projects a what-if scenario from the store's real historical baseline.
 * The model is transparent: every non-historical coefficient is listed in
 * `assumptions` and the confidence score shrinks when history is thin.
 */
export function projectExecutiveScenario(snapshot: StoreSnapshot, analytics: AnalyticsSnapshot, scenarioType: ScenarioType, inputs: ScenarioInput): Readonly<{ predictions: ScenarioProjection; confidence: number; riskLevel: RiskLevel; recommendation: string }> {
  const monthlyRevenue = Math.max(snapshot.last30dRevenue, 0)
  const monthlyOrders = Math.max(snapshot.last30dOrders, 0)
  const aov = monthlyOrders > 0 ? monthlyRevenue / monthlyOrders : 0
  const currency = snapshot.currency
  const orderConfidence = clamp(0.35 + monthlyOrders / 400, 0.2, 0.85)
  const num = (key: string, fallback: number): number => {
    const value = inputs[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  if (scenarioType === 'PRICING') {
    const pct = num('priceChangePct', 5) / 100
    // Planning assumption: conservative inelastic demand (-0.8) for a
    // branded catalog; historical price tests replace this assumption.
    const elasticity = -0.8
    const newPrice = aov * (1 + pct)
    const newOrders = monthlyOrders * (1 + pct * elasticity)
    const newRevenue = newPrice * newOrders
    const margin = grossMarginRate(snapshot)
    const baselineProfit = monthlyRevenue * margin
    const newProfit = newRevenue * margin
    const predictions: ScenarioProjection = {
      baseline: { monthlyRevenue: round2(monthlyRevenue), monthlyOrders: round2(monthlyOrders), aov: round2(aov), monthlyProfit: round2(baselineProfit) },
      projected: { monthlyRevenue: round2(newRevenue), monthlyOrders: round2(newOrders), aov: round2(newPrice), monthlyProfit: round2(newProfit) },
      delta: { monthlyRevenue: round2(newRevenue - monthlyRevenue), monthlyOrders: round2(newOrders - monthlyOrders), aov: round2(newPrice - aov), monthlyProfit: round2(newProfit - baselineProfit) },
      horizonMonths: 1,
      assumptions: [
        `Price elasticity assumed at ${elasticity} (conservative inelastic demand) — connect historical price tests to replace this planning assumption.`,
        `Gross margin measured at ${formatPct(margin)} from synced variant costs${margin === 0 ? ' (no cost data synced — profit deltas use revenue as a proxy)' : ''}.`,
        'No competitive response or demand shocks are modeled.',
      ],
    }
    const riskLevel: RiskLevel = Math.abs(pct) >= 0.2 ? 'HIGH' : Math.abs(pct) >= 0.1 ? 'MEDIUM' : 'LOW'
    return {
      predictions,
      confidence: clamp(orderConfidence - (Math.abs(pct) >= 0.2 ? 0.1 : 0), 0.1, 0.85),
      riskLevel,
      recommendation: pct >= 0
        ? `A ${formatPct(pct)} price increase projects ${currency} ${formatNum(round2(newRevenue - monthlyRevenue))} per month in revenue at assumed unit elasticity. Apply it to a small SKU set first and compare against unchanged control SKUs for 30 days.`
        : `A ${formatPct(pct)} price decrease projects ${currency} ${formatNum(round2(newOrders - monthlyOrders))} additional orders per month. Use it as a demand experiment only if margin covers the reduction.`,
    }
  }

  if (scenarioType === 'PRODUCT') {
    const share = productRevenueShare(analytics)
    const newProducts = Math.max(1, Math.round(num('newProducts', 1)))
    const perProduct = share.total > 0 && share.distinctProducts > 0
      ? share.total / share.distinctProducts
      : monthlyRevenue > 0 ? monthlyRevenue : 0
    // Ramp assumption: 50% / 75% / 100% of the store's per-product median.
    const ramp = [0.5, 0.75, 1]
    const horizon = ramp.length
    const maturity = ramp.at(-1) ?? 1
    const projectedMonthly = round2(monthlyRevenue + newProducts * perProduct * maturity)
    const predictions: ScenarioProjection = {
      baseline: { monthlyRevenue: round2(monthlyRevenue), perProductMedian: round2(perProduct), catalogSize: share.distinctProducts },
      projected: { monthlyRevenueAtHorizon: projectedMonthly, totalIncrementalRevenue: round2(projectedMonthly - monthlyRevenue), monthsToRamp: horizon },
      delta: { monthlyRevenue: round2(projectedMonthly - monthlyRevenue) },
      horizonMonths: horizon,
      assumptions: [
        `New products perform at the store's current per-product monthly median (${currency} ${formatNum(round2(perProduct))}).`,
        'Ramp-up follows a 50% / 75% / 100% maturity curve over three months.',
        'No cannibalisation of existing SKUs is modeled.',
      ],
    }
    return {
      predictions,
      confidence: clamp(0.25 + share.distinctProducts / 30, 0.15, 0.6),
      riskLevel: newProducts >= 5 ? 'HIGH' : newProducts >= 2 ? 'MEDIUM' : 'LOW',
      recommendation: perProduct > 0
        ? `Launching ${newProducts} products projects ${currency} ${formatNum(round2(projectedMonthly - monthlyRevenue))} of additional monthly revenue at maturity, assuming store-median performance. Start with the product closest to your best-selling SKU.`
        : 'There is no historical product performance yet, so launch projections cannot be computed. Sync sales history first.',
    }
  }

  if (scenarioType === 'MARKETING') {
    const spendChange = num('spendChangeMonthly', 500)
    // Planning assumption: conservative 3.0 blended ROAS.
    const roas = num('expectedRoas', 3)
    const margin = grossMarginRate(snapshot)
    const revenueDelta = spendChange * roas
    const profitDelta = revenueDelta * margin - spendChange
    const predictions: ScenarioProjection = {
      baseline: { monthlyRevenue: round2(monthlyRevenue), marketingSpend: 0, assumedRoas: roas },
      projected: { monthlyRevenue: round2(monthlyRevenue + revenueDelta), incrementalRevenue: round2(revenueDelta), incrementalProfit: round2(profitDelta) },
      delta: { monthlyRevenue: round2(revenueDelta), monthlyProfit: round2(profitDelta) },
      horizonMonths: 1,
      assumptions: [
        `Blended ROAS assumed at ${formatNum(roas)}× — connect ad-channel data to replace this planning assumption with measured returns.`,
        `Gross margin measured at ${formatPct(margin)} from synced variant costs${margin === 0 ? ' (no cost data synced — profit deltas use revenue as a proxy)' : ''}.`,
        'Spend change is applied on top of the current monthly revenue baseline.',
      ],
    }
    const riskLevel: RiskLevel = spendChange / Math.max(monthlyRevenue, 1) >= 0.3 ? 'HIGH' : spendChange / Math.max(monthlyRevenue, 1) >= 0.1 ? 'MEDIUM' : 'LOW'
    return {
      predictions,
      confidence: 0.3,
      riskLevel,
      recommendation: profitDelta >= 0
        ? `At the assumed ${formatNum(roas)}× return, ${currency} ${formatNum(spendChange)} of added monthly spend projects ${currency} ${formatNum(round2(profitDelta))} of incremental monthly profit. Verify against measured channel ROAS before scaling.`
        : `At the assumed ${formatNum(roas)}× return this spend level does not clear the store's ${formatPct(margin)} margin. Reduce spend or improve conversion first.`,
    }
  }

  if (scenarioType === 'INVENTORY') {
    const stockPct = num('stockChangePct', 20) / 100
    const inventoryValue = inventoryValueAtCost(snapshot)
    const daysCover = aggregateDaysOfCover(snapshot)
    const projectedCover = daysCover === null ? null : daysCover * (1 + stockPct)
    const stockoutProbability = (cover: number | null): number => (cover === null ? 0.5 : clamp(1 - cover / 30, 0, 1))
    const cashDelta = round2(inventoryValue * stockPct)
    const predictions: ScenarioProjection = {
      baseline: { inventoryValue: round2(inventoryValue), daysOfCover: round2(daysCover ?? 0), stockoutProbability: round2(stockoutProbability(daysCover)) },
      projected: { inventoryValue: round2(inventoryValue * (1 + stockPct)), daysOfCover: round2(projectedCover ?? 0), stockoutProbability: round2(stockoutProbability(projectedCover)) },
      delta: { cashTiedUp: cashDelta, stockoutProbability: round2(stockoutProbability(projectedCover) - stockoutProbability(daysCover)) },
      horizonMonths: 1,
      assumptions: [
        'Stockout probability follows a 30-day days-of-cover heuristic.',
        'Inventory value is measured at synced variant cost (price used where cost is not synced).',
        'Unit velocity stays constant over the horizon.',
      ],
    }
    const riskLevel: RiskLevel = cashDelta / Math.max(monthlyRevenue, 1) >= 0.5 ? 'HIGH' : 'MEDIUM'
    return {
      predictions,
      confidence: daysCover === null ? 0.2 : 0.5,
      riskLevel,
      recommendation: stockPct >= 0
        ? `Increasing stock ${formatPct(stockPct)} raises days of cover and lowers modelled stockout probability, tying up ${currency} ${formatNum(Math.abs(cashDelta))} of cash. Fund it from the strongest-turnover SKUs first.`
        : `Reducing stock ${formatPct(Math.abs(stockPct))} frees ${currency} ${formatNum(Math.abs(cashDelta))} of cash but raises modelled stockout probability — only cut the slowest-turning SKUs.`,
    }
  }

  // CUSTOM — merchant-defined growth curve.
  const growthPct = num('annualRevenueGrowthPct', 20) / 100
  const months = clamp(Math.round(num('months', 12)), 1, 24)
  const monthlyGrowth = Math.pow(1 + growthPct, 1 / 12) - 1
  let projected = monthlyRevenue
  let cumulativeDelta = 0
  for (let month = 0; month < months; month += 1) {
    projected *= 1 + monthlyGrowth
    if (month === months - 1) cumulativeDelta = projected - monthlyRevenue
  }
  const predictions: ScenarioProjection = {
    baseline: { monthlyRevenue: round2(monthlyRevenue), annualRunRate: round2(monthlyRevenue * 12) },
    projected: { monthlyRevenueAtHorizon: round2(projected), annualRunRateAtHorizon: round2(projected * 12) },
    delta: { monthlyRevenue: round2(cumulativeDelta) },
    horizonMonths: months,
    assumptions: [
      `Annual growth target of ${formatPct(growthPct)} compounded monthly over ${months} months.`,
      'No capacity, inventory, or cash constraints are modeled.',
    ],
  }
  return {
    predictions,
    confidence: clamp(0.3 - months * 0.005, 0.15, 0.3),
    riskLevel: growthPct >= 0.5 ? 'HIGH' : growthPct >= 0.25 ? 'MEDIUM' : 'LOW',
    recommendation: `Holding the ${formatPct(growthPct)} annual target needs ${currency} ${formatNum(round2(cumulativeDelta))} of additional monthly revenue within ${months} months. Break the target into the specific initiatives that close that gap — see Strategic Opportunities.`,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Decision log
// ────────────────────────────────────────────────────────────────────────────

/** Relative accuracy of predicted vs actual outcomes across shared numeric keys (0-1). */
export function decisionAccuracyScore(predicted: Readonly<Record<string, number | string>>, actual: Readonly<Record<string, number | string>>): number {
  const keys = Object.keys(predicted).filter((key) => typeof predicted[key] === 'number' && typeof actual[key] === 'number')
  if (keys.length === 0) return 0
  const scores = keys.map((key) => {
    const expected = Number(predicted[key])
    const observed = Number(actual[key])
    const scale = Math.max(Math.abs(expected), Math.abs(observed), 1)
    return clamp(1 - Math.abs(observed - expected) / scale, 0, 1)
  })
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

export function qualityRatingForAccuracy(score: number): DecisionQuality {
  if (score >= 0.9) return 'EXCELLENT'
  if (score >= 0.7) return 'GOOD'
  if (score >= 0.5) return 'FAIR'
  return 'POOR'
}

export function decisionLessons(predicted: Readonly<Record<string, number | string>>, actual: Readonly<Record<string, number | string>>, accuracy: number): string {
  const worst = Object.keys(predicted)
    .filter((key) => typeof predicted[key] === 'number' && typeof actual[key] === 'number')
    .map((key) => ({ key, gap: Math.abs(Number(actual[key]) - Number(predicted[key])) / Math.max(Math.abs(Number(predicted[key])), 1) }))
    .sort((left, right) => right.gap - left.gap)[0]
  if (!worst) return 'No numeric outcomes were recorded, so accuracy could not be computed. Log numeric targets next time.'
  if (accuracy >= 0.7) return `Forecast quality was strong (${formatPct(accuracy)}). The largest deviation was in "${worst.key}" — keep using this estimation approach and refine that input.`
  return `Forecast quality was weak (${formatPct(accuracy)}). The largest miss was in "${worst.key}". Recalibrate the assumption behind that number before the next similar decision.`
}

// ────────────────────────────────────────────────────────────────────────────
// Roadmaps
// ────────────────────────────────────────────────────────────────────────────

/** Progress = completed milestones / total milestones (0-1). */
export function roadmapProgressFromMilestones(milestones: readonly RoadmapMilestone[], now = Date.now()): number {
  if (milestones.length === 0) return 0
  const complete = milestones.filter((milestone) => milestone.status === 'COMPLETE').length
  return clamp(complete / milestones.length, 0, 1)
}

/** The first non-complete milestone (by due date) becomes CURRENT when its window opens. */
export function applyMilestoneClock(milestones: readonly RoadmapMilestone[], now = Date.now()): readonly RoadmapMilestone[] {
  let currentAssigned = false
  const sorted = [...milestones].sort((left, right) => left.dueDate.localeCompare(right.dueDate))
  // Prefer the earliest milestone whose window is open (due within the next
  // week, or overdue); otherwise the earliest future milestone is CURRENT.
  const preferred = sorted.find((milestone) => milestone.status !== 'COMPLETE' && Date.parse(milestone.dueDate) <= now + 7 * DAY_MS)
  const fallback = sorted.find((milestone) => milestone.status !== 'COMPLETE')
  const currentKey = (preferred ?? fallback)?.key ?? null
  return sorted.map((milestone) => {
    if (milestone.status === 'COMPLETE') return milestone
    if (!currentAssigned && milestone.key === currentKey) {
      currentAssigned = true
      return { ...milestone, status: 'CURRENT' as const }
    }
    return milestone.status === 'CURRENT' ? { ...milestone, status: 'PENDING' as const } : milestone
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Benchmarks
// ────────────────────────────────────────────────────────────────────────────

/** Piecewise-linear percentile rank of `value` inside the 10/25/50/75/90 ladder (0-100). */
export function benchmarkPercentile(points: readonly Readonly<{ percentile: BenchmarkPercentile; value: number }>[], value: number): number {
  if (points.length === 0) return 0
  const sorted = [...points].sort((left, right) => left.value - right.value)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  if (value <= first.value) {
    const span = sorted.length > 1 ? (sorted[1]!.value - first.value) : 1
    return clamp(first.percentile * (span > 0 ? Math.max(value / Math.max(first.value, 1e-9), 0.1) : 0.1), 0.1, first.percentile)
  }
  if (value >= last.value) {
    const previous = sorted[sorted.length - 2]
    if (!previous) return last.percentile
    const span = last.value - previous.value
    const over = span > 0 ? (value - last.value) / span : 0
    return clamp(last.percentile + over * (100 - last.percentile) * 0.5, last.percentile, 99.9)
  }
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const low = sorted[index]!
    const high = sorted[index + 1]!
    if (value >= low.value && value <= high.value) {
      const span = high.value - low.value
      if (span <= 0) return low.percentile
      const fraction = (value - low.value) / span
      return low.percentile + fraction * (high.percentile - low.percentile)
    }
  }
  return first.percentile
}

// ────────────────────────────────────────────────────────────────────────────
// Internal math helpers
// ────────────────────────────────────────────────────────────────────────────

function vital(key: string, label: string, value: number | null, trend: ExecutiveVitalSign['trend'], explanation: string, status: VitalSignStatus, evidence: Readonly<Record<string, string | number | boolean | null>>): ExecutiveVitalSign {
  return {
    key,
    label,
    status,
    value: value === null ? null : round2(value),
    formattedValue: value === null ? 'No data' : key === 'revenue_growth' || key === 'order_velocity' || key === 'retention' || key === 'cash_conversion' || key === 'acquisition' ? formatPct(value) : formatNum(value),
    trend,
    explanation,
    evidence,
  }
}

function sinceDays(now: number, days: number): string {
  return new Date(now - days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Defensive date-label normalization for `date` column values.
 *
 * The analytics repository already normalizes `day` to `YYYY-MM-DD` strings,
 * but this engine also runs in scheduled ticks and tests where rows can arrive
 * as `Date` objects (the `pg` driver's default for `date` columns). A
 * non-string `day` here previously crashed the whole dashboard with
 * "row.day.slice is not a function", so every window comparison and slice in
 * the executive engine goes through this helper instead.
 */
function dayLabel(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

function growthRate(current: number, previous: number): Readonly<{ value: number | null; status: VitalSignStatus; trend: ExecutiveVitalSign['trend'] }> {
  if (previous <= 0 || current <= 0) return { value: null, status: 'NEEDS_ATTENTION', trend: 'unknown' }
  const rate = current / previous - 1
  const status: VitalSignStatus = rate >= 0.15 ? 'HEALTHY' : rate >= 0 ? 'NEEDS_ATTENTION' : rate >= -0.15 ? 'RISK' : 'CRITICAL'
  return { value: rate, status, trend: rate > 0.02 ? 'up' : rate < -0.02 ? 'down' : 'flat' }
}

function repeatPurchaseRate(snapshot: StoreSnapshot): Readonly<{ value: number | null; status: VitalSignStatus; trend: ExecutiveVitalSign['trend'] }> {
  if (snapshot.customers.length === 0) return { value: null, status: 'NEEDS_ATTENTION', trend: 'unknown' }
  const repeats = snapshot.customers.filter((customer) => customer.orderCount >= 2).length
  const rate = repeats / snapshot.customers.length
  const status: VitalSignStatus = rate >= 0.3 ? 'HEALTHY' : rate >= 0.2 ? 'NEEDS_ATTENTION' : rate >= 0.1 ? 'RISK' : 'CRITICAL'
  return { value: rate, status, trend: rate >= 0.3 ? 'up' : 'down' }
}

function inventoryTurnover(snapshot: StoreSnapshot, analytics: AnalyticsSnapshot): Readonly<{ value: number | null; status: VitalSignStatus; trend: ExecutiveVitalSign['trend']; evidenceInventoryValue: number }> {
  const units30 = new Map<string, number>()
  const last30 = sinceDays(Date.parse(snapshot.asOf), 30)
  for (const row of analytics.productSales) if (dayLabel(row.day) >= last30) units30.set(row.productId, (units30.get(row.productId) ?? 0) + row.unitsSold)
  let cogs30 = 0
  let inventoryValue = 0
  for (const product of snapshot.products) {
    const cost = product.unitCost ?? product.unitPrice
    cogs30 += (units30.get(product.productId) ?? 0) * cost
    inventoryValue += product.inventoryUnits * cost
  }
  if (inventoryValue <= 0 || cogs30 <= 0) return { value: null, status: 'NEEDS_ATTENTION', trend: 'unknown', evidenceInventoryValue: round2(inventoryValue) }
  const turnover = (cogs30 * 12) / inventoryValue
  const status: VitalSignStatus = turnover >= 6 ? 'HEALTHY' : turnover >= 3 ? 'NEEDS_ATTENTION' : turnover >= 1.5 ? 'RISK' : 'CRITICAL'
  return { value: turnover, status, trend: turnover >= 3 ? 'up' : 'down', evidenceInventoryValue: round2(inventoryValue) }
}

function cashConversion(analytics: AnalyticsSnapshot): Readonly<{ value: number | null; status: VitalSignStatus; trend: ExecutiveVitalSign['trend']; orders30d: number }> {
  const total = analytics.orders.reduce((sum, row) => sum + row.fulfilledCount + row.cancelledCount, 0)
  if (total === 0) return { value: null, status: 'NEEDS_ATTENTION', trend: 'unknown', orders30d: 0 }
  const cancelled = analytics.orders.reduce((sum, row) => sum + row.cancelledCount, 0)
  const ratio = cancelled / total
  const status: VitalSignStatus = ratio <= 0.02 ? 'HEALTHY' : ratio <= 0.05 ? 'NEEDS_ATTENTION' : ratio <= 0.1 ? 'RISK' : 'CRITICAL'
  return { value: ratio, status, trend: ratio <= 0.05 ? 'up' : 'down', orders30d: total }
}

function productDiversity(analytics: AnalyticsSnapshot): Readonly<{ value: number | null; status: VitalSignStatus; trend: ExecutiveVitalSign['trend']; productsWithSales: number }> {
  const share = productRevenueShare(analytics)
  if (share.total <= 0) return { value: null, status: 'NEEDS_ATTENTION', trend: 'unknown', productsWithSales: share.distinctProducts }
  const hhi = share.hhi
  const status: VitalSignStatus = hhi <= 0.2 ? 'HEALTHY' : hhi <= 0.4 ? 'NEEDS_ATTENTION' : hhi <= 0.6 ? 'RISK' : 'CRITICAL'
  return { value: hhi, status, trend: hhi <= 0.4 ? 'up' : 'down', productsWithSales: share.distinctProducts }
}

function orderVelocity(analytics: AnalyticsSnapshot): Readonly<{ value: number | null; status: VitalSignStatus; trend: ExecutiveVitalSign['trend']; last30dOrders: number; previous30dOrders: number }> {
  const last30 = sinceDays(Date.now(), 30)
  const prev30 = sinceDays(Date.now(), 60)
  const last = analytics.orders.filter((row) => dayLabel(row.day) >= last30).reduce((sum, row) => sum + row.orderCount, 0)
  const previous = analytics.orders.filter((row) => dayLabel(row.day) >= prev30 && dayLabel(row.day) < last30).reduce((sum, row) => sum + row.orderCount, 0)
  const growth = growthRate(last, previous)
  return { value: growth.value, status: growth.status, trend: growth.trend, last30dOrders: last, previous30dOrders: previous }
}

function customerAcquisition(snapshot: StoreSnapshot, last30: string): Readonly<{ value: number | null; status: VitalSignStatus; trend: ExecutiveVitalSign['trend']; newCustomers: number }> {
  if (snapshot.customers.length === 0) return { value: null, status: 'NEEDS_ATTENTION', trend: 'unknown', newCustomers: 0 }
  const newCustomers = snapshot.customers.filter((customer) => customer.firstOrderDay >= last30).length
  const rate = newCustomers / snapshot.customers.length
  const status: VitalSignStatus = rate >= 0.15 ? 'HEALTHY' : rate >= 0.05 ? 'NEEDS_ATTENTION' : rate > 0 ? 'RISK' : 'CRITICAL'
  return { value: rate, status, trend: rate >= 0.05 ? 'up' : 'down', newCustomers }
}

function buildConditions(vitals: readonly ExecutiveVitalSign[]): VitalComputation['conditions'] {
  return vitals
    .filter((vital) => vital.status === 'RISK' || vital.status === 'CRITICAL')
    .map((vital) => ({
      key: vital.key,
      title: vital.label,
      severity: vital.status,
      causes: vital.explanation,
      treatment: treatmentFor(vital.key),
    }))
}

function treatmentFor(key: string): string {
  if (key === 'revenue_growth') return 'Isolate the decline by product and channel, then model corrective pricing or promotion scenarios before acting.'
  if (key === 'retention') return 'Launch a post-purchase follow-up sequence and a second-order incentive for one-time buyers.'
  if (key === 'inventory_turnover') return 'Clear slow-moving stock with bundles or markdowns and re-buy only fast-turning SKUs.'
  if (key === 'cash_conversion') return 'Review cancellation reasons, tighten inventory accuracy, and confirm payment capture settings.'
  if (key === 'marketing_roi') return 'Connect ad-channel data so ROI can be measured instead of assumed.'
  if (key === 'product_diversity') return 'Introduce adjacent products to dilute the top-SKU concentration below 50% of revenue.'
  if (key === 'order_velocity') return 'Re-examine pricing and traffic quality, then run a marketing scenario to model recovery spend.'
  if (key === 'acquisition') return 'Increase top-of-funnel traffic and measure new-customer conversion weekly.'
  return 'Monitor the metric weekly and re-diagnose after 30 days.'
}

function productRevenueShare(analytics: AnalyticsSnapshot): Readonly<{ total: number; distinctProducts: number; hhi: number; topShare: number }> {
  const byProduct = new Map<string, number>()
  for (const row of analytics.productSales) byProduct.set(row.productId, (byProduct.get(row.productId) ?? 0) + row.grossRevenue)
  const revenues = [...byProduct.values()].sort((left, right) => right - left)
  const total = revenues.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return { total: 0, distinctProducts: revenues.length, hhi: 0, topShare: 0 }
  const shares = revenues.map((value) => value / total)
  const hhi = shares.reduce((sum, share) => sum + share * share, 0)
  const topShare = shares.slice(0, 3).reduce((sum, share) => sum + share, 0)
  return { total, distinctProducts: revenues.length, hhi, topShare }
}

function customerLtvConcentration(snapshot: StoreSnapshot): Readonly<{ share: number }> | null {
  if (snapshot.customers.length < 10) return null
  const ltvs = snapshot.customers.map((customer) => customer.lifetimeValue).sort((left, right) => right - left)
  const total = ltvs.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return null
  const topCount = Math.max(1, Math.round(ltvs.length * 0.1))
  const topSum = ltvs.slice(0, topCount).reduce((sum, value) => sum + value, 0)
  return { share: topSum / total }
}

function monthlySeasonality(analytics: AnalyticsSnapshot): Readonly<{ cv: number; meanMonthly: number }> | null {
  const byMonth = new Map<string, number>()
  for (const row of analytics.revenue) {
    const month = dayLabel(row.day).slice(0, 7)
    if (!month) continue
    byMonth.set(month, (byMonth.get(month) ?? 0) + row.grossRevenue)
  }
  const values = [...byMonth.values()]
  if (values.length < 3) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (mean <= 0) return null
  const variance = values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length
  return { cv: Math.sqrt(variance) / mean, meanMonthly: mean }
}

function cancellationRisk(analytics: AnalyticsSnapshot): Readonly<{ ratio: number }> | null {
  const total = analytics.orders.reduce((sum, row) => sum + row.fulfilledCount + row.cancelledCount, 0)
  if (total === 0) return null
  const cancelled = analytics.orders.reduce((sum, row) => sum + row.cancelledCount, 0)
  return { ratio: cancelled / total }
}

function stockoutExposure(snapshot: StoreSnapshot): Readonly<{ count: number; monthlyRevenueAtRisk: number }> {
  const exposed = snapshot.products.filter((product) => product.inventoryUnits === 0 && product.averageDailyUnits > 0 && product.unitsSold120d > 0)
  const monthlyRevenueAtRisk = exposed.reduce((sum, product) => sum + product.averageDailyUnits * 30 * product.unitPrice, 0)
  return { count: exposed.length, monthlyRevenueAtRisk }
}

function competitionSignal(snapshot: StoreSnapshot, analytics: AnalyticsSnapshot): Readonly<{ orderChange: number; aovChange: number; orderShortfall: number; aov: number }> | null {
  const last30 = sinceDays(Date.now(), 30)
  const prev30 = sinceDays(Date.now(), 60)
  const last = analytics.orders.filter((row) => dayLabel(row.day) >= last30)
  const previous = analytics.orders.filter((row) => dayLabel(row.day) >= prev30 && dayLabel(row.day) < last30)
  const lastOrders = last.reduce((sum, row) => sum + row.orderCount, 0)
  const prevOrders = previous.reduce((sum, row) => sum + row.orderCount, 0)
  const lastAov = last.reduce((sum, row) => sum + row.averageOrderValue * row.orderCount, 0) / Math.max(lastOrders, 1)
  const prevAov = previous.reduce((sum, row) => sum + row.averageOrderValue * row.orderCount, 0) / Math.max(prevOrders, 1)
  if (prevOrders <= 0 || prevAov <= 0) return null
  const orderChange = lastOrders / prevOrders - 1
  const aovChange = lastAov / prevAov - 1
  if (orderChange > -0.1) return null
  return { orderChange, aovChange, orderShortfall: prevOrders - lastOrders, aov: lastAov }
}

function pricingHeadroom(snapshot: StoreSnapshot): Readonly<{ count: number; annualUplift: number }> {
  const withCost = snapshot.products.flatMap((product) => (product.unitCost !== null && product.unitCost > 0 && product.unitPrice > 0 ? [{ product, cost: product.unitCost }] : []))
  if (withCost.length < 3) return { count: 0, annualUplift: 0 }
  const margins = withCost.map((entry) => entry.product.unitPrice / entry.cost).sort((left, right) => left - right)
  const medianMargin = margins[Math.floor(margins.length / 2)] ?? 1
  const candidates = withCost.filter((entry) => entry.product.unitPrice / entry.cost >= medianMargin * 1.15 && entry.product.unitsSold120d > 0)
  const annualUplift = candidates.reduce((sum, entry) => sum + entry.product.unitsSold120d * entry.product.unitPrice * 3 * 0.05, 0)
  return { count: candidates.length, annualUplift }
}

function crossSellOpportunity(snapshot: StoreSnapshot, analytics: AnalyticsSnapshot): Readonly<{ annualImpact: number; pairs: readonly Readonly<{ label: string }>[] }> {
  const velocity = new Map<string, number>()
  for (const row of analytics.productSales) velocity.set(row.productId, (velocity.get(row.productId) ?? 0) + row.unitsSold)
  const pairs = snapshot.productPairs
    .filter((pair) => pair.coPurchaseRate >= 0.1)
    .sort((left, right) => right.coPurchaseRate - left.coPurchaseRate)
    .slice(0, 3)
  const annualImpact = pairs.reduce((sum, pair) => sum + pair.coPurchaseRate * pair.relatedProductPrice * Math.max(velocity.get(pair.relatedProductId) ?? 0, 1), 0) * 12
  return { annualImpact, pairs: pairs.map((pair) => ({ label: pair.productId })) }
}

function risingMomentum(snapshot: StoreSnapshot, analytics: AnalyticsSnapshot): readonly Readonly<{ title: string; extraMonthly: number }>[] {
  const last30 = sinceDays(Date.now(), 30)
  const prev30 = sinceDays(Date.now(), 60)
  const windows = new Map<string, { last: number; previous: number }>()
  for (const row of analytics.productSales) {
    const entry = windows.get(row.productId) ?? { last: 0, previous: 0 }
    const day = dayLabel(row.day)
    if (day >= last30) entry.last += row.unitsSold
    else if (day >= prev30) entry.previous += row.unitsSold
    windows.set(row.productId, entry)
  }
  return [...windows.entries()]
    .filter(([, entry]) => entry.previous > 0 && entry.last / entry.previous >= 1.3)
    .map(([productId, entry]) => {
      const product = snapshot.products.find((item) => item.productId === productId)
      return { title: product?.title ?? productId, extraMonthly: Math.max(entry.last - entry.previous, 0) * (product?.unitPrice ?? 0) }
    })
    .sort((left, right) => right.extraMonthly - left.extraMonthly)
    .slice(0, 5)
}

function retentionHeadroom(snapshot: StoreSnapshot, analytics: AnalyticsSnapshot): Readonly<{ repeatRate: number; annualImpact: number }> | null {
  if (snapshot.customers.length < 5) return null
  const repeats = snapshot.customers.filter((customer) => customer.orderCount >= 2).length
  const repeatRate = repeats / snapshot.customers.length
  if (repeatRate >= 0.3) return null
  const target = 0.3
  const annualRevenue = Math.max(snapshot.last30dRevenue, 0) * 12
  const annualImpact = annualRevenue * (target - repeatRate)
  return { repeatRate, annualImpact }
}

function grossMarginRate(snapshot: StoreSnapshot): number {
  let revenue = 0
  let cost = 0
  for (const product of snapshot.products) {
    revenue += product.unitsSold120d * product.unitPrice
    cost += product.unitsSold120d * (product.unitCost ?? 0)
  }
  if (revenue <= 0) return 0
  return clamp(1 - cost / revenue, 0, 1)
}

function inventoryValueAtCost(snapshot: StoreSnapshot): number {
  return snapshot.products.reduce((sum, product) => sum + product.inventoryUnits * (product.unitCost ?? product.unitPrice), 0)
}

function aggregateDaysOfCover(snapshot: StoreSnapshot): number | null {
  const products = snapshot.products.filter((product) => product.inventoryUnits > 0)
  if (products.length === 0) return null
  const totalStock = products.reduce((sum, product) => sum + product.inventoryUnits, 0)
  const totalDaily = snapshot.products.reduce((sum, product) => sum + product.averageDailyUnits, 0)
  if (totalDaily <= 0) return null
  return totalStock / totalDaily
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(value !== null && Math.abs(value * 100) < 10 ? 1 : 0)}%`
}
function formatNum(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
}
function round2(value: number): number { return Math.round(value * 100) / 100 }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)) }
