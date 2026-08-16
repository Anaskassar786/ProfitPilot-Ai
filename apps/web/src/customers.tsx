import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  History,
  Info,
  LockKeyhole,
  Mail,
  Package,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchCustomer, fetchCustomerInsights, fetchCustomers, queryCustomerInsights } from './api.js'
import type { WorkspaceContext } from './model.js'
import { PlanLockedFeature } from './orders.js'
import {
  customerAvatarColor,
  customerEmailLabel,
  customerMoney,
  initialsForCustomer,
  insightData,
  lockedCustomerInsight,
  primaryBehaviorLabel,
} from './customers-model.js'
import type {
  CustomerCoverage,
  CustomerDetail,
  CustomerInsightFeature,
  CustomerInsightsResult,
  CustomerQuery,
  CustomersPageResult,
  CustomerSegment,
  CustomerSegmentFilter as CustomerSegmentFilterValue,
  CustomerSummary,
} from './customers-model.js'

type ToastKind = 'success' | 'info' | 'warning' | 'error'
type CustomersPageProps = Readonly<{
  context: WorkspaceContext
  onSync: (module: string) => Promise<void>
  onNavigateBilling: () => void
  onToast: (message: string, kind?: ToastKind) => void
}>

const EMPTY_COVERAGE: CustomerCoverage = { ordersSyncCompleted: false, knownComplete90Days: false, cutoffDate: null, lastCompletedSyncAt: null, explanation: 'Order history coverage has not been established.' }
const EMPTY_DATA: CustomersPageResult = { plan: 'trial', customers: [], stats: { total: 0, active: 0, inactive: 0, unknown: 0, newCustomersLast30Days: 0, topSpender: null }, coverage: EMPTY_COVERAGE, lockedFilters: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } }

export function CustomersPage({ context, onSync, onNavigateBilling, onToast }: CustomersPageProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [segment, setSegment] = useState<CustomerSegmentFilterValue>('all')
  const [sort, setSort] = useState<NonNullable<CustomerQuery['sort']>>('created')
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<CustomersPageResult>(EMPTY_DATA)
  const [insights, setInsights] = useState<CustomerInsightsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [insightsLoading, setInsightsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => { const timer = window.setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1) }, 250); return () => window.clearTimeout(timer) }, [query])
  const requestQuery = useMemo<CustomerQuery>(() => ({ q: debouncedQuery, segment, sort, direction, page, limit: 20 }), [debouncedQuery, segment, sort, direction, page])

  useEffect(() => {
    if (!context.storeId) { setData(EMPTY_DATA); setLoading(false); return }
    let cancelled = false
    setLoading(true); setError(null)
    void fetchCustomers(context.storeId, requestQuery).then((result) => { if (!cancelled) { setData(result); setSelectedIds(new Set()) } }).catch((reason: unknown) => { if (!cancelled) setError(errorText(reason)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [context.storeId, requestQuery, refreshVersion])

  useEffect(() => {
    if (!context.storeId) { setInsights(null); setInsightsLoading(false); return }
    let cancelled = false
    setInsightsLoading(true)
    void fetchCustomerInsights(context.storeId).then((result) => { if (!cancelled) setInsights(result) }).catch((reason: unknown) => { if (!cancelled) onToast(errorText(reason), 'error') }).finally(() => { if (!cancelled) setInsightsLoading(false) })
    return () => { cancelled = true }
  }, [context.storeId, refreshVersion])

  const sync = async () => { setSyncing(true); try { await onSync('customers'); setRefreshVersion((value) => value + 1) } finally { setSyncing(false) } }
  const chooseSegment = (value: CustomerSegmentFilterValue, locked: boolean) => { if (locked) { onNavigateBilling(); return }; setSegment(value); setPage(1) }
  const exportCsv = async () => {
    if (!context.storeId) return
    setExporting(true)
    try {
      const rows: CustomerSummary[] = []
      let nextPage = 1; let pages = 1
      do { const result = await fetchCustomers(context.storeId, { ...requestQuery, page: nextPage, limit: 100 }); rows.push(...result.customers); pages = result.pagination.pages; nextPage += 1 } while (nextPage <= pages)
      downloadCustomers(rows)
      onToast(`${rows.length} real customer${rows.length === 1 ? '' : 's'} exported.`, 'success')
    } catch (reason: unknown) { onToast(errorText(reason), 'error') } finally { setExporting(false) }
  }
  const select = (id: string, checked: boolean) => setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next })
  const selectPage = (checked: boolean) => setSelectedIds(checked ? new Set(data.customers.map((customer) => customer.id)) : new Set())
  const emailCustomer = (customer: CustomerSummary) => onToast(customer.canEmail ? `Choose a reviewed email template for ${customer.displayName}.` : customer.emailDisabledReason ?? 'Customer cannot receive marketing email.', customer.canEmail ? 'info' : 'warning')

  if (!context.storeId) return <CustomersEmptyState title="Connect Shopify to view customers" description="ProfitPilot only displays protected customer data returned for your authorized Shopify store." action="Open billing" onAction={onNavigateBilling} />

  return <div className="customers-workspace">
    <div className="customers-heading-actions"><button className="button secondary" disabled={exporting || data.stats.total === 0} onClick={() => void exportCsv()}><Download size={14} />{exporting ? 'Exporting…' : 'Export CSV'}</button><button className="button primary" disabled={syncing} onClick={() => void sync()}><RefreshCw className={syncing ? 'spin' : ''} size={14} />{syncing ? 'Syncing…' : 'Sync Customers'}</button></div>
    <CustomerStatsGrid data={data} insights={insights} loading={loading || insightsLoading} onUpgrade={onNavigateBilling} />
    <AICustomerInsightsCard storeId={context.storeId} result={insights} loading={insightsLoading} onUpgrade={onNavigateBilling} onToast={onToast} />
    <CustomerHistoryCoverage coverage={data.coverage} />
    <section className="card customers-table-card">
      <CustomersToolbar query={query} onQuery={setQuery} segment={segment} data={data} sort={sort} direction={direction} onSort={setSort} onDirection={() => setDirection((value) => value === 'desc' ? 'asc' : 'desc')} onSegment={chooseSegment} onExport={() => void exportCsv()} exporting={exporting} />
      {selectedIds.size > 0 && <CustomerBulkActionBar selected={selectedIds.size} plan={data.plan} eligible={data.customers.filter((customer) => selectedIds.has(customer.id) && customer.canEmail).length} onClear={() => setSelectedIds(new Set())} onEmail={() => { const first = data.customers.find((customer) => selectedIds.has(customer.id) && customer.canEmail); if (first) emailCustomer(first); else onToast('None of the selected customers has subscribed email consent.', 'warning') }} onUpgrade={onNavigateBilling} />}
      {loading ? <CustomersSkeleton /> : error ? <CustomersError message={error} onRetry={() => setRefreshVersion((value) => value + 1)} /> : data.customers.length === 0 ? <CustomersEmptyState compact title={data.stats.total === 0 ? 'No customer records synced' : 'No customers match these filters'} description={data.stats.total === 0 ? 'Run Customers sync to load the real records Shopify returns. No demo customers are created.' : 'Try another search or segment. Unknown activity is never treated as Inactive.'} action={data.stats.total === 0 ? 'Sync Customers' : 'Clear filters'} onAction={data.stats.total === 0 ? () => void sync() : () => { setQuery(''); setSegment('all') }} /> : <CustomersTable customers={data.customers} plan={data.plan} selected={selectedIds} onSelect={select} onSelectPage={selectPage} onOpen={setDetailId} onEmail={emailCustomer} onUpgrade={onNavigateBilling} />}
      <CustomersPagination pagination={data.pagination} onPage={setPage} />
    </section>
    {detailId && <CustomerDetailDrawer storeId={context.storeId} customerId={detailId} plan={data.plan} onClose={() => setDetailId(null)} onEmail={emailCustomer} onUpgrade={onNavigateBilling} onToast={onToast} />}
  </div>
}

export function CustomerStatsGrid({ data, insights, loading, onUpgrade }: { data: CustomersPageResult; insights: CustomerInsightsResult | null; loading: boolean; onUpgrade: () => void }) {
  const segments = insightData(insights, 'premium_segments')
  const vipLocked = lockedCustomerInsight(insights, 'premium_segments')
  return <div className="customer-stats-grid">
    <article className="customer-stat-card"><span className="customer-stat-icon blue"><Users size={18} /></span><div><small>Total customers</small><strong>{loading ? '—' : number(data.stats.total)}</strong><p>{number(data.stats.active)} active · {number(data.stats.unknown)} unknown</p></div></article>
    <article className="customer-stat-card"><span className="customer-stat-icon amber"><TrendingUp size={18} /></span><div><small>Top spender</small><strong>{loading ? '—' : customerMoney(data.stats.topSpender?.value ?? null, data.stats.topSpender?.currency ?? null)}</strong><p>{data.stats.topSpender?.displayName ?? 'No spend returned'} · {number(data.stats.newCustomersLast30Days)} new</p></div></article>
    {vipLocked ? <PlanLockedFeature featureName="AI VIP customers" requiredPlan="growth" onUpgrade={onUpgrade}><div className="customer-stat-mask"><span /><strong>VIP intelligence</strong></div></PlanLockedFeature> : <article className="customer-stat-card premium"><span className="customer-stat-icon purple"><Sparkles size={18} /></span><div><small>AI VIP customers</small><strong>{loading ? '—' : numberValue(segments?.vip)}</strong><p>Top 20% by real lifetime spend</p></div></article>}
  </div>
}

export function AICustomerInsightsCard({ storeId, result, loading, onUpgrade, onToast }: { storeId: string; result: CustomerInsightsResult | null; loading: boolean; onUpgrade: () => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [open, setOpen] = useState(true)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const lock = lockedCustomerInsight(result, 'retention_suggestion')
  const retention = insightData(result, 'retention_suggestion')
  const segments = insightData(result, 'premium_segments')
  const patterns = insightData(result, 'purchase_patterns')
  const ask = async () => { if (!question.trim()) return; setAsking(true); try { const response = await queryCustomerInsights(storeId, question); const data = insightData(response, 'custom_ai_queries'); setAnswer(typeof data?.text === 'string' ? data.text : typeof data?.message === 'string' ? data.message : 'Insufficient data for this question.') } catch (reason: unknown) { onToast(errorText(reason), 'error') } finally { setAsking(false) } }
  return <section className="card customer-ai-card"><button className="customer-ai-heading" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span><Bot size={17} /><span><small>CUSTOMER INTELLIGENCE</small><strong>AI retention insights</strong></span></span>{open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button>{open && <div className="customer-ai-body">{loading ? <div className="customer-ai-skeleton"><span /><span /><span /></div> : lock ? <PlanLockedFeature featureName="Retention intelligence" requiredPlan={lock.required_plan} onUpgrade={onUpgrade}><div className="customer-insight-mask"><span /><span /><span /></div></PlanLockedFeature> : <>
    <div className="customer-insight-grid"><InsightMetric label="Churn risk" value={numberValue(segments?.churnRisk)} detail={result?.coverage.knownComplete90Days ? '60-day rule · coverage proven' : 'Unknown until coverage is proven'} /><InsightMetric label="New buyers" value={numberValue(segments?.newBuyer)} detail="Exactly one matched order in 30 days" /><InsightMetric label="Purchase cadence" value={patterns?.status === 'available' ? `${numberValue(patterns.averageCadenceDays)} days` : 'Insufficient data'} detail={patterns?.status === 'available' ? `${numberValue(patterns.customersWithPattern)} customers measured` : 'Needs 2+ dated orders'} /></div>
    <div className="retention-suggestion"><Sparkles size={16} /><div><strong>Retention suggestion</strong><p>{typeof retention?.text === 'string' ? retention.text : typeof retention?.message === 'string' ? retention.message : 'No generated suggestion is available yet.'}</p><small>{result?.usage.limit === null ? 'Unlimited AI insights' : `${result?.usage.used ?? 0}/${result?.usage.limit ?? 0} AI insights today`}</small></div></div>
    {result?.plan === 'commander' && <div className="customer-ai-query"><div><Sparkles size={15} /><span><strong>Ask customer intelligence</strong><small>Known PII is removed before the question reaches OpenRouter.</small></span></div><div><input maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What retention pattern should I review?" /><button disabled={!question.trim() || asking} onClick={() => void ask()}>{asking ? <RefreshCw className="spin" size={14} /> : <Send size={14} />}</button></div>{answer && <p>{answer}</p>}</div>}
  </>}</div>}</section>
}

function InsightMetric({ label, value, detail }: { label: string; value: string; detail: string }) { return <article><small>{label}</small><strong>{value}</strong><p>{detail}</p></article> }

export function CustomersToolbar({ query, onQuery, segment, data, sort, direction, onSort, onDirection, onSegment, onExport, exporting }: { query: string; onQuery: (value: string) => void; segment: CustomerSegmentFilterValue; data: CustomersPageResult; sort: NonNullable<CustomerQuery['sort']>; direction: 'asc' | 'desc'; onSort: (value: NonNullable<CustomerQuery['sort']>) => void; onDirection: () => void; onSegment: (value: CustomerSegmentFilterValue, locked: boolean) => void; onExport: () => void; exporting: boolean }) {
  return <><div className="customers-toolbar"><label className="customers-search"><Search size={15} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search name, email, phone, or ID" aria-label="Search customers" />{query && <button onClick={() => onQuery('')} aria-label="Clear search"><X size={13} /></button>}</label><div className="customers-toolbar-actions"><div className="customers-sort"><select value={sort} onChange={(event) => onSort(event.target.value as NonNullable<CustomerQuery['sort']>)} aria-label="Sort customers"><option value="created">Newest customer</option><option value="name">Name</option><option value="spent">Total spent</option><option value="orders">Orders</option><option value="last_order">Last order</option></select><button onClick={onDirection} aria-label={`Sort ${direction === 'desc' ? 'ascending' : 'descending'}`}>{direction === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}</button></div><button className="button secondary compact-export" disabled={exporting} onClick={onExport}><Download size={14} /> CSV</button></div></div><CustomerSegmentFilterBar active={segment} locked={data.lockedFilters.map((item) => item.segment)} onChange={onSegment} /></>
}

export function CustomerSegmentFilterBar({ active, locked, onChange }: { active: CustomerSegmentFilterValue; locked: readonly CustomerSegment[]; onChange: (value: CustomerSegmentFilterValue, locked: boolean) => void }) {
  const items: readonly Readonly<{ id: CustomerSegmentFilterValue; label: string }>[] = [{ id: 'all', label: 'All' }, { id: 'inactive', label: 'Inactive' }, { id: 'vip', label: 'VIP' }, { id: 'churn_risk', label: 'At Risk' }, { id: 'new_buyer', label: 'New Buyer' }]
  return <nav className="customer-segment-filter" aria-label="Customer segments">{items.map((item) => { const isLocked = item.id !== 'all' && item.id !== 'inactive' && locked.includes(item.id); return <button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => onChange(item.id, isLocked)}>{item.label}{isLocked && <LockKeyhole size={11} />}</button> })}</nav>
}

export function CustomerBulkActionBar({ selected, eligible, plan, onClear, onEmail, onUpgrade }: { selected: number; eligible: number; plan: CustomersPageResult['plan']; onClear: () => void; onEmail: () => void; onUpgrade: () => void }) {
  const premium = plan === 'growth' || plan === 'commander'
  return <div className="customer-bulk-bar"><span><strong>{selected}</strong> selected · {eligible} subscribed</span>{premium ? <button className="button primary" disabled={eligible === 0} onClick={onEmail}><Mail size={14} /> Review email</button> : <button className="button primary" onClick={onUpgrade}><LockKeyhole size={14} /> Upgrade for bulk actions</button>}<button className="button secondary" onClick={onClear}>Clear</button></div>
}

export function CustomersTable({ customers, plan, selected, onSelect, onSelectPage, onOpen, onEmail, onUpgrade }: { customers: readonly CustomerSummary[]; plan: CustomersPageResult['plan']; selected: ReadonlySet<string>; onSelect: (id: string, checked: boolean) => void; onSelectPage: (checked: boolean) => void; onOpen: (id: string) => void; onEmail: (customer: CustomerSummary) => void; onUpgrade: () => void }) {
  const premium = plan === 'growth' || plan === 'commander'
  const allSelected = customers.length > 0 && customers.every((customer) => selected.has(customer.id))
  return <div className="customers-table-wrap"><table className="customers-table"><thead><tr><th><input type="checkbox" checked={allSelected} disabled={!premium} onChange={(event) => onSelectPage(event.target.checked)} aria-label="Select page" /></th><th>Customer</th><th>Email</th><th>Orders</th><th>Total spent</th><th>Last order</th><th>Activity</th><th>Behavior</th><th>Action</th></tr></thead><tbody>{customers.map((customer) => <CustomerRow key={customer.id} customer={customer} premium={premium} selected={selected.has(customer.id)} onSelect={onSelect} onOpen={onOpen} onEmail={onEmail} onUpgrade={onUpgrade} />)}</tbody></table></div>
}

export function CustomerRow({ customer, premium, selected, onSelect, onOpen, onEmail, onUpgrade }: { customer: CustomerSummary; premium: boolean; selected: boolean; onSelect: (id: string, checked: boolean) => void; onOpen: (id: string) => void; onEmail: (customer: CustomerSummary) => void; onUpgrade: () => void }) {
  return <tr tabIndex={0} onClick={() => onOpen(customer.id)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(customer.id) }}><td data-label="Select" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected} disabled={!premium} onChange={(event) => onSelect(customer.id, event.target.checked)} aria-label={`Select ${customer.displayName}`} /></td><td data-label="Customer"><div className="customer-identity"><InitialsAvatar customer={customer} /><span><strong>{customer.displayName}</strong><small>{shortId(customer.id)}</small></span></div></td><td data-label="Email"><strong className={customer.email ? '' : 'muted'}>{customerEmailLabel(customer)}</strong><small>{marketingLabel(customer.marketingState)}</small></td><td data-label="Orders"><strong>{number(customer.lifetimeOrders)}</strong>{premium && customer.purchasePattern?.status === 'available' && <small>~{customer.purchasePattern.averageIntervalDays}d cadence</small>}</td><td data-label="Total spent"><strong>{customerMoney(customer.totalSpent, customer.currency)}</strong>{customer.totalSpent !== null && !customer.currency && <small>Currency unavailable</small>}</td><td data-label="Last order"><strong>{formatDate(customer.lastOrderAt)}</strong><small>{customer.lastOrderAt ? relativeDays(customer.lastOrderAt) : 'Not derivable'}</small></td><td data-label="Activity"><CustomerActivityStatus activity={customer.activity} /></td><td data-label="Behavior">{premium ? <BehaviorBadge segment={customer.primarySegment} /> : <button className="customer-inline-lock" onClick={(event) => { event.stopPropagation(); onUpgrade() }}><LockKeyhole size={12} /> Growth</button>}</td><td data-label="Action" onClick={(event) => event.stopPropagation()}><CustomerEmailAction customer={customer} premium={premium} onEmail={onEmail} onUpgrade={onUpgrade} /></td></tr>
}

export function InitialsAvatar({ customer }: { customer: Pick<CustomerSummary, 'id' | 'displayName' | 'hasRealName'> }) { const initials = initialsForCustomer(customer); return <span className={`customer-avatar ${customerAvatarColor(customer.id)}`}>{initials ?? <UserRound size={15} aria-label="Customer name unavailable" />}</span> }
export function BehaviorBadge({ segment }: { segment: CustomerSegment | null }) { const label = primaryBehaviorLabel(segment); return label ? <span className={`customer-behavior ${segment}`}>{label}</span> : <span className="customer-behavior none">—</span> }
export function CustomerActivityStatus({ activity }: { activity: CustomerSummary['activity'] }) { const label = activity === 'active' ? 'Active' : activity === 'inactive' ? 'Inactive' : 'Unknown'; return <span className={`customer-activity ${activity}`} title={activity === 'unknown' ? 'A complete 90-day Shopify order window cannot be proven.' : activity === 'active' ? 'Matched qualifying order in the last 30 days.' : 'No recent order and 90-day coverage is proven.'}>{label}{activity === 'unknown' && <Info size={11} />}</span> }
export function CustomerEmailAction({ customer, premium, onEmail, onUpgrade }: { customer: CustomerSummary; premium: boolean; onEmail: (customer: CustomerSummary) => void; onUpgrade: () => void }) { if (!premium) return <button className="customer-email-action locked" title="Growth plan required" onClick={onUpgrade}><LockKeyhole size={13} /> Email</button>; return <button className="customer-email-action" disabled={!customer.canEmail} title={customer.canEmail ? 'Review and compose email' : customer.emailDisabledReason ?? 'Email unavailable'} onClick={() => onEmail(customer)}><Mail size={13} /> Email</button> }

export function CustomerHistoryCoverage({ coverage }: { coverage: CustomerCoverage }) { return <div className={`customer-coverage ${coverage.knownComplete90Days ? 'known' : 'unknown'}`}><History size={15} /><div><strong>Synced history coverage</strong><span>{coverage.explanation}</span></div>{coverage.cutoffDate && <time dateTime={coverage.cutoffDate}>Cutoff {formatDate(coverage.cutoffDate)}</time>}</div> }

export function CustomerDetailDrawer({ storeId, customerId, plan, onClose, onEmail, onUpgrade, onToast }: { storeId: string; customerId: string; plan: CustomersPageResult['plan']; onClose: () => void; onEmail: (customer: CustomerSummary) => void; onUpgrade: () => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [customer, setCustomer] = useState<CustomerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { let cancelled = false; setLoading(true); void fetchCustomer(storeId, customerId).then((value) => { if (!cancelled) setCustomer(value) }).catch((reason: unknown) => { if (!cancelled) onToast(errorText(reason), 'error') }).finally(() => { if (!cancelled) setLoading(false) }); return () => { cancelled = true } }, [storeId, customerId])
  const summary = customer as CustomerSummary | null
  const growth = plan === 'growth' || plan === 'commander'
  return <div className="customer-drawer-layer"><button className="customer-drawer-backdrop" onClick={onClose} aria-label="Close customer details" /><aside className="customer-detail-drawer" aria-label="Customer details">{loading || !customer ? <CustomerDrawerSkeleton onClose={onClose} /> : <><header><div className="customer-drawer-title"><InitialsAvatar customer={customer} /><div><div className="section-kicker">SHOPIFY CUSTOMER · READ ONLY</div><h2>{customer.displayName}</h2><span>{customerEmailLabel(customer)} · <CustomerActivityStatus activity={customer.activity} /></span></div></div><button onClick={onClose} aria-label="Close customer details"><X size={19} /></button></header><div className="customer-drawer-scroll">
    <CustomerHistoryCoverage coverage={customer.coverage} />
    <CustomerDetailSection title="Customer summary" icon={<UserRound size={16} />}><dl className="customer-detail-grid"><Detail label="Created" value={formatDateTime(customer.createdAt)} /><Detail label="Last order" value={formatDateTime(customer.lastOrderAt)} /><Detail label="Lifetime orders" value={number(customer.lifetimeOrders)} /><Detail label="Lifetime spend" value={customerMoney(customer.totalSpent, customer.currency)} /><Detail label="Phone" value={customer.phone ?? '—'} /><Detail label="Marketing consent" value={marketingLabel(customer.marketingState)} /></dl></CustomerDetailSection>
    <CustomerLtvTimeline customer={customer} />
    <CustomerOrderHistory orders={customer.orders} />
    <ProductsBoughtList products={customer.products} />
    <CustomerDetailSection title="Purchase intelligence" icon={<Sparkles size={16} />}>{growth ? <div className="customer-prediction-grid"><Prediction label="Average cadence" value={customer.purchasePattern.status === 'available' ? `${customer.purchasePattern.averageIntervalDays} days` : 'Insufficient data'} /><Prediction label="Predicted next order" value={plan === 'commander' && customer.predictedNextOrder.status === 'available' ? formatDate(customer.predictedNextOrder.predictedNextOrderAt) : plan === 'commander' ? 'Insufficient data' : 'Commander required'} /><Prediction label="Predictive LTV · 12 months" value={plan === 'commander' && customer.predictiveLtv.status === 'available' ? customerMoney(customer.predictiveLtv.value, customer.predictiveLtv.currency) : plan === 'commander' ? 'Insufficient data' : 'Commander required'} /></div> : <PlanLockedFeature featureName="Purchase patterns" requiredPlan="growth" onUpgrade={onUpgrade}><div className="customer-insight-mask"><span /><span /></div></PlanLockedFeature>}</CustomerDetailSection>
    {(customer.tags.length > 0 || customer.note) && <CustomerDetailSection title="Shopify tags & note" icon={<ShieldCheck size={16} />}>{customer.tags.length > 0 && <div className="customer-tags">{customer.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}{customer.note && <p className="customer-note">{customer.note}</p>}<small className="read-only-note"><LockKeyhole size={12} /> Read only · edit in Shopify</small></CustomerDetailSection>}
    {plan === 'commander' && <div className="retention-workflow-cta"><Bot size={17} /><div><strong>Retention workflow capability</strong><p>Manual reviewed sends only in this release. Autonomous scheduling is off.</p></div></div>}
  </div><footer><span><LockKeyhole size={13} /> Shopify remains the source of truth</span>{summary && <CustomerEmailAction customer={summary} premium={growth} onEmail={onEmail} onUpgrade={onUpgrade} />}</footer></>}</aside></div>
}

function CustomerDetailSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) { return <section className="customer-detail-section"><h3>{icon}{title}</h3>{children}</section> }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div> }
function Prediction({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong>{value}</strong></div> }

export function CustomerOrderHistory({ orders }: { orders: CustomerDetail['orders'] }) { return <CustomerDetailSection title="Synced order history" icon={<CalendarDays size={16} />}>{orders.length === 0 ? <p className="customer-detail-empty">No qualifying dated orders were returned in synced history.</p> : <div className="customer-order-history">{orders.map((order) => <div key={order.id}><span><strong>{order.orderNumber}</strong><small>{formatDate(order.createdAt)}</small></span><strong>{customerMoney(order.total, order.currency)}</strong></div>)}</div>}</CustomerDetailSection> }
export function ProductsBoughtList({ products }: { products: CustomerDetail['products'] }) { return <CustomerDetailSection title="Products bought" icon={<Package size={16} />}>{products.length === 0 ? <p className="customer-detail-empty">No products are available in qualifying synced orders.</p> : <div className="customer-products">{products.map((product, index) => <span key={product.productId ?? `${product.title}-${index}`}><Package size={13} /><strong>{product.title}</strong><small>{product.quantity} bought</small></span>)}</div>}</CustomerDetailSection> }
export function CustomerLtvTimeline({ customer }: { customer: CustomerDetail }) { return <CustomerDetailSection title="Cumulative synced value" icon={<TrendingUp size={16} />}>{customer.cumulativeValue.length === 0 ? <p className="customer-detail-empty">A single-currency valued order timeline is not available. Mixed or missing currencies are never aggregated.</p> : <div className="customer-ltv-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={customer.cumulativeValue} margin={{ left: 4, right: 16, top: 8, bottom: 0 }}><CartesianGrid stroke="rgba(120,133,157,.12)" vertical={false} /><XAxis dataKey="date" tickFormatter={(value: string) => formatShortDate(value)} stroke="#6B7280" tick={{ fontSize: 8 }} /><YAxis stroke="#6B7280" tick={{ fontSize: 8 }} width={42} /><Tooltip formatter={(value) => customerMoney(typeof value === 'number' ? value : Number(value), customer.cumulativeValue[0]?.currency ?? null)} labelFormatter={(value) => formatDate(String(value))} contentStyle={{ background: '#171A23', border: '1px solid #2A2E38', borderRadius: 8, fontSize: 10 }} /><Line type="monotone" dataKey="value" stroke="#72A7FF" strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer></div>}</CustomerDetailSection> }

function CustomersPagination({ pagination, onPage }: { pagination: CustomersPageResult['pagination']; onPage: (page: number) => void }) { return <footer className="customers-pagination"><span>{number(pagination.total)} real customers</span><div><button disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}><ChevronLeft size={15} /></button><strong>Page {pagination.page} of {pagination.pages}</strong><button disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)}><ChevronRight size={15} /></button></div></footer> }
function CustomersSkeleton() { return <div className="customers-skeleton">{[1, 2, 3, 4, 5].map((row) => <div key={row}>{[1, 2, 3, 4, 5, 6].map((cell) => <span key={cell} />)}</div>)}</div> }
function CustomersError({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="customers-error"><AlertTriangle size={21} /><strong>Customers could not be loaded</strong><p>{message}</p><button className="button secondary" onClick={onRetry}><RefreshCw size={14} /> Retry</button></div> }
function CustomerDrawerSkeleton({ onClose }: { onClose: () => void }) { return <div className="customer-drawer-skeleton"><button onClick={onClose}><X size={18} /></button><span /><span /><span /><span /></div> }
export function CustomersEmptyState({ title, description, action, onAction, compact = false }: { title: string; description: string; action: string; onAction: () => void; compact?: boolean }) { return <div className={`customers-empty ${compact ? 'compact' : ''}`}><span><Users size={22} /></span><strong>{title}</strong><p>{description}</p><button className="button secondary" onClick={onAction}>{action}</button></div> }

function marketingLabel(state: CustomerSummary['marketingState']): string { return state === 'subscribed' ? 'Subscribed' : state === 'not_subscribed' ? 'Opted out' : state === 'pending' ? 'Consent pending' : 'Consent unknown' }
function number(value: number): string { return new Intl.NumberFormat('en-US').format(value) }
function numberValue(value: unknown): string { return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value) : '—' }
function formatDate(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date) : '—' }
function formatShortDate(value: string): string { const date = new Date(value); return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date) : '' }
function formatDateTime(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : '—' }
function relativeDays(value: string): string { const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86_400_000)); return days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} ago` }
function shortId(value: string): string { return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value }
function errorText(value: unknown): string { return value instanceof Error ? value.message : 'Request failed' }
function downloadCustomers(customers: readonly CustomerSummary[]): void { const rows = [['Customer ID', 'Name', 'Email', 'Marketing state', 'Orders', 'Total spent', 'Currency', 'Last order', 'Activity'], ...customers.map((customer) => [customer.id, customer.displayName, customer.email ?? '', customer.marketingState, customer.lifetimeOrders, customer.totalSpent ?? '', customer.currency ?? '', customer.lastOrderAt ?? '', customer.activity])]; const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `shopify-customers-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url) }
function csvCell(value: unknown): string { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }

// Keep the public component name requested by the customer workspace spec.
export const CustomerSegmentFilter = CustomerSegmentFilterBar
