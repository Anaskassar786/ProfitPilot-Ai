import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  GROWTHIQ_STRATEGIC_TIPS,
  GrowthIqActionsPanel,
  GrowthIqDigestSection,
  GrowthIqImpactSection,
  GrowthIqInsightsSidebar,
  GrowthIqMilestonesSection,
  GrowthIqPositionSection,
  GrowthIqTrajectorySection,
} from './growthiq-sections.js'
import { growthMilestones, impactPreviews, projectTrajectory, strategicPosition, weeklyDigest } from './growthiq-strategic.js'
import type { BenchmarkPosition } from './executive-model.js'
import { AppProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json' with { type: 'json' }

/** main.tsx wraps every page in Polaris AppProvider (i18n) — mirror it here so
 *  components using the Polaris Button shim render outside an app shell. */
function renderWithAppProvider(element: import('react').ReactElement) {
  return renderToStaticMarkup(createElement(AppProvider, { i18n: enTranslations as never }, element))
}


const realSeries = (n: number, base: number) =>
  Array.from({ length: n }, (_, index) => ({ day: new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10), value: base + (index % 5) * 8 + index * 2 }))

const positionWithBenchmarks: BenchmarkPosition = {
  storeId: 's',
  category: 'Fashion & Apparel',
  categorySource: 'AUTO_DETECTED',
  visibleMetrics: 7,
  totalMetrics: 7,
  asOf: '2026-08-01',
  positions: [
    { metric: 'REVENUE', label: 'Monthly revenue', yourValue: 2400, currency: 'USD', industryMedian: 5000, top10Target: 20000, percentile: 34, gapToTop10Pct: 88, sourceLabel: 'curated', yourValueMissing: false },
    { metric: 'AOV', label: 'Average order value', yourValue: 48, currency: 'USD', industryMedian: 62, top10Target: 95, percentile: 29, gapToTop10Pct: 49, sourceLabel: 'curated', yourValueMissing: false },
    { metric: 'REPEAT_PURCHASE', label: 'Repeat purchase rate', yourValue: 14, currency: null, industryMedian: 27, top10Target: 40, percentile: 22, gapToTop10Pct: 48, sourceLabel: 'curated', yourValueMissing: false },
  ],
}

describe('GrowthIqTrajectorySection', () => {
  it('renders real history plus the measured projection', () => {
    const projection = projectTrajectory(realSeries(24, 120))!
    const html = renderWithAppProvider(<GrowthIqTrajectorySection projection={projection} currency="USD" daysSynced={24} onNavigateReports={() => undefined} />)
    expect(html).toContain('Your business trajectory')
    expect(html).toContain('gq-slope') // slope / projection-cone chart
    expect(html).toContain('current monthly run-rate')
    expect(html).toContain('projected next 30 days')
    expect(html).toContain('projection confidence · 24 real days')
    expect(html).toContain('Explore trajectory details')
    expect(html).toMatch(/trajectory/)
  })

  it('degrades to honest education with a single synced day', () => {
    const html = renderWithAppProvider(<GrowthIqTrajectorySection projection={null} currency="USD" daysSynced={1} onNavigateReports={() => undefined} />)
    expect(html).toContain('1 of 2 needed')
    expect(html).not.toContain('monthly run-rate')
  })
})

describe('GrowthIqPositionSection', () => {
  it('plots the quadrant from measured momentum and percentile', () => {
    const position = strategicPosition({ revenuePercentile: 34, growthRatePct: 9.5 })
    const html = renderWithAppProvider(<GrowthIqPositionSection position={position} nextMilestone="25 customers" onNavigateBenchmarks={() => undefined} />)
    expect(html).toContain('gq-matrix')
    expect(html).toContain('Early growth')
    expect(html).toContain('25 customers')
    expect(html).toContain('View strategic benchmarks')
  })

  it('explains precisely why the position cannot plot yet', () => {
    const position = strategicPosition({ revenuePercentile: null, growthRatePct: 9.5 })
    const html = renderWithAppProvider(<GrowthIqPositionSection position={position} nextMilestone={null} onNavigateBenchmarks={() => undefined} />)
    expect(html).toContain('revenue percentile')
    expect(html).not.toContain('gq-matrix-dot')
  })
})

describe('GrowthIqImpactSection', () => {
  it('prints computed impacts and honest nulls side by side', () => {
    const previews = impactPreviews({ position: positionWithBenchmarks, opportunities: [], orders30: 50, currency: 'USD', topProductSharePct: 52 })
    const html = renderWithAppProvider(<GrowthIqImpactSection previews={previews} onNavigate={() => undefined} />)
    expect(html).toContain('Revenue focus')
    expect(html).toContain('Customer focus')
    expect(html).toContain('Product focus')
    expect(html).toContain('Market expansion')
    expect(html).toContain('+$700/mo') // (62 − 48) × 50
    expect(html).toContain('+13 pts retention') // 27 − 14
    expect(html).toContain('52% on one product')
    expect(html).toContain('Not measurable yet') // market — no opportunity on file
  })
})

describe('GrowthIqMilestonesSection', () => {
  it('shows completes, the active milestone with progress, and locked horizon', () => {
    const result = growthMilestones({ syncedOrders: 7, customers: 5, daysSynced: 14, syncedRevenue: 300, decisionsLogged: 0, hasReport: false, hasDiagnosis: false, currency: 'USD' })
    const html = renderWithAppProvider(<GrowthIqMilestonesSection result={result} onNavigateRoadmaps={() => undefined} />)
    expect(html).toContain('Your growth milestones')
    expect(html).toContain('First sale')
    expect(html).toContain('10 synced orders')
    expect(html).toContain('7 / 10')
    expect(html).toContain('gq-milestone-track')
    expect(html).toContain('weeks at your current pace')
    expect(html).toContain('View roadmap')
  })

  it('celebrates honestly when every milestone is reached', () => {
    const result = growthMilestones({ syncedOrders: 400, customers: 220, daysSynced: 95, syncedRevenue: 40000, decisionsLogged: 3, hasReport: true, hasDiagnosis: true, currency: 'USD' })
    const html = renderWithAppProvider(<GrowthIqMilestonesSection result={result} onNavigateRoadmaps={() => undefined} />)
    expect(html).toContain('Every listed milestone reached')
  })
})

describe('GrowthIqDigestSection', () => {
  const digestInput = {
    revenueSeries: [...Array(7).fill(100), ...Array(7).fill(140)].map((value, index) => ({ day: new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10), value })),
    ordersSeries: [...Array(7).fill(3), ...Array(7).fill(4)].map((value, index) => ({ day: new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10), value })),
    topProducts: [{ title: 'Hero SKU', revenue: 640, sharePct: 31 }],
    opportunities: [],
    risks: [],
    repeatRatePct: null,
    repeatMedianPct: null,
  }

  it('renders the board-style snapshot from real weekly data', () => {
    const digest = weeklyDigest(digestInput)!
    const html = renderWithAppProvider(<GrowthIqDigestSection digest={digest} daysSynced={14} currency="USD" plan="growth" canReadReports onNavigateReports={() => undefined} onUpgrade={() => undefined} />)
    expect(html).toContain("This week&#x27;s executive digest")
    expect(html).toContain('$980') // 7 × 140
    expect(html).toContain('+40.0%')
    expect(html).toContain('Hero SKU')
    expect(html).toContain('Scale what is working')
    expect(html).toContain('Read full report')
    expect(html).not.toContain('Upgrade Plan')
  })

  it('gates the full report with an Upgrade Plan CTA — never a plan name', () => {
    const digest = weeklyDigest(digestInput)!
    const html = renderWithAppProvider(<GrowthIqDigestSection digest={digest} daysSynced={14} currency="USD" plan="trial" canReadReports={false} onNavigateReports={() => undefined} onUpgrade={() => undefined} />)
    expect(html).toContain('Upgrade Plan')
    expect(html).not.toContain('Upgrade to')
    expect(html).not.toContain('Read full report')
  })

  it('reports the real sync count when the digest has not unlocked', () => {
    const html = renderWithAppProvider(<GrowthIqDigestSection digest={null} daysSynced={3} currency="USD" plan="trial" canReadReports={false} onNavigateReports={() => undefined} onUpgrade={() => undefined} />)
    expect(html).toContain('3 of 7 synced')
    expect(html).toContain('Nothing is back-filled or simulated')
  })
})

describe('GrowthIqInsightsSidebar', () => {
  it('renders quick stats, real metrics, and an editorial tip', () => {
    const html = renderWithAppProvider(
      <GrowthIqInsightsSidebar
        metrics={{
          daysSynced: 12,
          stage: 'Early growth',
          healthLabel: 'At risk',
          nextFocus: 'Retention & repeat purchase',
          revenueGrowthPct: 8.4,
          repeat: { yours: 14, median: 27 },
          aov: { value: 52, deltaPct: 3.1 },
        }}
        currency="USD"
        tipIndex={1}
        onNavigateReports={() => undefined}
      />,
    )
    expect(html).toContain('Executive insights')
    expect(html).toContain('12 days')
    expect(html).toContain('Early growth')
    expect(html).toContain('At risk')
    expect(html).toContain('8.4%')
    expect(html).toContain('14.0%')
    expect(html).toContain('$52')
    expect(html).toContain(GROWTHIQ_STRATEGIC_TIPS[1]!)
  })

  it('says not measurable instead of fabricating metrics', () => {
    const html = renderWithAppProvider(
      <GrowthIqInsightsSidebar
        metrics={{ daysSynced: 0, stage: 'Foundation', healthLabel: null, nextFocus: null, revenueGrowthPct: null, repeat: null, aov: null }}
        currency="USD"
        onNavigateReports={() => undefined}
      />,
    )
    expect(html).toContain('Not diagnosed yet')
    expect(html).toContain('Needs a prior 30-day window')
    expect(html).toContain('Not measurable yet')
    expect(html).toContain('Needs 30 days of orders')
    expect(html).toContain('0 days')
  })
})

describe('GrowthIqActionsPanel', () => {
  it('renders all four executive actions', () => {
    const html = renderWithAppProvider(<GrowthIqActionsPanel onNavigate={() => undefined} />)
    expect(html).toContain('Executive actions')
    expect(html).toContain('Log a decision')
    expect(html).toContain('View a report')
    expect(html).toContain('Set a goal')
    expect(html).toContain('Find an insight')
    expect((html.match(/gq-action-card/g) ?? []).length).toBe(4)
  })
})
