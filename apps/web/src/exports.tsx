/**
 * Data Exports — "Download your real store data anytime."
 *
 * A merchant-facing download centre: four named exports (Orders, Product
 * Catalog, Activity Log, Revenue Report), a plan banner with the real monthly
 * allowance, per-card row estimates and last-exported dates, and a history of
 * everything already downloaded.
 *
 * Contract kept by this module:
 *   · every number comes from `/exports/overview` — nothing is invented,
 *   · locked cards preview their value and always say "Upgrade Plan",
 *   · both themes are first-class (scoped `--dx-*` tokens, `.light-mode`),
 *   · no developer jargon reaches the merchant.
 */

import { Button } from './polaris-ui.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  FileSpreadsheet,
  FileText,
  Gem,
  Info,
  Loader2,
  Lock,
  Package,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Wallet,
} from './icons.js'
import type { LucideIcon } from './icons.js'
import type { ExportDataset, PlanTier } from '@profitpilot/types'
import { ApiClientError, fetchExportsOverview, generateExport } from './api.js'
import type { WorkspaceContext } from './model.js'
import { UpgradePlanButton } from './UpgradePlanButton.js'
import {
  EXPORTS_UPGRADE_CTA,
  EXPORT_ROW_LIMIT_NOTE,
  datasetName,
  datasetTone,
  downloadButtonLabel,
  formatBytes,
  formatCount,
  formatTimestamp,
  lastExportedLabel,
  lockedMessage,
  planLabel,
  rowEstimateLabel,
  successMessage,
  triggerDownload,
  usageHint,
  usageLabel,
  usagePercent,
} from './exports-model.js'
import type { ExportCard, ExportHistoryEntry, ExportsOverview } from './exports-model.js'

const DATASET_ICONS: Readonly<Record<ExportDataset, LucideIcon>> = {
  orders: ShoppingBag,
  catalog: Package,
  audit: ClipboardList,
  revenue: Wallet,
}

const FORMAT_ICONS: Readonly<Record<string, LucideIcon>> = {
  CSV: FileText,
  XLSX: FileSpreadsheet,
  PDF: FileText,
}

type Toast = (message: string, kind?: 'success' | 'info' | 'warning' | 'error') => void

export function ExportsWorkspace({
  context,
  onToast,
  onNavigateBilling,
}: {
  context: WorkspaceContext
  onToast: Toast
  onNavigateBilling: () => void
}) {
  const [overview, setOverview] = useState<ExportsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<ExportDataset | null>(null)
  const [confirmed, setConfirmed] = useState<ExportDataset | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const storeId = context.storeId

  const load = useCallback(async (): Promise<void> => {
    if (!storeId) { setLoading(false); setOverview(null); return }
    setLoading(true)
    setError(null)
    try {
      setOverview(await fetchExportsOverview(storeId))
    } catch (caught: unknown) {
      setError(caught instanceof ApiClientError ? caught.message : 'We could not load your exports right now.')
    } finally {
      setLoading(false)
    }
  }, [storeId])

  useEffect(() => { void load() }, [load])
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }, [])

  const download = useCallback(async (card: ExportCard): Promise<void> => {
    if (!storeId) { onToast('Connect your Shopify store before exporting.', 'info'); return }
    if (card.locked) { onNavigateBilling(); return }
    setBusy(card.id)
    try {
      const result = await generateExport(storeId, card.id)
      const delivered = triggerDownload(result)
      if (!delivered) { onToast('Your browser blocked the download. Allow downloads for this page and try again.', 'warning'); return }
      onToast(successMessage(result), 'success')
      setConfirmed(card.id)
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      confirmTimer.current = setTimeout(() => setConfirmed(null), 6_000)
      await load()
    } catch (caught: unknown) {
      const apiError = caught instanceof ApiClientError ? caught : null
      // A plan block is explained in place and the banner is refreshed to show
      // the real state. The merchant keeps their place on the page and decides
      // whether to upgrade — we never yank them to Billing mid-task.
      if (apiError?.status === 402) { onToast(apiError.message, 'warning'); await load(); return }
      onToast(apiError?.message ?? 'That export could not be prepared. Please try again.', apiError?.status === 404 ? 'info' : 'error')
    } finally {
      setBusy(null)
    }
  }, [storeId, onToast, onNavigateBilling, load])

  const cards = overview?.exports ?? []
  const lockedCount = useMemo(() => cards.filter((card) => card.locked).length, [cards])

  if (!storeId) return <div className="dx-root"><ConnectStore /></div>

  return (
    <div className="dx-root">
      {loading && !overview ? <ExportsSkeleton /> : null}
      {error && !overview ? <ExportsError message={error} onRetry={() => void load()} /> : null}
      {overview ? (
        <>
          <PlanBanner overview={overview} lockedCount={lockedCount} onUpgrade={onNavigateBilling} onRefresh={() => void load()} refreshing={loading} />
          <section className="dx-section" aria-labelledby="dx-choose">
            <header className="dx-section-head">
              <div>
                <span className="dx-eyebrow"><Download size={13} /> Choose your export</span>
                <h2 id="dx-choose">Select what you&rsquo;d like to download</h2>
              </div>
            </header>
            <div className="dx-grid">
              {cards.map((card) => (
                <ExportCardView
                  key={card.id}
                  card={card}
                  plan={overview.plan}
                  busy={busy === card.id}
                  confirmed={confirmed === card.id}
                  onDownload={() => void download(card)}
                  onUpgrade={onNavigateBilling}
                />
              ))}
            </div>
            <p className="dx-note"><Info size={13} /> {EXPORT_ROW_LIMIT_NOTE}</p>
          </section>
          <ExportHistorySection history={overview.history} />
        </>
      ) : null}
    </div>
  )
}

/* ── Plan banner ────────────────────────────────────────────────────────── */

export function PlanBanner({
  overview,
  lockedCount,
  onUpgrade,
  onRefresh,
  refreshing,
}: {
  overview: ExportsOverview
  lockedCount: number
  onUpgrade: () => void
  onRefresh: () => void
  refreshing: boolean
}) {
  const { usage, plan } = overview
  const percent = usagePercent(usage)
  return (
    <section className={`dx-plan ${usage.limitReached ? 'is-maxed' : ''}`} aria-label="Your plan and export allowance">
      <div className="dx-plan-main">
        <span className="dx-plan-icon"><Gem size={18} /></span>
        <div className="dx-plan-copy">
          <span className="dx-eyebrow">Your plan</span>
          <h3>{planLabel(plan)}</h3>
          <p>{usageHint(usage)}</p>
        </div>
      </div>
      <div className="dx-plan-meter">
        <div className="dx-plan-meter-top">
          <strong>{usageLabel(usage)}</strong>
          {usage.unlimited ? <span className="dx-chip green"><Sparkles size={11} /> Unlimited</span> : null}
        </div>
        <div className="dx-track" role="img" aria-label={usageLabel(usage)}>
          <span style={{ width: `${usage.unlimited ? 100 : percent}%` }} className={usage.unlimited ? 'unlimited' : usage.limitReached ? 'maxed' : ''} />
        </div>
        {lockedCount > 0 ? <small className="dx-plan-locked">{lockedCount} more export{lockedCount === 1 ? '' : 's'} unlock on a higher plan</small> : null}
      </div>
      <div className="dx-plan-actions">
        <Button type="button" className="dx-ghost-button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh exports">
          <RefreshCw size={14} className={refreshing ? 'dx-spin' : ''} /> Refresh
        </Button>
        <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} />
      </div>
    </section>
  )
}

/* ── Export card ────────────────────────────────────────────────────────── */

export function ExportCardView({
  card,
  plan,
  busy,
  confirmed,
  onDownload,
  onUpgrade,
}: {
  card: ExportCard
  plan: PlanTier
  busy: boolean
  confirmed: boolean
  onDownload: () => void
  onUpgrade: () => void
}) {
  const Icon = DATASET_ICONS[card.id]
  const FormatIcon = FORMAT_ICONS[card.format] ?? FileText
  const tone = datasetTone(card.id)
  const disabled = busy || (!card.locked && !card.hasData)
  return (
    <article className={`dx-card tone-${tone} ${card.locked ? 'is-locked' : ''}`} data-dataset={card.id}>
      <div className="dx-card-top">
        <span className="dx-card-icon"><Icon size={20} /></span>
        <span className="dx-format" title={`${card.format} file`}><FormatIcon size={11} /> {card.format}</span>
      </div>
      <h3>{card.name}</h3>
      <p className="dx-card-description">{card.description}</p>

      {card.locked ? (
        <div className="dx-locked-body">
          <span className="dx-locked-badge"><Lock size={12} /> {lockedMessage(card.requiredPlan ?? card.minimumPlan)}</span>
          <span className="dx-locked-title">What you&rsquo;ll get</span>
          <ul className="dx-locked-list">
            {card.includes.map((item) => <li key={item}><CheckCircle2 size={12} /> {item}</li>)}
          </ul>
        </div>
      ) : (
        <>
          <dl className="dx-facts">
            <div>
              <dt><ClipboardList size={12} /> Estimated rows</dt>
              <dd>{rowEstimateLabel(card.estimatedRows)}</dd>
            </div>
            <div>
              <dt><CalendarDays size={12} /> Last exported</dt>
              <dd>{lastExportedLabel(card.lastExportedAt)}</dd>
            </div>
          </dl>
          <p className="dx-includes"><Info size={12} /> Includes: {card.includes.join(', ').toLowerCase()}</p>
        </>
      )}

      <div className="dx-card-actions">
        {card.locked ? (
          <UpgradePlanButton plan={plan} onUpgrade={onUpgrade} className="dx-card-upgrade" />
        ) : (
          <Button type="button" className="dx-download" onClick={onDownload} disabled={disabled} aria-busy={busy}>
            {busy ? <Loader2 size={15} className="dx-spin" /> : <Download size={15} />}
            {downloadButtonLabel(card, busy)}
          </Button>
        )}
      </div>
      {confirmed ? <p className="dx-confirm" role="status"><CheckCircle2 size={13} /> Downloaded — check your browser downloads.</p> : null}
      {!card.locked && !card.hasData ? <p className="dx-empty-hint">{card.source} Sync your store to fill this export.</p> : null}
    </article>
  )
}

/* ── Export history ─────────────────────────────────────────────────────── */

export function ExportHistorySection({ history }: { history: readonly ExportHistoryEntry[] }) {
  return (
    <section className="dx-section" aria-labelledby="dx-history">
      <header className="dx-section-head">
        <div>
          <span className="dx-eyebrow"><Clock3 size={13} /> Export history</span>
          <h2 id="dx-history">Recent downloads</h2>
        </div>
      </header>
      {history.length === 0 ? (
        <div className="dx-history-empty">
          <span className="dx-history-empty-icon"><Download size={20} /></span>
          <strong>No previous exports yet</strong>
          <p>Download your first export above and it will appear here with its date, row count, and file size.</p>
        </div>
      ) : (
        <ul className="dx-history-list">
          {history.map((entry) => {
            const Icon = DATASET_ICONS[entry.dataset]
            return (
              <li key={entry.id} className={`dx-history-row tone-${datasetTone(entry.dataset)}`}>
                <span className="dx-history-icon"><Icon size={16} /></span>
                <div className="dx-history-copy">
                  <strong>{datasetName(entry.dataset)}</strong>
                  <small>Downloaded: {formatTimestamp(entry.createdAt)}</small>
                </div>
                <div className="dx-history-meta">
                  <span className="dx-format small">{entry.format}</span>
                  <span>{formatCount(entry.rowCount)} rows</span>
                  <span className="dx-dot" aria-hidden="true">·</span>
                  <span>{formatBytes(entry.byteSize)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ── Supporting states ──────────────────────────────────────────────────── */

export function ConnectStore() {
  return (
    <div className="dx-state">
      <span className="dx-state-icon"><Download size={22} /></span>
      <strong>Connect your Shopify store to export data</strong>
      <p>Once your store is connected, your orders, products, activity, and revenue become available to download here.</p>
    </div>
  )
}

export function ExportsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="dx-state error">
      <span className="dx-state-icon"><AlertCircle size={22} /></span>
      <strong>We could not load your exports</strong>
      <p>{message}</p>
      <Button type="button" className="dx-ghost-button" onClick={onRetry}><RefreshCw size={14} /> Try again</Button>
    </div>
  )
}

export function ExportsSkeleton() {
  return (
    <div className="dx-skeleton" aria-hidden="true">
      <span className="dx-skeleton-banner" />
      <div className="dx-skeleton-grid">{[0, 1, 2, 3].map((index) => <span key={index} className="dx-skeleton-card" />)}</div>
    </div>
  )
}

/** Small helper kept exported so the page header can reuse the upgrade copy. */
export function ExportsUpgradeHint({ children }: { children?: ReactNode }) {
  return <span className="dx-upgrade-hint"><ArrowUpRight size={12} /> {children ?? EXPORTS_UPGRADE_CTA}</span>
}
