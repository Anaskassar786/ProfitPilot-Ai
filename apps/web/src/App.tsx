import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  Box,
  Briefcase,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  CloudOff,
  Command,
  Copy,
  Database,
  Download,
  Eye,
  ExternalLink,
  FileBarChart,
  FileText,
  Filter,
  Gauge,
  GitBranch,
  Globe2,
  Inbox,
  Info,
  Keyboard,
  LayoutDashboard,
  LifeBuoy,
  LineChart,
  ListFilter,
  LockKeyhole,
  Mail,
  Menu,
  MessageSquare,
  Mic,
  Moon,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Tag,
  Target,
  TicketCheck,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserCircle,
  Users,
  Volume2,
  WalletCards,
  WandSparkles,
  Workflow,
  X,
  Zap,
} from 'lucide-react'
import { PhaseNotImplementedError } from '@profitpilot/types'
import { activateWorkflow, createBillingCharge, createCampaignTemplate, createTicket, createWorkflow, decideRecommendation, exportRows, fetchAgentStatuses, fetchAnalytics, fetchBilling, fetchBillingPlans, fetchBillingRoi, fetchBillingUsage, fetchCampaignTemplates, fetchCatalog, fetchRecommendations, fetchTickets, fetchWorkflows, redeemGiftCode, requestSync, saveMerchantEmail, verifyMerchantEmail, ApiClientError } from './api.js'
import type { AgentStatus, AnalyticsSnapshot, CatalogProduct, JsonValue, Recommendation, SectionId, WorkspaceContext } from './model.js'
import { averageOrderValue, formatMoney, formatNumber, latestSyncLabel, revenueSeries, sumOrders, sumRevenue, workspaceContext } from './model.js'

const navGroups: ReadonlyArray<{ label: string; items: ReadonlyArray<NavItem> }> = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'products', label: 'Products', icon: Package },
      { id: 'orders', label: 'Orders', icon: ShoppingBag },
      { id: 'customers', label: 'Customers', icon: Users },
      { id: 'inventory', label: 'Inventory', icon: Box },
      { id: 'analytics', label: 'Analytics', icon: LineChart },
    ],
  },
  {
    label: 'AI employee',
    items: [
      { id: 'command-center', label: 'AI Command Center', icon: Bot, tag: 'F4' },
      { id: 'recommendations', label: 'Recommendations', icon: WandSparkles, tag: 'F4' },
      { id: 'automation', label: 'Automation', icon: Workflow, tag: 'F6' },
      { id: 'campaigns', label: 'Campaigns', icon: Send, tag: 'F6' },
      { id: 'copilot', label: 'Copilot', icon: Sparkles, tag: 'F8' },
    ],
  },
  {
    label: 'Business',
    items: [
      { id: 'reports', label: 'Reports', icon: FileBarChart, tag: 'F8' },
      { id: 'exports', label: 'Exports', icon: Download },
      { id: 'support', label: 'Support tickets', icon: LifeBuoy },
      { id: 'billing', label: 'Billing', icon: WalletCards, tag: 'F5' },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
]

const pageMeta: Readonly<Record<SectionId, Readonly<{ title: string; description: string; icon: LucideIcon }>>> = {
  dashboard: { title: 'Dashboard', description: 'A clear view of the store data ProfitPilot is receiving.', icon: LayoutDashboard },
  products: { title: 'Products', description: 'Catalog records synced from Shopify, with no invented inventory.', icon: Package },
  orders: { title: 'Orders', description: 'Order facts will appear here after a real sync completes.', icon: ShoppingBag },
  customers: { title: 'Customers', description: 'Customer data stays tenant-scoped and minimized by default.', icon: Users },
  inventory: { title: 'Inventory', description: 'Inventory levels and days-of-cover from your Shopify store.', icon: Box },
  analytics: { title: 'Analytics', description: 'Pre-aggregated metrics built from closed Shopify data.', icon: LineChart },
  'command-center': { title: 'AI Command Center', description: 'The AI employee control plane will arrive in F4.', icon: Bot },
  recommendations: { title: 'Recommendations', description: 'Evidence-backed decisions will be enabled after the F4 decision engine.', icon: WandSparkles },
  automation: { title: 'Automation', description: 'Design workflows now; execution remains safety-gated for F6.', icon: Workflow },
  campaigns: { title: 'Campaigns', description: 'Marketing workflows will use verified store and attribution data.', icon: Send },
  copilot: { title: 'Copilot', description: 'A grounded query surface for the evidence packs built by ProfitPilot.', icon: Sparkles },
  reports: { title: 'Reports', description: 'Closed-period reporting will be enabled in F8.', icon: FileBarChart },
  exports: { title: 'Exports', description: 'Export real synced records when the data plane has something to deliver.', icon: Download },
  support: { title: 'Support tickets', description: 'A direct, auditable line to the ProfitPilot team.', icon: LifeBuoy },
  billing: { title: 'Billing', description: 'Billing state and entitlement UI will be wired in F5.', icon: WalletCards },
  settings: { title: 'Settings', description: 'Store context, preferences, and security controls.', icon: Settings },
}

const agents = [
  ['Revenue Agent', TrendingUp, 'F4'],
  ['Inventory Agent', Box, 'F4'],
  ['Customer Agent', Users, 'F4'],
  ['Pricing Agent', Tag, 'F4'],
  ['Campaign Agent', Send, 'F4'],
  ['Product Agent', Package, 'F4'],
  ['Executive Agent', Briefcase, 'F4'],
] as const

type NavItem = Readonly<{ id: SectionId; label: string; icon: LucideIcon; tag?: string }>
type LoadState = 'idle' | 'loading' | 'ready' | 'offline'
type ToastKind = 'success' | 'info' | 'warning' | 'error'
type ToastState = Readonly<{ message: string; kind: ToastKind }>

type WorkspaceData = Readonly<{ analytics: AnalyticsSnapshot | null; catalog: readonly CatalogProduct[]; agents: readonly AgentStatus[]; recommendations: readonly Recommendation[]; loadState: LoadState; error: string | null }>

export default function App() {
  const [activePage, setActivePage] = useState<SectionId>('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [jarvisOpen, setJarvisOpen] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [lightMode, setLightMode] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [data, setData] = useState<WorkspaceData>({ analytics: null, catalog: [], agents: [], recommendations: [], loadState: 'idle', error: null })
  const context = useMemo(() => workspaceContext(window.location.search), [])

  const showToast = (message: string, kind: ToastKind = 'success') => {
    setToast({ message, kind })
    window.setTimeout(() => setToast(null), 3600)
  }

  const loadData = async () => {
    if (!context.storeId) {
      setData({ analytics: null, catalog: [], agents: [], recommendations: [], loadState: 'idle', error: null })
      return
    }
    setData((current) => ({ ...current, loadState: 'loading', error: null }))
    const [analyticsResult, catalogResult, agentsResult, recommendationsResult] = await Promise.allSettled([fetchAnalytics(context.storeId), fetchCatalog(context.storeId), fetchAgentStatuses(), fetchRecommendations(context.storeId)])
    const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : null
    const catalog = catalogResult.status === 'fulfilled' ? catalogResult.value : []
    const agents = agentsResult.status === 'fulfilled' ? agentsResult.value : []
    const recommendations = recommendationsResult.status === 'fulfilled' ? recommendationsResult.value : []
    const errors = [analyticsResult, catalogResult].filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    setData({ analytics, catalog, agents, recommendations, loadState: errors.length === 2 ? 'offline' : 'ready', error: errors[0] ? errorMessage(errors[0].reason) : null })
  }

  useEffect(() => { void loadData() }, [context.storeId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true) }
      if (event.key === '?' && !isTypingTarget(event.target)) setShortcutsOpen(true)
      if (event.key === 'Escape') { setCommandOpen(false); setNotificationsOpen(false); setProfileOpen(false); setEvidenceOpen(false); setShortcutsOpen(false) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const navigate = (page: SectionId) => { setActivePage(page); setMobileOpen(false); setCommandOpen(false) }
  const sync = async (module: string) => {
    if (!context.storeId) { setOnboardingOpen(true); return }
    try {
      await requestSync(context.storeId, module)
      showToast(`${module} sync queued through the F2 data plane.`, 'success')
      void loadData()
    } catch (error: unknown) { showToast(errorMessage(error), 'error') }
  }
  const decide = async (id: string, decision: 'approve' | 'reject', expectedVersion: number) => {
    if (!context.storeId) { setOnboardingOpen(true); return }
    try {
      await decideRecommendation(context.storeId, id, expectedVersion, decision)
      showToast(`Recommendation ${decision === 'approve' ? 'approved' : 'rejected'}.`, decision === 'approve' ? 'success' : 'info')
      void loadData()
    } catch (error: unknown) { showToast(errorMessage(error), 'error') }
  }
  const phaseGate = (phase: string, capability: string) => {
    try { throw new PhaseNotImplementedError(phase, capability) } catch (error: unknown) { showToast(error instanceof Error ? error.message : 'This capability is phase-gated.', 'info') }
  }

  return (
    <div className={`app-shell ${lightMode ? 'light-mode' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Sidebar activePage={activePage} collapsed={collapsed} mobileOpen={mobileOpen} context={context} onNavigate={navigate} onCollapse={() => setCollapsed((value) => !value)} onClose={() => setMobileOpen(false)} onOpenCommand={() => setCommandOpen(true)} onOnboarding={() => setOnboardingOpen(true)} />
      <main id="main-content" tabIndex={-1} className={`main-shell ${collapsed ? 'sidebar-is-collapsed' : ''}`}>
        <TopBar active={pageMeta[activePage]} onMenu={() => setMobileOpen(true)} onCommand={() => setCommandOpen(true)} onNotifications={() => setNotificationsOpen(true)} onProfile={() => setProfileOpen((value) => !value)} profileOpen={profileOpen} lightMode={lightMode} onTheme={() => setLightMode((value) => !value)} onShortcuts={() => setShortcutsOpen(true)} />
        <div className="page-scroll">
          {data.loadState === 'offline' && <OfflineBanner error={data.error} onRetry={() => void loadData()} />}
          {!context.storeId && <ContextBanner onConnect={() => setOnboardingOpen(true)} />}
          <PageRouter active={activePage} context={context} data={data} onNavigate={navigate} onSync={sync} onDecide={decide} onRefresh={() => void loadData()} onToast={showToast} onPhaseGate={phaseGate} onEvidence={() => setEvidenceOpen(true)} lightMode={lightMode} onTheme={() => setLightMode((value) => !value)} />
        </div>
      </main>
      {!jarvisOpen && <JarvisOrb onClick={() => setJarvisOpen(true)} />}
      {jarvisOpen && <JarvisPanel onClose={() => setJarvisOpen(false)} onPhaseGate={phaseGate} />}
      {notificationsOpen && <NotificationDrawer onClose={() => setNotificationsOpen(false)} />}
      {commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} onNavigate={navigate} />}
      {evidenceOpen && <EvidenceDrawer recommendation={data.recommendations[0] ?? null} onClose={() => setEvidenceOpen(false)} />}
      {onboardingOpen && <OnboardingModal onClose={() => setOnboardingOpen(false)} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      {profileOpen && <ProfileMenu lightMode={lightMode} onTheme={() => setLightMode((value) => !value)} onClose={() => setProfileOpen(false)} onSettings={() => { setProfileOpen(false); navigate('settings') }} />}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

function Sidebar({ activePage, collapsed, mobileOpen, context, onNavigate, onCollapse, onClose, onOpenCommand, onOnboarding }: { activePage: SectionId; collapsed: boolean; mobileOpen: boolean; context: WorkspaceContext; onNavigate: (page: SectionId) => void; onCollapse: () => void; onClose: () => void; onOpenCommand: () => void; onOnboarding: () => void }) {
  return <>
    {mobileOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={onClose} />}
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="brand-row"><button className="brand-lockup" onClick={() => onNavigate('dashboard')} aria-label="Go to dashboard"><span className="brand-mark"><span /></span>{!collapsed && <span className="brand-name">Profit<span>Pilot</span></span>}</button><button className="sidebar-collapse" onClick={onCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button><button className="mobile-close" onClick={onClose} aria-label="Close navigation"><X size={18} /></button></div>
      {!collapsed ? <button className="workspace-switcher" onClick={context.storeId ? () => onNavigate('settings') : onOnboarding}><span className={`workspace-avatar ${context.storeId ? 'connected' : ''}`}>{context.storeId ? 'ON' : '—'}</span><span className="workspace-copy"><strong>{context.shop ?? 'No Shopify store'}</strong><small>{context.storeId ? 'F2 data plane connected' : 'Connect a store to begin'}</small></span><ChevronDown size={15} /></button> : <button className="workspace-switcher compact" onClick={context.storeId ? () => onNavigate('settings') : onOnboarding} aria-label="Open store context"><span className="workspace-avatar">{context.storeId ? 'ON' : '—'}</span></button>}
      {!collapsed && <button className="command-trigger" onClick={onOpenCommand}><Search size={15} /><span>Search workspace</span><kbd>⌘ K</kbd></button>}
      <nav className="side-nav" aria-label="Primary navigation">{navGroups.map((group) => <div className="nav-group" key={group.label}>{!collapsed && <div className="nav-group-label">{group.label}</div>}{group.items.map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => onNavigate(item.id)} title={collapsed ? item.label : undefined}><Icon size={17} strokeWidth={activePage === item.id ? 2.25 : 1.8} />{!collapsed && <span>{item.label}</span>}{!collapsed && item.tag && <span className={`nav-tag ${item.tag === 'F4' ? 'purple' : ''}`}>{item.tag}</span>}{collapsed && item.tag && <i className="collapsed-badge" />}</button> })}</div>)}</nav>
      <div className="sidebar-footer">{!collapsed && <div className="version-card"><div><span className="live-dot" />F2 data plane</div><strong>{context.storeId ? 'Store context ready' : 'Awaiting Shopify'}</strong><small>{context.storeId ? 'API-backed workspace' : 'Use the install flow to connect'}</small>{!context.storeId && <button onClick={onOnboarding}>Connect Shopify <ArrowUpRight size={13} /></button>}</div>}<button className="help-link" onClick={() => onNavigate('support')} title={collapsed ? 'Help center' : undefined}><CircleHelp size={17} />{!collapsed && <span>Help center</span>}</button>{!collapsed && <nav className="legal-links" aria-label="Legal and compliance"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="/legal/security">Security</a><a href="/legal/cookies">Cookies</a><a href="/legal/dpa">DPA</a></nav>}<div className="sidebar-user"><span className="user-avatar">AA</span>{!collapsed && <span className="sidebar-user-copy"><strong>ProfitPilot team</strong><small>F0–F2 foundation</small></span>}{!collapsed && <MoreHorizontal size={16} />}</div></div>
    </aside>
  </>
}

function TopBar({ active, onMenu, onCommand, onNotifications, onProfile, profileOpen, lightMode, onTheme, onShortcuts }: { active: Readonly<{ title: string; icon: LucideIcon }>; onMenu: () => void; onCommand: () => void; onNotifications: () => void; onProfile: () => void; profileOpen: boolean; lightMode: boolean; onTheme: () => void; onShortcuts: () => void }) {
  const ActiveIcon = active.icon
  return <header className="topbar"><div className="topbar-left"><button className="mobile-menu-button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong><ActiveIcon size={14} />{active.title}</strong></div></div><div className="topbar-actions"><button className="top-search" onClick={onCommand}><Search size={16} /><span>Search</span><kbd>⌘ K</kbd></button><button className="icon-button" onClick={onShortcuts} aria-label="Keyboard shortcuts"><Keyboard size={17} /></button><div className="topbar-divider" /><button className="icon-button notification-button" onClick={onNotifications} aria-label="Open notifications"><Bell size={18} /><i /></button><button className="icon-button" onClick={onTheme} aria-label="Toggle theme">{lightMode ? <Moon size={18} /> : <Sun size={18} />}</button><button className="profile-button" onClick={onProfile} aria-expanded={profileOpen}><span className="profile-avatar">PP</span><span className="profile-name">Workspace</span><ChevronDown size={14} /></button></div></header>
}

function PageRouter({ active, context, data, onNavigate, onSync, onDecide, onRefresh, onToast, onPhaseGate, onEvidence, lightMode, onTheme }: { active: SectionId; context: WorkspaceContext; data: WorkspaceData; onNavigate: (page: SectionId) => void; onSync: (module: string) => Promise<void>; onDecide: (id: string, decision: 'approve' | 'reject', expectedVersion: number) => Promise<void>; onRefresh: () => void; onToast: (message: string, kind?: ToastKind) => void; onPhaseGate: (phase: string, capability: string) => void; onEvidence: () => void; lightMode: boolean; onTheme: () => void }) {
  if (active === 'dashboard') return <DashboardPage context={context} data={data} onNavigate={onNavigate} onSync={onSync} />
  if (active === 'products') return <ProductsPage context={context} catalog={data.catalog} onSync={onSync} />
  if (active === 'analytics') return <AnalyticsPage context={context} snapshot={data.analytics} onSync={onSync} />
  if (active === 'inventory') return <InventoryPage context={context} snapshot={data.analytics} onSync={onSync} />
  if (active === 'command-center') return <CommandCenterPage agents={data.agents} onRefresh={onRefresh} onPhaseGate={onPhaseGate} />
  if (active === 'recommendations') return <RecommendationsPage recommendations={data.recommendations} onEvidence={onEvidence} onDecide={onDecide} onRefresh={onRefresh} onPhaseGate={onPhaseGate} />
  if (active === 'automation') return <AutomationPage context={context} onPhaseGate={onPhaseGate} onToast={onToast} />
  if (active === 'campaigns') return <CampaignsPage onPhaseGate={onPhaseGate} context={context} onToast={onToast} />
  if (active === 'copilot') return <CopilotPage onPhaseGate={onPhaseGate} />
  if (active === 'reports') return <ReportsPage onPhaseGate={onPhaseGate} />
  if (active === 'billing') return <BillingPage context={context} onPhaseGate={onPhaseGate} onToast={onToast} />
  if (active === 'settings') return <SettingsPage context={context} lightMode={lightMode} onTheme={onTheme} onToast={onToast} />
  if (active === 'support') return <SupportPage context={context} onToast={onToast} />
  if (active === 'exports') return <ExportsPage context={context} />
  return <EmptyDataPage page={active} context={context} onSync={onSync} />
}

function DashboardPage({ context, data, onNavigate, onSync }: { context: WorkspaceContext; data: WorkspaceData; onNavigate: (page: SectionId) => void; onSync: (module: string) => Promise<void> }) {
  const revenue = sumRevenue(data.analytics)
  const orders = sumOrders(data.analytics)
  const aov = averageOrderValue(data.analytics)
  const series = revenueSeries(data.analytics)
  return <PageLayout eyebrow="Store intelligence" title={context.shop ? `Good morning, ${context.shop}` : 'Connect your Shopify store'} description={context.storeId ? 'Your workspace is ready for real Shopify data. Start a sync to build the first analytics snapshot.' : 'ProfitPilot never invents store numbers. Connect Shopify to unlock the live data plane.'} actions={<><button className="button secondary" onClick={() => void onSync('products')}><RefreshCw size={15} /> Sync catalog</button><button className="button primary" onClick={() => onNavigate('analytics')}><LineChart size={15} /> Open analytics</button></>}>
    <div className="sync-banner"><span className="sync-pulse"><span /></span><span><strong>{context.storeId ? 'F2 data plane ready' : 'No store context'}</strong> · {latestSyncLabel(data.analytics)}</span><button onClick={() => void onSync('orders')}>{context.storeId ? 'Sync orders' : 'Connect Shopify'} <ArrowUpRight size={13} /></button></div>
    <div className="stat-grid"><MetricCard label="Revenue" value={formatMoney(revenue)} detail={revenue === null ? 'Awaiting analytics rows' : 'From revenue_daily'} icon={WalletCards} tone="gold" /><MetricCard label="Orders" value={formatNumber(orders)} detail={orders === null ? 'Awaiting orders sync' : 'From orders_daily'} icon={ShoppingBag} tone="blue" /><MetricCard label="Average order value" value={formatMoney(aov)} detail={aov === null ? 'Calculated after sync' : 'Revenue ÷ orders'} icon={Target} tone="purple" /><MetricCard label="AI-attributed revenue" value="—" detail="Available in F4" icon={Sparkles} tone="green" gated /> </div>
    <div className="dashboard-grid top-grid"><section className="card revenue-card"><CardHeading kicker="Real analytics" dot="blue" title="Revenue overview" action={<button className="select-button">Closed periods <ChevronDown size={13} /></button>} /><div className="chart-legend"><span><i className="legend-line blue" /> Revenue from analytics_daily</span><span className="chart-last-updated"><Clock3 size={13} /> {data.loadState === 'loading' ? 'Loading…' : latestSyncLabel(data.analytics)}</span></div>{data.loadState === 'loading' ? <ChartSkeleton /> : series.length > 0 ? <AreaChart values={series} /> : <EmptyChart onSync={() => void onSync('orders')} />}</section><section className="card health-card"><CardHeading kicker="Deterministic state" dot="green" title="Store health" /><HealthGauge hasData={Boolean(data.analytics && data.analytics.revenue.length > 0)} /><div className="health-items"><HealthLine label="Revenue coverage" value={data.analytics?.revenue.length ? 'Available' : 'No rows yet'} tone={data.analytics?.revenue.length ? 'green' : 'muted'} /><HealthLine label="Order coverage" value={data.analytics?.orders.length ? 'Available' : 'No rows yet'} tone={data.analytics?.orders.length ? 'green' : 'muted'} /><HealthLine label="AI employee" value="F4 gated" tone="purple" /></div><button className="text-button full" onClick={() => onNavigate('analytics')}>View data health <ArrowUpRight size={14} /></button></section></div>
    <div className="dashboard-grid middle-grid"><section className="card attention-card"><CardHeading kicker="Next safe action" dot="amber" title="Build your first data snapshot" /><div className="empty-action"><span className="empty-action-icon"><Database size={18} /></span><div><strong>{context.storeId ? 'Run a Shopify sync' : 'Connect Shopify first'}</strong><p>{context.storeId ? 'Sync products and orders to populate catalog and pre-aggregated metrics.' : 'The embedded install route will create the store context without preview data.'}</p></div><button className="button secondary" onClick={() => void onSync(context.storeId ? 'products' : 'install')}>{context.storeId ? 'Start sync' : 'Connect'}</button></div></section><section className="card employee-card"><div className="employee-glow" /><div className="employee-head"><span className="jarvis-mini-orb"><span /></span><div><div className="section-kicker">AI EMPLOYEE <span className="phase-tag">F4+</span></div><h3>Decision engine is next</h3></div></div><p>Foundation, Shopify core, and data plane are ready. AI explanations will only appear once evidence packs are available.</p><div className="employee-progress"><span style={{ width: '34%' }} /><small>F0 · F1 · F2 complete</small></div><button className="button ghost" onClick={() => onNavigate('command-center')}>See upcoming agents <ArrowUpRight size={14} /></button></section></div>
  </PageLayout>
}

function ProductsPage({ context, catalog, onSync }: { context: WorkspaceContext; catalog: readonly CatalogProduct[]; onSync: (module: string) => Promise<void> }) { return <PageLayout eyebrow="F2 catalog" title="Products" description="Showing only products returned by the catalog endpoint." actions={<><button className="button secondary"><Download size={15} /> Export later</button><button className="button primary" onClick={() => void onSync('products')}><RefreshCw size={15} /> Sync products</button></>}><div className="metric-strip"><MiniMetric label="Synced products" value={catalog.length ? formatNumber(catalog.length) : '—'} sub={catalog.length ? 'Catalog rows' : 'No rows yet'} tone="blue" /><MiniMetric label="Inventory signals" value="—" sub="Read from Shopify sync" tone="amber" /><MiniMetric label="Product insights" value="—" sub="F4 AI agent" tone="purple" /><MiniMetric label="Tenant" value={context.storeId ? 'Scoped' : 'Missing'} sub="RLS context" tone="green" /></div>{catalog.length === 0 ? <EmptyState icon={Package} title="No product rows yet" description={context.storeId ? 'Run the products sync. When Shopify returns rows, this table will render them directly.' : 'Connect a Shopify store to load real catalog records.'} action={context.storeId ? 'Sync products' : 'Connect Shopify'} onAction={() => void onSync(context.storeId ? 'products' : 'install')} /> : <ProductTable catalog={catalog} />}</PageLayout> }

function ProductTable({ catalog }: { catalog: readonly CatalogProduct[] }) { return <section className="card table-card"><div className="table-toolbar"><div className="table-search"><Search size={15} /><input aria-label="Search products" placeholder="Search synced products" /></div><div className="toolbar-actions"><button className="filter-button"><Filter size={14} /> Filter</button><button className="filter-button"><SlidersHorizontal size={14} /> Columns</button></div></div><div className="table-wrap"><table><thead><tr><th>Product ID</th><th>Title</th><th>Inventory</th><th>Synced at</th><th>Source</th></tr></thead><tbody>{catalog.map((product) => <tr key={product.productId}><td><strong className="mono blue-text">{product.productId}</strong></td><td><strong>{stringValue(product.payload.title) ?? 'Untitled product'}</strong></td><td>{numberValue(product.payload.inventory) === null ? '—' : formatNumber(numberValue(product.payload.inventory))}</td><td className="muted-cell">{new Date(product.syncedAt).toLocaleString()}</td><td><span className="status-badge green"><CheckCircle2 size={12} /> Shopify</span></td></tr>)}</tbody></table></div><div className="table-footer"><span>{catalog.length} real catalog rows</span><span className="table-footer-note"><ShieldCheck size={14} /> Tenant-scoped response</span></div></section> }

function AnalyticsPage({ context, snapshot, onSync }: { context: WorkspaceContext; snapshot: AnalyticsSnapshot | null; onSync: (module: string) => Promise<void> }) { const revenue = sumRevenue(snapshot); const orders = sumOrders(snapshot); return <PageLayout eyebrow="F2 pre-aggregation" title="Analytics" description="Four deterministic metric tables, rendered without client-side invented numbers." actions={<><button className="button secondary"><CalendarDays size={15} /> Closed periods</button><button className="button primary" onClick={() => void onSync('orders')}><RefreshCw size={15} /> Refresh data</button></>}><div className="metric-strip"><MiniMetric label="Revenue" value={formatMoney(revenue)} sub="analytics_revenue_daily" tone="gold" /><MiniMetric label="Orders" value={formatNumber(orders)} sub="analytics_orders_daily" tone="blue" /><MiniMetric label="Product sales rows" value={snapshot ? formatNumber(snapshot.productSales.length) : '—'} sub="Pre-aggregated" tone="purple" /><MiniMetric label="Cohort rows" value={snapshot ? formatNumber(snapshot.customerCohorts.length) : '—'} sub="Pre-aggregated" tone="green" /></div><div className="analytics-grid"><section className="card analytics-main-card"><CardHeading kicker="Revenue table" dot="blue" title="Revenue trend" action={<div className="chart-tabs"><button className="active">Revenue</button><button>Orders</button><button>COGS later</button></div>} />{snapshot && snapshot.revenue.length > 0 ? <AreaChart values={revenueSeries(snapshot)} /> : <EmptyChart onSync={() => void onSync('orders')} />}</section><section className="card channel-card"><CardHeading kicker="Attribution" dot="purple" title="AI attribution" /><div className="gated-panel"><LockKeyhole size={21} /><strong>Not available yet</strong><p>Attribution starts after the F4 executor and tracking links are enabled.</p><span className="phase-tag">Phase F4</span></div></section></div><section className="card insight-row-card"><CardHeading kicker="Data contracts" dot="green" title="What is real right now" /><div className="insight-row-list"><InsightItem icon={Database} title="Revenue daily" detail={snapshot?.revenue.length ? `${snapshot.revenue.length} rows returned` : 'No rows returned'} tone="blue" /><InsightItem icon={ShoppingBag} title="Orders daily" detail={snapshot?.orders.length ? `${snapshot.orders.length} rows returned` : 'Sync orders to populate'} tone="green" /><InsightItem icon={ShieldCheck} title="Tenant isolation" detail={context.storeId ? 'Scoped by storeId' : 'Store context required'} tone="purple" /></div></section></PageLayout> }

function InventoryPage({ context, snapshot, onSync }: { context: WorkspaceContext; snapshot: AnalyticsSnapshot | null; onSync: (module: string) => Promise<void> }) { const products = snapshot?.productSales ?? []; return <PageLayout eyebrow="F2 inventory" title="Inventory" description="Inventory-specific rows will appear once the inventory module is synced." actions={<button className="button primary" onClick={() => void onSync('inventory')}><RefreshCw size={15} /> Sync inventory</button>}><div className="inventory-hero"><div><div className="section-kicker"><span className="kicker-dot blue" /> Real source rows only</div><h2>{products.length ? `${products.length} product sales rows available` : 'Inventory coverage is not available yet.'}</h2><p>{context.storeId ? 'The data plane is ready to ingest inventory levels. No stockout claim is shown before that sync.' : 'Connect a Shopify store to start the inventory module.'}</p></div><div className="health-gauge compact"><div className="gauge-inner"><strong>—</strong><span>NO DATA</span></div></div></div><div className="metric-strip"><MiniMetric label="Units in stock" value="—" sub="Awaiting inventory sync" tone="blue" /><MiniMetric label="Days of cover" value="—" sub="Deterministic F2 input" tone="amber" /><MiniMetric label="Stockout risk" value="—" sub="No claim without rows" tone="red" /><MiniMetric label="Dead stock" value="—" sub="F4 decision rule later" tone="purple" /></div><EmptyState icon={Box} title="No inventory snapshot" description="Sync inventory through the F2 API. This surface will render real Shopify inventory levels and no other values." action="Sync inventory" onAction={() => void onSync('inventory')} /></PageLayout> }

function EmptyDataPage({ page, context, onSync }: { page: SectionId; context: WorkspaceContext; onSync: (module: string) => Promise<void> }) { const meta = pageMeta[page]; const Icon = meta.icon; return <PageLayout eyebrow="F2 data surface" title={meta.title} description={meta.description}><EmptyState icon={Icon} title={`No ${meta.title.toLowerCase()} data yet`} description={context.storeId ? 'This section is wired to the foundation and will render once its source module has real rows.' : 'Connect Shopify first. ProfitPilot does not ship demo records.'} action={context.storeId ? `Sync ${meta.title}` : 'Connect Shopify'} onAction={() => void onSync(page)} /></PageLayout> }

function CommandCenterPage({ agents: statuses, onRefresh, onPhaseGate }: { agents: readonly AgentStatus[]; onRefresh: () => void; onPhaseGate: (phase: string, capability: string) => void }) {
  const ready = statuses.filter((agent) => agent.execution === 'READY').length
  const gated = statuses.length === 0
  return <PageLayout eyebrow="AI employee · F4" title="AI Command Center" description="Seven agent contracts are connected to the F4 API. Deterministic decisions stay separate from language generation." actions={<button className="button secondary" onClick={onRefresh} disabled={gated}><RefreshCw size={15} /> {gated ? 'Awaiting F4 API' : 'Refresh statuses'}</button>}>
    <div className="command-health"><div><div className="section-kicker"><span className={`kicker-dot ${gated ? 'purple' : 'green'}`} /> {gated ? 'F4 API NOT CONFIGURED' : 'AGENT CONTRACTS LOADED'}</div><h2>{gated ? 'AI status is waiting for the backend.' : 'Your AI employee is ready for analysis.'}</h2><p>Numbers remain deterministic; agents only explain evidence returned by the rule engine.</p></div><div className="command-health-stats"><div><strong>{gated ? '—' : `${ready}/7`}</strong><span>agents ready</span></div><div><strong>8</strong><span>deterministic rules</span></div><div><strong>$5</strong><span>daily cost cap</span></div></div></div>
    <div className="agent-grid">{agents.map(([name, Icon, phase]) => { const status = statuses.find((item) => item.label === name); const execution = status?.execution ?? 'UNCONFIGURED'; const readyAgent = execution === 'READY'; return <div className="card agent-card" key={name}><div className="agent-card-top"><span className={`agent-big-icon ${readyAgent ? 'green' : 'purple'}`}><Icon size={19} /></span><span className={`agent-status ${readyAgent ? 'ready' : 'gated'}`}><i />{execution}</span><MoreHorizontal size={17} className="muted-icon" /></div><h3>{name}</h3><p>Prompt {status?.promptVersion ?? '1.0.0'} · language only · no write access.</p><div className="agent-card-footer"><span><LockKeyhole size={13} /> {phase} boundary</span><span className={`status-badge ${readyAgent ? 'green' : 'neutral'}`}>{status?.enabled === false ? 'Disabled' : execution}</span></div></div> })}</div>
  </PageLayout>
}

function RecommendationsPage({ recommendations, onEvidence, onDecide, onRefresh, onPhaseGate }: { recommendations: readonly Recommendation[]; onEvidence: () => void; onDecide: (id: string, decision: 'approve' | 'reject', expectedVersion: number) => Promise<void>; onRefresh: () => void; onPhaseGate: (phase: string, capability: string) => void }) {
  const pending = recommendations.filter((item) => item.status === 'PENDING')
  const modeledImpact = recommendations.reduce((sum, item) => sum + item.impactValue, 0)
  return <PageLayout eyebrow="AI employee · F4" title="Recommendations" description="Real deterministic signals with immutable evidence packs. AI language is optional and never supplies the numbers." actions={<><button className="button secondary" onClick={onEvidence}><Eye size={15} /> Evidence drawer</button><button className="button primary" onClick={onRefresh}><RefreshCw size={15} /> Refresh decisions</button></>}>
    <div className="recommendation-summary"><div><strong>{recommendations.length}</strong><span>recommendations returned</span></div><div className="summary-divider" /><div className="summary-stat"><span className="confidence-dot purple" /><strong>{pending.length}</strong><small>pending approval</small></div><div className="summary-stat"><span className="confidence-dot high" /><strong>{formatMoney(modeledImpact)}</strong><small>deterministic impact</small></div><div className="summary-spacer" /><span className="data-contract"><ShieldCheck size={14} /> F2 tenant-scoped API</span></div>
    {recommendations.length === 0 ? <EmptyState icon={WandSparkles} title="No recommendations returned yet" description="The F4 API is ready to list persisted decisions. Run analysis after the store snapshot and rules have real rows." action="View evidence contract" onAction={onEvidence} /> : <div className="recommendation-list">{recommendations.map((item) => <RecommendationCard key={item.id} recommendation={item} onEvidence={onEvidence} onDecide={onDecide} />)}</div>}
  </PageLayout>
}

function RecommendationCard({ recommendation, onEvidence, onDecide }: { recommendation: Recommendation; onEvidence: () => void; onDecide: (id: string, decision: 'approve' | 'reject', expectedVersion: number) => Promise<void> }) {
  return <article className="recommendation-card"><div className="recommendation-card-main"><div className="recommendation-card-top"><span className="agent-pill"><span />{recommendation.agent}</span><span className={`confidence-pill ${recommendation.confidenceLevel.toLowerCase()}`}><span />{recommendation.confidenceLevel}</span><span className="recommendation-time">{recommendation.status}</span></div><h3>{recommendation.title}</h3><p>{recommendation.reason}</p><div className="evidence-snippets"><span><Database size={13} /> Rule {recommendation.ruleId} · v1.0.0</span><span><ShieldCheck size={13} /> {recommendation.explanationStatus}</span>{recommendation.explanation && <span><MessageSquare size={13} /> {recommendation.explanation}</span>}</div></div><div className="recommendation-card-side"><span className="impact-label">{recommendation.impactLabel}</span><strong>{formatMoney(recommendation.impactValue, recommendation.currency)}</strong><button className="text-button" onClick={onEvidence}><Eye size={14} /> Evidence</button>{recommendation.status === 'PENDING' ? <div className="recommendation-actions"><button className="button reject" onClick={() => void onDecide(recommendation.id, 'reject', recommendation.version)}>Reject</button><button className="button approve" onClick={() => void onDecide(recommendation.id, 'approve', recommendation.version)}><Check size={14} /> Approve</button></div> : <span className="resolved-label"><CheckCircle2 size={14} />{recommendation.status}</span>}</div></article>
}

function AutomationPage({ context, onPhaseGate, onToast }: { context: WorkspaceContext; onPhaseGate: (phase: string, capability: string) => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [workflows, setWorkflows] = useState<readonly import('./api.js').WorkflowRecord[]>([])
  const refresh = () => { if (context.storeId) void fetchWorkflows(context.storeId).then(setWorkflows).catch((error: unknown) => onToast(errorMessage(error), 'error')) }
  useEffect(() => { refresh() }, [context.storeId])
  const create = async () => { if (!context.storeId) { onToast('Connect Shopify before creating a workflow.', 'info'); return } try { await createWorkflow({ id: crypto.randomUUID(), storeId: context.storeId, version: 1, nodes: [{ id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: ['action'] }, { id: 'action', type: 'action', config: { action: 'tag' }, next: [] }] }); onToast('Workflow draft created.', 'success'); refresh() } catch (error: unknown) { onToast(errorMessage(error), 'error') } }
  return <PageLayout eyebrow="Workflow design · F6" title="Automation" description="Build validated DAGs. Activation is immutable and every step is deduplicated before execution." actions={<><button className="button secondary" onClick={refresh}><RefreshCw size={15} /> Refresh</button><button className="button primary" onClick={() => void create()}><Plus size={15} /> New workflow</button></>}><div className="automation-mode"><span className="automation-mode-icon"><ShieldCheck size={21} /></span><div><strong>Manual mode is enforced</strong><p>High-risk actions still need an explicit approval; wait nodes resume on worker ticks.</p></div><span className="status-badge green">F6 active</span></div><section className="card canvas-card"><div className="canvas-toolbar"><div className="section-kicker"><Workflow size={14} /> Visual DAG builder</div><span className="canvas-toolbar-note">{workflows.length} real draft{workflows.length === 1 ? '' : 's'}</span><button className="button secondary" onClick={() => onPhaseGate('F6', 'Workflow activation')}><Play size={14} /> Activate safely</button></div><div className="dag-canvas"><DagNode title="Trigger" detail="manual · cron · webhook" icon={Radio} tone="blue" /><span className="dag-line" /><DagNode title="Condition" detail="YES / NO branch" icon={GitBranch} tone="purple" /><span className="dag-line" /><DagNode title="Action" detail="email · tag · wait" icon={Zap} tone="amber" /></div></section>{workflows.length === 0 ? <EmptyState icon={Workflow} title="No workflows yet" description={context.storeId ? 'Create a draft to send through server-side DAG validation.' : 'Connect a store before creating an automation.'} action="Create draft" onAction={() => void create()} /> : <div className="workflow-list-card">{workflows.map((workflow) => <div className="workflow-row" key={workflow.id}><span className="workflow-icon"><Workflow size={17} /></span><span className="workflow-copy"><strong>{workflow.id}</strong><small>Version {workflow.version} · {workflow.status ?? 'DRAFT'}</small></span><span className="status-badge neutral">{workflow.definitionHash ? 'Immutable' : 'Draft'}</span><button className="button secondary" onClick={() => void activateWorkflow(workflow.id).then(() => { onToast('Workflow activated with immutable hash.', 'success'); refresh() }).catch((error: unknown) => onToast(errorMessage(error), 'error'))}>Activate</button></div>)}</div>}</PageLayout>
}

function CampaignsPage({ context, onPhaseGate, onToast }: { context: WorkspaceContext; onPhaseGate: (phase: string, capability: string) => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [templates, setTemplates] = useState<readonly import('./api.js').CampaignTemplateRecord[]>([])
  const refresh = () => { void fetchCampaignTemplates().then(setTemplates).catch((error: unknown) => onToast(errorMessage(error), 'error')) }
  useEffect(() => { refresh() }, [])
  const create = async () => { try { await createCampaignTemplate({ id: crypto.randomUUID(), storeId: context.storeId ?? '', name: 'New compliant email', kind: 'EMAIL', subject: 'Hello {{customer.first_name}}', body: 'Your unsubscribe link: {{unsubscribe.url}}' }); onToast('Closed-variable template created.', 'success'); refresh() } catch (error: unknown) { onToast(errorMessage(error), 'error') } }
  return <PageLayout eyebrow="Marketing center · F6" title="Campaigns" description="Closed 11-variable templates, suppression checks, HMAC tracking, and merchant-owned sending." actions={<><button className="button secondary" onClick={refresh}><RefreshCw size={15} /> Refresh templates</button><button className="button primary" onClick={() => void create()}><Plus size={15} /> New template</button></>}><div className="campaign-hero"><div><div className="section-kicker"><span className="kicker-dot purple" /> Two-layer email flow</div><h2>System mail and merchant campaigns never share a sender.</h2><p>{context.storeId ? 'Templates are real API records. Sending requires verified merchant email and suppression approval.' : 'Connect a store before creating merchant campaign templates.'}</p></div><div className="campaign-hero-art"><Mail size={28} /><span>F6</span></div></div>{templates.length === 0 ? <EmptyState icon={Mail} title="No templates yet" description="Create a closed-variable email template. Invalid variables and missing unsubscribe links fail honestly on the server." action="Create template" onAction={() => void create()} /> : <div className="template-grid">{templates.map((template) => <div className="card template-card" key={template.id}><span className="export-icon purple"><Mail size={18} /></span><h3>{template.name}</h3><p>{template.subject}</p><div className="template-footer"><span>{template.variables.length} variables · {template.kind}</span><button className="button secondary" onClick={() => onToast('Verify merchant email before campaign sending.', 'info')}>Send safely</button></div></div>)}</div>}</PageLayout>
}

function CopilotPage({ onPhaseGate }: { onPhaseGate: (phase: string, capability: string) => void }) { const [query, setQuery] = useState(''); return <PageLayout eyebrow="Advanced query" title="Copilot" description="A closed-intent grammar will answer from evidence packs once F8 is implemented." actions={<button className="button secondary"><Clock3 size={15} /> Thread history</button>}><div className="copilot-layout"><section className="copilot-main"><div className="copilot-welcome"><span className="copilot-orb"><Sparkles size={22} /></span><div><div className="section-kicker">10 SUPPORTED INTENTS · F8</div><h2>Ask a grounded question.</h2><p>There are no generated answers in this phase.</p></div></div><div className="copilot-empty"><Database size={24} /><strong>Copilot is not answering yet</strong><span>F8 will connect closed grammar intents to real evidence tables.</span><button className="button secondary" onClick={() => onPhaseGate('F8', 'Copilot answer generation')}><LockKeyhole size={14} /> View gate</button></div><div className="copilot-composer"><div className="composer-label"><span><Command size={13} /> Try a future intent</span><span>Numbers will come from F2 tables</span></div><div className="composer-input"><textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Why did sales change this week?" rows={2} /><button className="send-button" disabled={!query.trim()} onClick={() => onPhaseGate('F8', 'Copilot answer generation')}><ArrowUpRight size={16} /></button></div><div className="suggested-prompts"><button onClick={() => setQuery('Which products are at stockout risk?')}>Stockout risk</button><button onClick={() => setQuery('What changed in revenue?')}>Revenue change</button></div></div></section><aside className="card copilot-sidebar"><CardHeading kicker="Thread history" dot="blue" title="No questions yet" /><EmptySmall icon={MessageSquare} text="F8 threads are not created yet." /></aside></div></PageLayout> }

function ReportsPage({ onPhaseGate }: { onPhaseGate: (phase: string, capability: string) => void }) { return <PageLayout eyebrow="Reporting shell" title="Reports" description="Report vault and scheduling will only render closed-period PDFs from F8." actions={<button className="button primary" onClick={() => onPhaseGate('F8', 'PDF report generation')}><Plus size={15} /> Generate report</button>}><div className="report-banner"><span className="report-banner-icon"><FileBarChart size={22} /></span><div><div className="section-kicker">DETERMINISTIC PDF VAULT</div><h2>Reporting is not enabled yet.</h2><p>F8 will add closed periods, R2 storage, and idempotent delivery.</p></div><span className="phase-tag">F8</span></div><EmptyState icon={FileText} title="No reports generated" description="There are no placeholder PDFs in this vault. Generate reports after the F8 reporting package is implemented." action="View F8 boundary" onAction={() => onPhaseGate('F8', 'PDF report generation')} /></PageLayout> }

function ExportsPage({ context }: { context: WorkspaceContext }) {
  const [message, setMessage] = useState<string | null>(null)
  const runExport = async (format: 'CSV' | 'XLSX' | 'PDF') => { try { const result = await exportRows(format, []); setMessage(`${result.filename} is ready (${result.rows} rows).`); } catch (error: unknown) { setMessage(errorMessage(error)) } }
  const exportTypes: ReadonlyArray<{ title: string; icon: LucideIcon; format: 'CSV' | 'XLSX' | 'PDF' }> = [{ title: 'Orders export', icon: ShoppingBag, format: 'CSV' }, { title: 'Catalog export', icon: Package, format: 'XLSX' }, { title: 'Audit log export', icon: ShieldCheck, format: 'CSV' }, { title: 'Revenue report', icon: FileBarChart, format: 'PDF' }]
  return <PageLayout eyebrow="Data portability · F6" title="Exports" description="Custom CSV, XLSX, and PDF writers with a 50,000-row ceiling and no heavy export library." actions={<button className="button secondary" onClick={() => setMessage(context.storeId ? 'Export history is stored per store.' : 'Connect a store before exporting.') }><Clock3 size={15} /> Export history</button>}><div className="export-intro"><div><div className="section-kicker"><span className="kicker-dot blue" /> Background writers</div><h2>{context.storeId ? 'Choose a real dataset to export.' : 'Connect a store before exporting.'}</h2><p>Writers are API-backed; the empty-row response is shown only until a store query is supplied.</p></div><span className="export-limit"><strong>50,000</strong><small>row ceiling</small></span></div>{message && <div className="sync-banner"><CheckCircle2 size={15} /><span>{message}</span></div>}<div className="export-grid">{exportTypes.map(({ title, icon: Icon, format }) => <div className="card export-card" key={title}><span className="export-icon blue"><Icon size={20} /></span><h3>{title}</h3><p>Real writer: {format}. Rows remain tenant-scoped.</p><div className="export-card-bottom"><span>{format}</span><button className="button secondary" onClick={() => void runExport(format)}>Generate</button></div></div>)}</div></PageLayout>
}

function SupportPage({ context, onToast }: { context: WorkspaceContext; onToast: (message: string, kind?: ToastKind) => void }) {
  const [tickets, setTickets] = useState<readonly import('./api.js').TicketRecord[]>([])
  const refresh = () => { if (context.storeId) void fetchTickets(context.storeId).then(setTickets).catch((error: unknown) => onToast(errorMessage(error), 'error')) }
  useEffect(() => { refresh() }, [context.storeId])
  const create = async () => { if (!context.storeId) { onToast('Connect Shopify before opening a ticket.', 'info'); return } try { await createTicket(context.storeId, 'New merchant question', 'growth'); onToast('Support ticket created.', 'success'); refresh() } catch (error: unknown) { onToast(errorMessage(error), 'error') } }
  return <PageLayout eyebrow="Operator inbox · F6" title="Support tickets" description="Merchant ↔ operator threads with auditable status, priority, and versioned updates." actions={<button className="button primary" onClick={() => void create()}><Plus size={15} /> New ticket</button>}><div className="support-hero"><span className="support-hero-icon"><LifeBuoy size={22} /></span><div><div className="section-kicker">THREAD LEDGER</div><h2>{tickets.length ? `${tickets.length} real ticket${tickets.length === 1 ? '' : 's'}` : 'No open tickets.'}</h2><p>{context.storeId ? 'Ticket status and priority are read from the F6 support API.' : 'Connect a store before opening an auditable ticket.'}</p></div><span className="support-sla"><strong>24h</strong><small>Growth response target</small></span></div>{tickets.length === 0 ? <EmptyState icon={Inbox} title="Your support inbox is clear" description="Create a ticket when there is a real question for the ProfitPilot team." action="New ticket" onAction={() => void create()} /> : <div className="ticket-list-card">{tickets.map((ticket) => <div className="ticket-row" key={ticket.id}><span className="ticket-icon"><TicketCheck size={16} /></span><span><strong>{ticket.subject}</strong><small>{ticket.priority} · {ticket.status} · version {ticket.version}</small></span><span className="status-badge neutral">{ticket.status}</span></div>)}</div>}</PageLayout>
}

function BillingPage({ context, onPhaseGate, onToast }: { context: WorkspaceContext; onPhaseGate: (phase: string, capability: string) => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [plans, setPlans] = useState<readonly import('./model.js').BillingPlan[]>([])
  const [account, setAccount] = useState<import('./model.js').BillingAccount | null>(null)
  const [usage, setUsage] = useState<readonly import('./model.js').UsageMeter[]>([])
  const [roi, setRoi] = useState<import('./model.js').RoiMetrics | null>(null)
  const [giftCode, setGiftCode] = useState('')
  useEffect(() => {
    void fetchBillingPlans().then(setPlans).catch(() => setPlans([]))
    if (!context.storeId) return
    void Promise.allSettled([fetchBilling(context.storeId), fetchBillingUsage(context.storeId), fetchBillingRoi(context.storeId)]).then(([billing, meter, returnOnAi]) => {
      if (billing.status === 'fulfilled') setAccount(billing.value)
      if (meter.status === 'fulfilled') setUsage(meter.value)
      if (returnOnAi.status === 'fulfilled') setRoi(returnOnAi.value)
    })
  }, [context.storeId])
  const startCharge = async (plan: 'START' | 'GROWTH' | 'COMMANDER') => {
    if (!context.storeId) { onToast('Connect Shopify before choosing a plan.', 'info'); return }
    try { const charge = await createBillingCharge(context.storeId, plan, 'MONTHLY', window.location.origin + '/billing'); if (charge.confirmationUrl) window.location.assign(charge.confirmationUrl); else onToast('Charge created without a confirmation URL.', 'warning') } catch (error: unknown) { onToast(errorMessage(error), 'error') }
  }
  const redeem = async () => { if (!context.storeId || !giftCode.trim()) return; try { await redeemGiftCode(context.storeId, giftCode); onToast('Gift access redeemed for this store.', 'success'); setGiftCode('') } catch (error: unknown) { onToast(errorMessage(error), 'error') } }
  return <PageLayout eyebrow="Entitlements · F5" title="Billing" description="Plan, quota, and ROI values are loaded from the real billing API. Suspended stores keep read-only access." actions={<button className="button secondary" onClick={() => onPhaseGate('F5', 'Billing reconciliation')}>{context.storeId ? 'Refresh billing' : 'Connect Shopify'} <RefreshCw size={14} /></button>}>
    {!context.storeId ? <EmptyState icon={WalletCards} title="Connect Shopify to view billing" description="Billing never assumes a plan. Complete the signed install flow to load a real subscription." action="Connect from Settings" onAction={() => onToast('Open the Shopify install flow from the workspace context.', 'info')} /> : <>
      <div className="billing-current"><div className="billing-plan"><span className="plan-icon"><WalletCards size={19} /></span><div><div className="section-kicker">CURRENT PLAN</div><h2>{account?.subscription ? `${account.subscription.plan} · ${account.subscription.state}` : account?.trial ? '14-day limited trial' : 'No subscription loaded'}</h2><p>{account?.subscription?.currentPeriodEnd ? `Current period ends ${new Date(account.subscription.currentPeriodEnd).toLocaleDateString()}.` : 'No plan is invented before the billing repository returns it.'}</p></div><span className={`status-badge ${account?.subscription ? 'green' : 'neutral'}`}>{account?.subscription?.state ?? 'Unknown'}</span></div></div>
      <div className="billing-grid"><section className="card usage-panel"><CardHeading kicker="Usage meters" dot="blue" title="Current period" />{usage.length ? usage.map((meter) => <Quota key={meter.feature} label={meter.feature} value={`${meter.used}${meter.limit === null ? '' : ` / ${meter.limit}`}`} percent={meter.limit ? Math.min(100, meter.used / meter.limit * 100) : 0} />) : <EmptySmall icon={Gauge} text="No usage rows returned yet." />}</section><section className="card roi-panel"><CardHeading kicker="Return on AI" dot="gold" title="Verified attribution" />{roi ? <div className="roi-live"><strong>{formatMoney(roi.attributedRevenue)}</strong><span>AI-attributed revenue</span><div className="roi-breakdown"><MetricLine label="AI operational cost" value={formatMoney(roi.aiCostDollars)} /><MetricLine label="Net return" value={formatMoney(roi.netReturn)} /><MetricLine label="Multiple" value={roi.multiple === null ? '—' : `${roi.multiple.toFixed(1)}×`} /></div></div> : <EmptySmall icon={Sparkles} text="No ROI row returned yet." />}</section></div>
      <section className="card gift-panel"><div><div className="section-kicker"><Tag size={13} /> GIFT ACCESS</div><h3>Have a gift code?</h3><p>One store can redeem one code. Redemption replaces the limited trial.</p></div><div className="gift-input"><input value={giftCode} onChange={(event) => setGiftCode(event.target.value.toUpperCase())} placeholder="KASSAR786" /><button className="button secondary" onClick={() => void redeem()} disabled={!giftCode.trim()}>Redeem</button></div></section>
      <div className="plan-comparison"><div className="section-kicker"><span className="kicker-dot purple" /> AVAILABLE PLANS</div><h2>Choose the level of autonomy you need.</h2><div className="plan-cards">{plans.map((plan) => <div className={`plan-card ${account?.subscription?.plan === plan.tier ? 'current' : ''}`} key={plan.code}><h3>{plan.code}</h3><div className="plan-price"><strong>${plan.monthlyPrice}</strong><span>/month</span></div><p>${plan.annualPrice}/year · {plan.annualMonthsFree} months free</p><button className="button primary" onClick={() => void startCharge(plan.code)}>{account?.subscription?.plan === plan.tier ? 'Current plan' : 'Choose plan'} <ArrowUpRight size={14} /></button></div>)}</div></div>
    </>}
  </PageLayout>
}

function SettingsPage({ context, lightMode, onTheme, onToast }: { context: WorkspaceContext; lightMode: boolean; onTheme: () => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [email, setEmail] = useState(''); const [fromName, setFromName] = useState(''); const [verificationToken, setVerificationToken] = useState(''); const [verified, setVerified] = useState(false)
  const saveEmail = async () => { if (!context.storeId) { onToast('Connect Shopify before configuring merchant email.', 'info'); return } try { const result = await saveMerchantEmail(context.storeId, email, fromName); setVerificationToken(result.verificationToken); onToast('Verification token created. Verify before campaigns send.', 'success') } catch (error: unknown) { onToast(errorMessage(error), 'error') } }
  const verifyEmail = async () => { try { await verifyMerchantEmail(verificationToken); setVerified(true); onToast('Merchant email verified.', 'success') } catch (error: unknown) { onToast(errorMessage(error), 'error') } }
  return <PageLayout eyebrow="Workspace controls · F6" title="Settings" description="Store context, merchant-owned campaign identity, and accessibility preferences."><div className="settings-layout"><aside className="settings-nav card"><button className="settings-nav-item active"><Settings size={15} /> General</button><button className="settings-nav-item"><Bell size={15} /> Notifications</button><button className="settings-nav-item"><Bot size={15} /> Jarvis preferences</button><button className="settings-nav-item"><Users size={15} /> Team members</button><button className="settings-nav-item"><ShieldCheck size={15} /> Security & audit</button><button className="settings-nav-item danger"><Trash2 size={15} /> Danger zone</button></aside><div className="settings-panels"><SettingsPanel title="Store context" description="The UI reads this context from the embedded Shopify URL and F2 API."><SettingRow label="Shopify store" description="No store name is fabricated"><span className="setting-readonly">{context.shop ?? 'Not provided'}</span></SettingRow><SettingRow label="Tenant id" description="Used for tenant-scoped F2 requests"><span className="setting-readonly mono">{context.storeId ?? 'Not provided'}</span></SettingRow></SettingsPanel><SettingsPanel title="Merchant campaign email" description="Campaigns never send from ProfitPilot system email. Verification is required."><SettingRow label="Merchant email" description="The From address for customer campaigns"><input className="setting-input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="merchant@example.com" /></SettingRow><SettingRow label="From name" description="Shown to campaign recipients"><input className="setting-input" value={fromName} onChange={(event) => setFromName(event.target.value)} placeholder="Your store" /></SettingRow><div className="email-verification-row"><span className={`status-badge ${verified ? 'green' : 'amber'}`}>{verified ? 'Verified' : 'Verification required'}</span><button className="button secondary" onClick={() => void saveEmail()} disabled={!email || !fromName}>Save and verify</button>{verificationToken && !verified && <button className="button primary" onClick={() => void verifyEmail()}>Confirm verification</button>}</div></SettingsPanel><SettingsPanel title="Appearance" description="Dark mode is the default ProfitPilot surface."><SettingRow label="Theme" description="Optional light mode for daytime work"><div className="theme-choice"><button className={!lightMode ? 'selected' : ''} onClick={() => lightMode && onTheme()}><Moon size={15} /> Dark</button><button className={lightMode ? 'selected' : ''} onClick={() => !lightMode && onTheme()}><Sun size={15} /> Light</button></div></SettingRow><SettingRow label="Reduced motion" description="Respect the operating system preference"><Toggle on={false} /></SettingRow></SettingsPanel><div className="settings-save"><span><ShieldCheck size={15} /> F6 merchant identity is explicit</span><button className="button primary" onClick={() => onToast('Preferences are saved locally for this shell.', 'success')}>Save preferences</button></div></div></div></PageLayout>
}

function PageLayout({ eyebrow, title, description, actions, children }: { eyebrow: ReactNode; title: string; description: string; actions?: ReactNode; children: ReactNode }) { return <div className="page-content"><div className="page-header"><div><div className="page-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>{children}</div> }

function CardHeading({ kicker, dot, title, action }: { kicker: string; dot: string; title: string; action?: ReactNode }) { return <div className="card-heading"><div><div className="section-kicker"><span className={`kicker-dot ${dot}`} />{kicker}</div><h3>{title}</h3></div>{action ?? <MoreHorizontal size={18} className="muted-icon" />}</div> }
function MetricCard({ label, value, detail, icon: Icon, tone, gated }: { label: string; value: string; detail: string; icon: LucideIcon; tone: string; gated?: boolean }) { return <div className="card stat-card"><div className="stat-top"><span className={`stat-icon ${tone}`}><Icon size={17} /></span>{gated ? <span className="phase-tag">F4</span> : <span className="data-mark"><CheckCircle2 size={13} /></span>}</div><div className="stat-value">{value}</div><div className="stat-bottom"><span>{label}<small>{detail}</small></span></div></div> }
function MiniMetric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) { return <div className="card mini-metric"><span className={`mini-metric-icon ${tone}`}><span /></span><div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div></div> }
function HealthGauge({ hasData }: { hasData: boolean }) { return <div className={`health-gauge ${hasData ? 'has-data' : 'no-data'}`}><div className="gauge-inner"><strong>{hasData ? '—' : '—'}</strong><span>{hasData ? 'FORMULA' : 'NO DATA'}</span></div></div> }
function HealthLine({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className="health-item"><span><i className={`status-dot ${tone}`} />{label}</span><strong className={tone}>{value}</strong></div> }
function ChartSkeleton() { return <div className="chart-skeleton" aria-label="Loading chart"><span /><span /><span /><span /><span /></div> }
function AreaChart({ values }: { values: readonly number[] }) { const max = Math.max(...values, 1); const min = Math.min(...values, 0); const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 100},${92 - ((value - min) / Math.max(max - min, 1)) * 78}`).join(' '); return <div className="revenue-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Revenue trend"><defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#3B82F6" stopOpacity=".3" /><stop offset="100%" stopColor="#3B82F6" stopOpacity="0" /></linearGradient></defs>{[16, 40, 64, 88].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} className="chart-grid-line" />)}<polygon points={`0,100 ${points} 100,100`} fill="url(#areaFill)" /><polyline points={points} fill="none" stroke="#5994FF" strokeWidth="1.7" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /></svg><div className="chart-y-labels"><span>High</span><span>Mid</span><span>Low</span></div><div className="chart-x-labels"><span>Oldest</span><span>Recent</span></div></div> }
function EmptyChart({ onSync }: { onSync: () => void }) { return <div className="empty-chart"><LineChart size={24} /><strong>No closed-period analytics yet</strong><span>Run a real sync to draw this chart.</span><button className="text-button" onClick={onSync}><RefreshCw size={14} /> Sync data</button></div> }
function EmptyState({ icon: Icon, title, description, action, onAction }: { icon: LucideIcon; title: string; description: string; action: string; onAction: () => void }) { return <div className="empty-state"><span className="empty-icon"><Icon size={22} /></span><h3>{title}</h3><p>{description}</p><button className="button secondary" onClick={onAction}>{action} <ArrowUpRight size={14} /></button></div> }
function EmptySmall({ icon: Icon, text }: { icon: LucideIcon; text: string }) { return <div className="empty-small"><Icon size={18} /><span>{text}</span></div> }
function InsightItem({ icon: Icon, title, detail, tone }: { icon: LucideIcon; title: string; detail: string; tone: string }) { return <div className="insight-item"><span className={`insight-icon ${tone}`}><Icon size={16} /></span><span><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={15} /></div> }
function MetricLine({ label, value }: { label: string; value: string }) { return <div className="metric-line"><span>{label}</span><strong>{value}</strong></div> }
function Quota({ label, value, percent }: { label: string; value: string; percent: number }) { return <div className="quota"><div><span>{label}</span><strong>{value}</strong></div><div className="usage-track"><span style={{ width: `${percent}%` }} /></div></div> }
function Toggle({ on }: { on: boolean }) { return <span className={`toggle ${on ? 'on' : ''}`}><span /></span> }
function SettingRow({ label, description, children }: { label: string; description: string; children: ReactNode }) { return <div className="setting-row"><div><strong>{label}</strong><small>{description}</small></div>{children}</div> }
function SettingsPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <section className="card settings-panel"><div className="settings-panel-head"><h3>{title}</h3><p>{description}</p></div>{children}</section> }
function DagNode({ title, detail, icon: Icon, tone }: { title: string; detail: string; icon: LucideIcon; tone: string }) { return <div className="dag-node"><span className={`dag-node-icon ${tone}`}><Icon size={17} /></span><strong>{title}</strong><small>{detail}</small></div> }
function ProfileMenu({ lightMode, onTheme, onClose, onSettings }: { lightMode: boolean; onTheme: () => void; onClose: () => void; onSettings: () => void }) { return <div className="profile-menu"><div className="profile-menu-head"><span className="profile-avatar large">PP</span><span><strong>ProfitPilot</strong><small>Foundation workspace</small></span></div><button onClick={onSettings}><Settings size={15} /> Settings</button><button onClick={onTheme}>{lightMode ? <Sun size={15} /> : <Moon size={15} />} {lightMode ? 'Dark mode' : 'Light mode'}</button><button onClick={onClose}><LockKeyhole size={15} /> Security boundary</button></div> }
function OfflineBanner({ error, onRetry }: { error: string | null; onRetry: () => void }) { return <div className="offline-banner"><CloudOff size={16} /><span><strong>F2 API unavailable</strong>{error ? ` · ${error}` : ' · Showing empty states, never demo data.'}</span><button onClick={onRetry}><RotateCcw size={14} /> Retry</button></div> }
function ContextBanner({ onConnect }: { onConnect: () => void }) { return <div className="context-banner"><span className="context-banner-icon"><Server size={16} /></span><span><strong>No Shopify store context detected.</strong> Open the install flow to attach a real tenant before syncing.</span><button onClick={onConnect}>Connect Shopify <ArrowUpRight size={13} /></button></div> }
function JarvisOrb({ onClick }: { onClick: () => void }) { return <button className="jarvis-orb-wrap" onClick={onClick} aria-label="Open Jarvis shell"><span className="jarvis-orb-ring ring-a" /><span className="jarvis-orb-ring ring-b" /><span className="jarvis-orb"><span className="orb-core" /><span className="orb-shine" /></span><span className="jarvis-orb-label">Jarvis · F8</span></button> }
function JarvisPanel({ onClose, onPhaseGate }: { onClose: () => void; onPhaseGate: (phase: string, capability: string) => void }) { return <aside className="jarvis-panel"><div className="jarvis-panel-header"><div className="jarvis-title"><span className="jarvis-mini-orb"><span /></span><span><strong>Jarvis</strong><small>AI assistant shell</small></span><span className="phase-tag">F8</span></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="jarvis-context"><span><Radio size={13} /> Background shell</span><span>Phase-gated</span></div><div className="jarvis-messages"><div className="jarvis-message"><span className="message-orb"><Sparkles size={12} /></span><p>I’m present as the Jarvis interface. I will not invent a store answer before the F8 copilot and voice engine exist.</p></div></div><div className="jarvis-suggestions"><button onClick={() => onPhaseGate('F8', 'Jarvis responses')}>Ask about revenue</button><button onClick={() => onPhaseGate('F8', 'Jarvis voice control')}>Start voice mode</button></div><div className="jarvis-composer"><textarea disabled placeholder="Jarvis responses are gated to F8…" rows={2} /><div className="jarvis-composer-actions"><button className="icon-button" disabled><Mic size={16} /></button><span>F8 response engine</span><button className="send-button" onClick={() => onPhaseGate('F8', 'Jarvis chat responses')}><ArrowUpRight size={16} /></button></div></div><div className="jarvis-panel-footer"><span><ShieldCheck size={12} /> PII-safe contract reserved</span><button onClick={onClose}>Close</button></div></aside> }
function EvidenceDrawer({ recommendation, onClose }: { recommendation: Recommendation | null; onClose: () => void }) {
  const hash = recommendation && typeof recommendation.evidencePack.sha256 === 'string' ? recommendation.evidencePack.sha256 : null
  return <><button className="drawer-backdrop" onClick={onClose} aria-label="Close evidence drawer" /><aside className="evidence-drawer"><div className="drawer-header"><div><span className="drawer-kicker"><Database size={13} /> IMMUTABLE EVIDENCE PACK</span><h2>{recommendation ? recommendation.title : 'No evidence yet'}</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="drawer-scroll">{recommendation ? <><div className="drawer-hero"><span>{recommendation.impactLabel}</span><strong>{formatMoney(recommendation.impactValue, recommendation.currency)}</strong><small>Deterministic rule output · {recommendation.ruleId}</small></div><div className="drawer-section"><div className="drawer-section-title"><ShieldCheck size={15} /> Proof and status</div><div className="evidence-stack"><div className="evidence-line"><span>01</span><strong>{recommendation.reason}</strong><CheckCircle2 size={15} /></div><div className="evidence-line"><span>02</span><strong>Confidence: {recommendation.confidenceLevel}</strong><CheckCircle2 size={15} /></div><div className="evidence-line"><span>03</span><strong className="mono">SHA-256: {hash ?? 'unavailable'}</strong><CheckCircle2 size={15} /></div></div></div><div className="drawer-section"><div className="drawer-section-title"><LockKeyhole size={15} /> Action safety</div><div className="safety-list"><span><Check size={14} /> {recommendation.actionRisk.replaceAll('_', ' ')} policy</span><span><Check size={14} /> CAS approval version {recommendation.version}</span><span><Check size={14} /> AI language: {recommendation.explanationStatus}</span></div></div></> : <div className="gated-panel"><LockKeyhole size={22} /><strong>No persisted evidence packs</strong><p>Run F4 analysis after the store snapshot is available. The UI will never fabricate evidence.</p></div>}</div><div className="drawer-footer"><button className="button secondary" onClick={onClose}>Close</button></div></aside></>
}

function NotificationDrawer({ onClose }: { onClose: () => void }) { return <><button className="drawer-backdrop" onClick={onClose} aria-label="Close notifications" /><aside className="notification-drawer"><div className="drawer-header"><div><span className="drawer-kicker"><Bell size={13} /> NOTIFICATIONS</span><h2>No new notifications</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="notification-empty"><Bell size={22} /><strong>Quiet by default</strong><span>Real sync and F2 notifications will appear here. Nothing is fabricated.</span></div><button className="text-button full" onClick={onClose}>Close drawer <X size={14} /></button></aside></> }
function CommandPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate: (page: SectionId) => void }) { const [query, setQuery] = useState(''); const results = navGroups.flatMap((group) => group.items).filter((item) => item.label.toLowerCase().includes(query.toLowerCase())).slice(0, 10); return <div className="command-overlay"><button className="command-overlay-close" onClick={onClose} aria-label="Close command palette" /><div className="command-panel"><div className="command-input-wrap"><Search size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sections…" /><kbd>ESC</kbd></div><div className="command-results"><span className="command-section-label">Navigate</span>{results.map((item) => { const Icon = item.icon; return <button key={item.id} className="command-result" onClick={() => onNavigate(item.id)}><span className="command-result-icon"><Icon size={16} /></span><span>{item.label}</span>{item.tag && <small>{item.tag}</small>}<ChevronRight size={15} /></button> })}{results.length === 0 && <div className="command-empty"><Search size={20} /><strong>No matching section</strong><span>Try Dashboard, Analytics, or Settings.</span></div>}</div><div className="command-footer"><span><ArrowUpRight size={13} /> Open</span><span><ChevronDown size={13} /> Navigate</span><span><kbd>ESC</kbd> Close</span></div></div></div> }
function OnboardingModal({ onClose }: { onClose: () => void }) { const [shop, setShop] = useState(''); const [error, setError] = useState<string | null>(null); const connect = () => { const normalized = shop.trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) { setError('Enter a valid *.myshopify.com domain.'); return } window.location.assign(`/shopify/install?shop=${encodeURIComponent(normalized)}`) }; return <div className="modal-overlay"><div className="modal-card onboarding-modal"><div className="modal-icon"><ShoppingBag size={21} /></div><div className="section-kicker">F1 · SHOPIFY INSTALL</div><h2>Connect your real store</h2><p>ProfitPilot will start the signed OAuth flow. No demo workspace is created.</p><label>Shopify domain<input autoFocus value={shop} onChange={(event) => setShop(event.target.value)} placeholder="your-store.myshopify.com" /></label>{error && <div className="form-error"><AlertCircle size={14} />{error}</div>}<div className="modal-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" onClick={connect}>Continue to Shopify <ArrowUpRight size={14} /></button></div></div></div> }
function ShortcutsModal({ onClose }: { onClose: () => void }) { return <div className="modal-overlay"><div className="modal-card shortcuts-modal"><div className="modal-card-top"><div><div className="section-kicker"><Keyboard size={13} /> KEYBOARD SHORTCUTS</div><h2>Move with intention.</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><Shortcut keys="⌘ K" label="Open command palette" /><Shortcut keys="?" label="Open keyboard shortcuts" /><Shortcut keys="ESC" label="Close the active drawer or modal" /><Shortcut keys="⌘ /" label="Search the current section" /><button className="button primary full-width" onClick={onClose}>Done</button></div></div> }
function Shortcut({ keys, label }: { keys: string; label: string }) { return <div className="shortcut-row"><kbd>{keys}</kbd><span>{label}</span><Check size={14} /></div> }
function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) { const Icon = toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? AlertCircle : Info; return <div className={`toast ${toast.kind}`}><span className="toast-icon"><Icon size={16} /></span><span>{toast.message}</span><button onClick={onClose} aria-label="Close notification"><X size={15} /></button></div> }
function stringValue(value: JsonValue | undefined): string | null { return typeof value === 'string' ? value : null }
function numberValue(value: JsonValue | undefined): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function errorMessage(error: unknown): string { if (error instanceof ApiClientError) return error.message; if (error instanceof Error) return error.message; return 'The F2 API could not be reached.' }
function isTypingTarget(target: EventTarget | null): boolean { return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement }
