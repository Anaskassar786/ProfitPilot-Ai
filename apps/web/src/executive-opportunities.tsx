/**
 * PR #49 — Strategic Opportunities page.
 *
 * Opportunity cards color-coded by category with real impact math,
 * confidence bars, effort/timeline indicators, status lifecycle, and the
 * regenerate flow. Trial gets one preview slot; higher plans track more.
 */
import { useEffect, useMemo, useState } from 'react'
import { Lightbulb, RefreshCw, Sparkles } from 'lucide-react'
import type { ExecutiveOpportunity, OpportunityCategory, OpportunityStatus } from './executive-model.js'
import { executiveTimelineLabel, formatExecutiveMoney } from './executive-model.js'
import { fetchExecutiveOpportunities, generateExecutiveOpportunities, updateExecutiveOpportunityStatus } from './executive-api.js'
import { ExecutiveConfidenceBar } from './executive-charts.js'
import { ExecutiveEmptyState, ExecutiveErrorState, ExecutivePageHeader, ExecutiveSection, ExecutiveSkeleton, ExecutiveStatusPill } from './executive-ui.js'
import { errorMessageFrom, isUpgradeError } from './executive-shared.js'
import type { ExecutivePageProps } from './executive-shared.js'

const CATEGORY_ICONS: Readonly<Record<OpportunityCategory, string>> = {
  MARKET_GAP: 'Market gap',
  EXPANSION: 'Expansion',
  SEASONAL: 'Seasonal',
  CROSS_SELL: 'Cross-sell',
  PRICING: 'Pricing',
  PRODUCT: 'Product',
}

const STATUSES: readonly OpportunityStatus[] = ['NEW', 'REVIEWING', 'PURSUING', 'DISMISSED', 'COMPLETED']

export function ExecutiveOpportunitiesPage({ context, plan, gates, onToast, onUpgrade }: ExecutivePageProps) {
  const storeId = context.storeId
  const [opportunities, setOpportunities] = useState<readonly ExecutiveOpportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [filter, setFilter] = useState<OpportunityStatus | 'ALL'>('ALL')

  const load = async () => {
    if (!storeId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try { setOpportunities(await fetchExecutiveOpportunities(storeId)) } catch (err: unknown) { setError(errorMessageFrom(err)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [storeId])

  const generate = async () => {
    if (!storeId) return
    setGenerating(true)
    try {
      const result = await generateExecutiveOpportunities(storeId)
      setOpportunities(result.opportunities)
      onToast(result.generated > 0 ? `Identified ${result.generated} strategic opportunities from your real data.` : 'Analysis ran — not enough synced history to identify opportunities yet. Sync more orders and products.', result.generated > 0 ? 'success' : 'info')
    } catch (err: unknown) {
      if (isUpgradeError(err)) { onToast(`${errorMessageFrom(err)} — Upgrade Plan to track more opportunities.`, 'error'); onUpgrade() } else { onToast(errorMessageFrom(err), 'error') }
    } finally { setGenerating(false) }
  }

  const changeStatus = async (opportunity: ExecutiveOpportunity, status: OpportunityStatus) => {
    if (!storeId) return
    try {
      const updated = await updateExecutiveOpportunityStatus(storeId, opportunity.id, status)
      setOpportunities((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)))
      onToast(`Opportunity marked ${status.toLowerCase()}.`, 'success')
    } catch (err: unknown) { onToast(errorMessageFrom(err), 'error') }
  }

  const filtered = useMemo(() => (filter === 'ALL' ? opportunities : opportunities.filter((opportunity) => opportunity.status === filter)), [opportunities, filter])

  return (
    <div className="exec-page">
      <ExecutivePageHeader
        kicker="Growth identification"
        title="Strategic Opportunities"
        description="Opportunities detected from your catalog, sales velocity, margins, co-purchase patterns, and customer base — each with a computed annual impact estimate."
        actions={<button type="button" className="button primary" onClick={() => void generate()} disabled={generating || !storeId}><Sparkles size={14} /> {generating ? 'Analyzing your business…' : 'Analyze Opportunities'}</button>}
      />
      {loading && <ExecutiveSkeleton rows={4} label="Opportunities" />}
      {error && !loading && <ExecutiveErrorState message={error} onRetry={() => void load()} />}
      {!loading && !error && (
        <>
          <div className="exec-category-chips" role="tablist" aria-label="Opportunity status filter">
            {(['ALL', ...STATUSES] as const).map((status) => (
              <button key={status} type="button" className={`exec-category-chip ${filter === status ? 'active' : ''}`} onClick={() => setFilter(status)}>{status === 'ALL' ? 'All' : status.toLowerCase()}</button>
            ))}
          </div>
          {opportunities.length === 0 ? (
            <ExecutiveEmptyState
              icon={Lightbulb}
              title="Analyzing your business for opportunities…"
              description="Run analysis once products and orders are synced. Each opportunity is computed from real history with an auditable impact estimate — this may take a few moments."
              action="Analyze Now"
              onAction={() => void generate()}
            />
          ) : (
            <>
              <div className="exec-opportunity-grid">
                {filtered.map((opportunity) => (
                  <article className="exec-opportunity-card" key={opportunity.id}>
                    <div className="exec-opportunity-top">
                      <div>
                        <span className="exec-opportunity-category"><Sparkles size={11} /> {CATEGORY_ICONS[opportunity.category]}</span>
                        <h3>{opportunity.title}</h3>
                      </div>
                      <ExecutiveStatusPill status={opportunity.status} />
                    </div>
                    <p>{opportunity.description}</p>
                    <div className="exec-opportunity-impact">
                      {formatExecutiveMoney(opportunity.estimatedImpactAnnual, opportunity.impactCurrency, 0)}
                      <small>estimated annual impact</small>
                    </div>
                    <ExecutiveConfidenceBar value={opportunity.confidence} />
                    <div className="exec-opportunity-meta">
                      <ExecutiveStatusPill status={opportunity.effortLevel === 'LOW' ? 'LOW effort' : opportunity.effortLevel === 'MEDIUM' ? 'MEDIUM effort' : 'HIGH effort'} tone={opportunity.effortLevel === 'LOW' ? 'positive' : opportunity.effortLevel === 'MEDIUM' ? 'warning' : 'danger'} />
                      <ExecutiveStatusPill status={executiveTimelineLabel(opportunity.timeline)} tone="neutral" />
                    </div>
                    {opportunity.actionPlan.length > 0 && (
                      <ol className="exec-assumptions" style={{ margin: '2px 0 0' }}>
                        {opportunity.actionPlan.map((step, index) => <li key={index}><strong style={{ color: 'var(--exec-heading)' }}>{step.step}</strong> — {step.detail}</li>)}
                      </ol>
                    )}
                    <div className="exec-opportunity-actions">
                      {STATUSES.filter((status) => status !== opportunity.status).map((status) => (
                        <button key={status} type="button" onClick={() => void changeStatus(opportunity, status)}>Mark {status.toLowerCase()}</button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              <div className="exec-assurance">
                <RefreshCw size={14} /> Tracked: {opportunities.filter((entry) => entry.status === 'NEW' || entry.status === 'REVIEWING' || entry.status === 'PURSUING').length} of {gates.opportunities?.limit ?? 'unlimited'} on your plan. Impact estimates are conservative models from your history — log them as decisions to measure accuracy.
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
