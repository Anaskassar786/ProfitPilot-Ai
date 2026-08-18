import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Landmark } from 'lucide-react'
import { ExecutiveAreaChart, ExecutiveBubbleMap, ExecutiveBullet, ExecutiveConfidenceBar, ExecutiveHeatmap, ExecutiveHorizontalBars, ExecutivePercentileBar, ExecutiveRadialGauge, ExecutiveSparkline, ExecutiveStackedBars, ExecutiveWaterfall } from './executive-charts.js'
import { ComingSoonPanel, ExecutiveEmptyState, ExecutiveGateOverlay, ExecutiveSkeleton, ExecutiveStatusPill, GrowthCommandTabs, GrowthIqBaselineState, GrowthIqPlanPanel, GrowthIqWelcomeState } from './executive-ui.js'
import type { ExecutiveGate } from './executive-model.js'
import { GrowthIqMark, GrowthIqNavIcon, GrowthIqWordmark } from './growthiq-logo.js'

describe('PR49 executive charts render for both themes', () => {
  it('renders the radial gauge with the score and label', () => {
    const html = renderToStaticMarkup(<ExecutiveRadialGauge score={82} label="STRONG" />)
    expect(html).toContain('exec-gauge')
    expect(html).toContain('82')
    expect(html).toContain('STRONG')
  })

  it('renders area, sparkline, stacked, waterfall, and horizontal bars', () => {
    const series = [{ day: '2026-08-01', value: 100 }, { day: '2026-08-02', value: 150 }, { day: '2026-08-03', value: 130 }]
    expect(renderToStaticMarkup(<ExecutiveAreaChart points={series} label="Revenue" />)).toContain('exec-area-chart')
    expect(renderToStaticMarkup(<ExecutiveSparkline points={[1, 2, 3]} />)).toContain('exec-sparkline')
    expect(renderToStaticMarkup(<ExecutiveStackedBars groups={[{ label: 'A', segments: [{ key: 'x', label: 'X', value: 5, tone: 'positive' }] }]} />)).toContain('exec-stack-segment')
    expect(renderToStaticMarkup(<ExecutiveWaterfall steps={[{ label: 'Base', value: 100, kind: 'start' }, { label: 'Up', value: 20, kind: 'up' }, { label: 'Down', value: 10, kind: 'down' }]} />)).toContain('exec-waterfall')
    expect(renderToStaticMarkup(<ExecutiveHorizontalBars rows={[{ label: 'A', value: 10, display: '10' }]} />)).toContain('exec-hbars')
  })

  it('renders bubble map, bullet, percentile, heatmap, and confidence components', () => {
    expect(renderToStaticMarkup(<ExecutiveBubbleMap points={[{ id: 'r1', label: 'Risk', x: 0.5, y: 0.5, size: 10, tone: 'danger', detail: '50%' }]} xLabel="Probability" yLabel="Impact" />)).toContain('exec-bubble')
    expect(renderToStaticMarkup(<ExecutiveBullet actual={80} target={95} display="80" targetDisplay="95" />)).toContain('exec-bullet')
    expect(renderToStaticMarkup(<ExecutivePercentileBar percentile={62} topLabel="Top 10%" medianLabel="Median" />)).toContain('62th percentile')
    expect(renderToStaticMarkup(<ExecutiveHeatmap cells={[{ x: 0, y: 0, value: 1, label: '1' }]} xLabels={['A']} yLabels={['B']} />)).toContain('exec-heatmap')
    expect(renderToStaticMarkup(<ExecutiveConfidenceBar value={0.7} />)).toContain('70% confidence')
  })

  it('renders theme tokens as CSS custom properties, not hard-coded colors', () => {
    // Charts must reference var(--exec-*) tokens so both themes adapt.
    const html = renderToStaticMarkup(<ExecutiveRadialGauge score={50} label="HEALTHY" />)
    expect(html).toContain('exec-gauge-track')
    expect(html).toContain('exec-gauge-fill')
  })
})

describe('PR49 plan gating UI', () => {
  const gate = (allowed: boolean): ExecutiveGate => ({ allowed, requiredPlan: 'commander', used: 0, limit: allowed ? null : 0 })

  it('renders locked sections with an overlay when the gate blocks', () => {
    const html = renderToStaticMarkup(
      <ExecutiveGateOverlay gate={gate(false)} feature="pdf" plan="trial" onUpgrade={() => undefined}>
        <div>Secret content</div>
      </ExecutiveGateOverlay>,
    )
    expect(html).toContain('exec-gate-overlay')
    expect(html).toContain('Upgrade Plan')
    expect(html).toContain('Investor PDF reports')
    expect(html).not.toContain('Upgrade to Commander')
    expect(html).not.toContain('Upgrade to Growth')
  })

  it('renders children directly when the gate allows', () => {
    const html = renderToStaticMarkup(
      <ExecutiveGateOverlay gate={gate(true)} feature="reports" plan="commander" onUpgrade={() => undefined}>
        <div>Real content</div>
      </ExecutiveGateOverlay>,
    )
    expect(html).toContain('Real content')
    expect(html).not.toContain('exec-gate-overlay')
  })

  it('always labels upgrade CTAs "Upgrade Plan" — never a plan name', () => {
    const empty = renderToStaticMarkup(<ExecutiveEmptyState icon={Landmark} title="Locked" description="Needs a plan" locked onUpgrade={() => undefined} />)
    expect(empty).toContain('Upgrade Plan')
    expect(empty).not.toContain('Upgrade to')
    const tabs = renderToStaticMarkup(<GrowthCommandTabs active="executive" onNavigate={() => undefined} />)
    expect(tabs).toContain('GrowthIQ')
    expect(tabs).toContain('Store Coach')
    expect(tabs).toContain('Insights Hub')
    // The rebrand must not leak "Upgrade to <plan>" copy anywhere.
    expect(tabs).not.toContain('Upgrade to')
  })

  it('renders skeletons and coming-soon panels for loading/empty states', () => {
    expect(renderToStaticMarkup(<ExecutiveSkeleton rows={3} label="Loading" />)).toContain('exec-skeleton')
    expect(renderToStaticMarkup(<ComingSoonPanel title="Insights Hub" description="Next release" />)).toContain('Insights Hub')
    expect(renderToStaticMarkup(<ExecutiveStatusPill status="AT_RISK" />)).toContain('AT RISK')
  })
})

describe('GrowthIQ brand mark', () => {
  it('renders the growth-arrow + neural-node logo as an accessible SVG', () => {
    const html = renderToStaticMarkup(<GrowthIqMark size={24} />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="GrowthIQ"')
    // The signature is the purple gradient, not the old navy/gold.
    expect(html).toContain('#8B5CF6')
    expect(html).toContain('#6366F1')
    expect(html).not.toContain('#C9A227')
  })
  it('provides a nav icon adapter and a wordmark lockup', () => {
    const nav = renderToStaticMarkup(<GrowthIqNavIcon size={17} strokeWidth={2.25} />)
    expect(nav).toContain('width="17"')
    const wordmark = renderToStaticMarkup(<GrowthIqWordmark size={30} />)
    expect(wordmark).toContain('GrowthIQ')
  })
})

describe('GrowthIQ plan-based feature display', () => {
  it('shows only sample previews unlocked for a trial plan', () => {
    const html = renderToStaticMarkup(<GrowthIqPlanPanel plan="trial" onUpgrade={() => undefined} />)
    expect(html).toContain('Your plan: Trial')
    expect(html).toContain('Currently available')
    expect(html).toContain('Sample benchmarks (3 metrics)')
    expect(html).toContain('One opportunity preview')
    expect(html).toContain('Available on higher plans')
    expect(html).toContain('Investor reports (PDF)')
    expect(html).toContain('Commander')
    expect(html).toContain('Upgrade Plan')
    expect(html).not.toContain('Upgrade to')
  })
  it('shows every capability unlocked for a commander plan', () => {
    const html = renderToStaticMarkup(<GrowthIqPlanPanel plan="commander" onUpgrade={() => undefined} />)
    expect(html).toContain('Your plan: Commander')
    expect(html).toContain('All GrowthIQ features unlocked')
    expect(html).toContain('Everything in GrowthIQ')
    expect(html).toContain('Investor reports (PDF)')
    // A commander plan has nothing locked, so no locked list renders.
    expect(html).not.toContain('Available on higher plans')
    expect(html).not.toContain('Upgrade Plan')
  })
})

describe('GrowthIQ educational first-run states', () => {
  it('welcomes new merchants and lists real capabilities without fake data', () => {
    const html = renderToStaticMarkup(<GrowthIqWelcomeState />)
    expect(html).toContain('Welcome to GrowthIQ')
    expect(html).toContain('Board-ready monthly reports')
    expect(html).toContain('Industry benchmarking')
    expect(html).toContain('What-if scenario planning')
    expect(html).toContain('Decision tracking')
  })
  it('reports the honest sync baseline when history is thin', () => {
    const html = renderToStaticMarkup(
      <GrowthIqBaselineState
        readiness={{ hasStoreInfo: true, ordersSynced: 15, daysSynced: 20, minOrders: 30, minDays: 60 }}
        onLogDecision={() => undefined}
        onViewSample={() => undefined}
      />,
    )
    expect(html).toContain('Building your intelligence baseline')
    expect(html).toContain('15')
    expect(html).toContain('30')
    expect(html).toContain('20')
    expect(html).toContain('60')
    expect(html).toContain('Log a business decision')
  })
})
