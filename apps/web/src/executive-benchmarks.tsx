/**
 * PR #49 — Industry Benchmarks page.
 *
 * Merchant position vs curated public Shopify benchmark ladders: percentile
 * rank, median, top-10% target, gap to next tier, and honest "not
 * measurable" states. Metric visibility follows the plan allowance.
 */
import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Gauge, RefreshCw, Target } from 'lucide-react'
import type { BenchmarkMetricPosition, BenchmarkPosition } from './executive-model.js'
import { formatExecutiveMoney, formatExecutiveNumber } from './executive-model.js'
import { fetchBenchmarkPosition, refreshBenchmarks } from './executive-api.js'
import { ExecutiveBullet, ExecutivePercentileBar } from './executive-charts.js'
import { ExecutiveEmptyState, ExecutiveErrorState, ExecutiveLockedCard, ExecutivePageHeader, ExecutiveSection, ExecutiveSkeleton } from './executive-ui.js'
import { errorMessageFrom } from './executive-shared.js'
import type { ExecutivePageProps } from './executive-shared.js'

export const EXECUTIVE_CATEGORIES = ['Fashion & Apparel', 'Electronics', 'Home & Garden', 'Beauty & Health', 'Food & Beverages', 'Sports & Outdoor', 'Toys & Games', 'Books & Media', 'Jewelry & Accessories', 'Other'] as const

const METRIC_HINTS: Readonly<Record<string, string>> = {
  REVENUE: 'Grow repeat purchases and average order value together — revenue percentile moves with both.',
  AOV: 'Bundles, cross-sells, and minimum-order incentives lift average order value without new traffic.',
  CONVERSION: 'Tighten product pages, reviews, and checkout friction to convert existing traffic better.',
  REPEAT_PURCHASE: 'A post-purchase sequence plus a second-order incentive is the fastest repeat-rate lever.',
  CAC: 'Retention lowers blended acquisition cost: more orders from existing buyers amortise spend.',
  INVENTORY_TURNOVER: 'Clear slow movers and reorder only fast-turning SKUs to free working capital.',
  RETURN_RATE: 'Better sizing data and clearer product descriptions cut the most common return reasons.',
}

export function ExecutiveBenchmarksPage({ context, plan, gates, onToast, onUpgrade }: ExecutivePageProps) {
  const storeId = context.storeId
  const [position, setPosition] = useState<BenchmarkPosition | null>(null)
  const [category, setCategory] = useState<string>('Other')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = async (selectedCategory?: string) => {
    if (!storeId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const next = await fetchBenchmarkPosition(storeId, selectedCategory)
      setPosition(next)
      setCategory(next.category)
    } catch (err: unknown) { setError(errorMessageFrom(err)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [storeId])

  const refresh = async () => {
    if (!storeId) return
    setRefreshing(true)
    try {
      const result = await refreshBenchmarks(storeId)
      onToast(`Benchmarks refreshed — ${result.rows} public-source data points verified.`, 'success')
      await load(category)
    } catch (err: unknown) { onToast(errorMessageFrom(err), 'error') } finally { setRefreshing(false) }
  }

  const lockedCount = useMemo(() => {
    const total = position?.totalMetrics ?? 7
    const visible = position?.visibleMetrics ?? 0
    return Math.max(0, total - visible)
  }, [position])

  return (
    <div className="exec-page">
      <ExecutivePageHeader
        kicker="Industry intelligence"
        title="Industry Benchmarks"
        description="Your store's real metrics positioned against curated public Shopify benchmarks for your category. Missing values mean the metric is not measurable yet — never estimated."
        actions={<button type="button" className="button secondary" onClick={() => void refresh()} disabled={refreshing || !storeId}><RefreshCw size={14} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh data'}</button>}
      />
      <div className="exec-category-chips" role="tablist" aria-label="Benchmark category">
        {EXECUTIVE_CATEGORIES.map((entry) => (
          <button key={entry} type="button" role="tab" aria-selected={category === entry} className={`exec-category-chip ${category === entry ? 'active' : ''}`} onClick={() => void load(entry)}>{entry}</button>
        ))}
      </div>
      {loading && <ExecutiveSkeleton rows={5} label="Benchmark position" />}
      {error && !loading && <ExecutiveErrorState message={error} onRetry={() => void load()} />}
      {!loading && !error && position && (
        <>
          <ExecutiveSection kicker={`${position.category} · ${position.categorySource.toLowerCase()} · as of ${position.asOf.slice(0, 10)}`} title="Your position at a glance" className="span-12">
            <div className="exec-benchmark-grid">
              {position.positions.map((metric) => <BenchmarkMetricCard key={metric.metric} metric={metric} />)}
            </div>
            {lockedCount > 0 && (
              <div style={{ marginTop: 14 }}>
                <ExecutiveLockedCard title={`${lockedCount} more metrics available on a higher plan`} description="CAC, inventory turnover, return rate, and peer comparisons unlock as your plan grows." plan={plan} onUpgrade={onUpgrade} />
              </div>
            )}
          </ExecutiveSection>
          <ExecutiveSection kicker="Methodology" title="Where the benchmarks come from" className="span-12">
            <p className="exec-muted-note" style={{ margin: 0 }}>
              Phase 1 uses publicly available e-commerce benchmark literature (Littledata Shopify benchmarks, Shopify/Statista published commerce figures, industry return-rate studies) curated per category — {position.positions[0]?.sourceLabel ?? 'public sources'}. Phase 2 will layer in anonymized, GDPR-compliant aggregates once the ProfitPilot merchant base exceeds 100 with opt-in consent.
            </p>
          </ExecutiveSection>
        </>
      )}
      {!loading && !error && !position && (
        <ExecutiveEmptyState icon={BarChart3} title="No benchmark data yet" description="Connect a store with synced orders to measure your position against the industry." />
      )}
    </div>
  )
}

function BenchmarkMetricCard({ metric }: { metric: BenchmarkMetricPosition }) {
  const money = metric.currency !== null
  const fmt = (value: number | null): string => (value === null ? '—' : money ? formatExecutiveMoney(value, metric.currency, 0) : `${formatExecutiveNumber(value, 1)}${metric.metric === 'CONVERSION' || metric.metric === 'REPEAT_PURCHASE' || metric.metric === 'RETURN_RATE' ? '%' : metric.metric === 'INVENTORY_TURNOVER' ? '×' : ''}`)
  const hint = METRIC_HINTS[metric.metric] ?? 'Focus the metric that moves your largest revenue lever first.'
  return (
    <div className="exec-metric-card">
      <div className="exec-metric-card-head">
        <h3>{metric.label}</h3>
        {metric.percentile !== null && <span className="exec-pill gold"><i />Top {tierLabel(metric.percentile)}</span>}
      </div>
      <div className="exec-metric-value">{fmt(metric.yourValue)}{metric.yourValueMissing && <small>not measurable yet</small>}</div>
      <div className="exec-metric-rows">
        <span><span>Industry median</span><strong>{fmt(metric.industryMedian)}</strong></span>
        <span><span>Top 10% target</span><strong>{fmt(metric.top10Target)}</strong></span>
        {metric.gapToTop10Pct !== null && <span><span>Gap to top 10%</span><strong style={{ color: 'var(--exec-gold)' }}>+{metric.gapToTop10Pct}%</strong></span>}
      </div>
      {metric.percentile !== null && metric.top10Target !== null && metric.yourValue !== null && (
        <ExecutiveBullet actual={metric.yourValue} target={metric.top10Target} display={fmt(metric.yourValue)} targetDisplay={fmt(metric.top10Target)} />
      )}
      {metric.percentile !== null && <ExecutivePercentileBar percentile={metric.percentile} topLabel="Top 10%" medianLabel="Median" />}
      {!metric.yourValueMissing && <p className="exec-improve-tip"><Target size={11} style={{ verticalAlign: '-1px' }} /> {hint}</p>}
      {metric.yourValueMissing && <p className="exec-muted-note">Sync order and customer history to measure this metric.</p>}
    </div>
  )
}

function tierLabel(percentile: number): string {
  if (percentile >= 90) return '10%'
  if (percentile >= 75) return '25%'
  if (percentile >= 50) return '50%'
  if (percentile >= 25) return 'below median'
  return 'bottom quartile'
}

export { Gauge }
