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
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Clock3,
  Command,
  CreditCard,
  Database,
  Download,
  Eye,
  FileBarChart,
  FileText,
  Filter,
  Gauge,
  Gift,
  Globe2,
  Inbox,
  Info,
  LayoutDashboard,
  LifeBuoy,
  LineChart,
  ListFilter,
  LockKeyhole,
  Mail,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Target,
  TicketCheck,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserCircle,
  UserPlus,
  Users,
  WalletCards,
  WandSparkles,
  Workflow,
  X,
  Mic,
  Volume2,
  Moon,
  Sun,
  Zap,
  Rows3,
  Radio,
  ExternalLink,
  RotateCcw,
  Timer,
} from 'lucide-react'

export type PageKey =
  | 'dashboard'
  | 'products'
  | 'orders'
  | 'customers'
  | 'inventory'
  | 'analytics'
  | 'command-center'
  | 'recommendations'
  | 'automation'
  | 'campaigns'
  | 'copilot'
  | 'reports'
  | 'exports'
  | 'support'
  | 'billing'
  | 'settings'

type ToastKind = 'success' | 'info' | 'warning'
type Confidence = 'high' | 'medium' | 'low'
type RecommendationStatus = 'Needs review' | 'Approved' | 'Rejected'

type NavItem = {
  id: PageKey
  label: string
  icon: LucideIcon
  badge?: string
}

type Recommendation = {
  id: string
  agent: string
  agentColor: string
  title: string
  description: string
  impact: string
  impactLabel: string
  confidence: Confidence
  status: RecommendationStatus
  evidence: string[]
  action: string
  time: string
}

type ToastState = {
  message: string
  kind: ToastKind
}

const navGroups: { label: string; items: NavItem[] }[] = [
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
      { id: 'command-center', label: 'AI Command Center', icon: Bot, badge: '7' },
      { id: 'recommendations', label: 'Recommendations', icon: WandSparkles, badge: '4' },
      { id: 'automation', label: 'Automation', icon: Workflow },
      { id: 'campaigns', label: 'Campaigns', icon: Send },
      { id: 'copilot', label: 'Copilot', icon: Sparkles },
    ],
  },
  {
    label: 'Business',
    items: [
      { id: 'reports', label: 'Reports', icon: FileBarChart },
      { id: 'exports', label: 'Exports', icon: Download },
      { id: 'support', label: 'Support tickets', icon: LifeBuoy, badge: '2' },
      { id: 'billing', label: 'Billing', icon: CreditCard },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
]

const pageMeta: Record<PageKey, { title: string; description: string; icon: LucideIcon }> = {
  dashboard: { title: 'Dashboard', description: 'Your store, distilled into the decisions that matter.', icon: LayoutDashboard },
  products: { title: 'Products', description: 'Understand what is moving, stalling, and worth improving.', icon: Package },
  orders: { title: 'Orders', description: 'Track fulfillment, customer context, and AI-attributed revenue.', icon: ShoppingBag },
  customers: { title: 'Customers', description: 'Turn customer signals into timely, thoughtful actions.', icon: Users },
  inventory: { title: 'Inventory', description: 'Stay ahead of stockouts and unlock cash tied up in dead stock.', icon: Box },
  analytics: { title: 'Analytics', description: 'See the trend beneath the number with deterministic store data.', icon: LineChart },
  'command-center': { title: 'AI Command Center', description: 'A live view of every AI employee working for your store.', icon: Bot },
  recommendations: { title: 'Recommendations', description: 'Evidence-backed decisions waiting for your approval.', icon: WandSparkles },
  automation: { title: 'Automation', description: 'Build safe, observable workflows that run while you sleep.', icon: Workflow },
  campaigns: { title: 'Campaigns', description: 'Create compliant campaigns with revenue attribution built in.', icon: Send },
  copilot: { title: 'Copilot', description: 'Ask a question. Get a grounded answer with the evidence beside it.', icon: Sparkles },
  reports: { title: 'Reports', description: 'A reliable operating rhythm for your revenue team.', icon: FileBarChart },
  exports: { title: 'Exports', description: 'Take your store data with you, on your terms.', icon: Download },
  support: { title: 'Support tickets', description: 'A direct, auditable line to the ProfitPilot team.', icon: LifeBuoy },
  billing: { title: 'Billing', description: 'Keep your plan, usage, and return on AI in one place.', icon: CreditCard },
  settings: { title: 'Settings', description: 'Tune your workspace, team, notifications, and Jarvis.', icon: Settings },
}

const recommendationsSeed: Recommendation[] = [
  {
    id: 'rec-1',
    agent: 'Customer Agent',
    agentColor: '#a78bfa',
    title: 'Win back 38 high-value customers',
    description: 'Customers with an average lifetime value of $189 have been inactive for 75+ days.',
    impact: '$7,182',
    impactLabel: 'potential recovery',
    confidence: 'high',
    status: 'Needs review',
    evidence: ['38 customers · $189 avg. LTV', '75–92 days since last order', '31% historical win-back rate'],
    action: 'Review win-back campaign',
    time: '8 min ago',
  },
  {
    id: 'rec-2',
    agent: 'Inventory Agent',
    agentColor: '#38bdf8',
    title: 'Reorder Premium Hoodie before Friday',
    description: 'At the current 14-day velocity, SKU PH-04 will reach zero available units in 4 days.',
    impact: '4 days',
    impactLabel: 'until stockout',
    confidence: 'high',
    status: 'Needs review',
    evidence: ['18 units available · 4.5/day velocity', '23% week-over-week demand lift', 'Supplier lead time: 9 days'],
    action: 'Review inventory action',
    time: '21 min ago',
  },
  {
    id: 'rec-3',
    agent: 'Revenue Agent',
    agentColor: '#fbbf24',
    title: 'Recover abandoned checkouts',
    description: 'A gentle reminder to 84 recent high-intent shoppers could recover missed revenue.',
    impact: '$3,406',
    impactLabel: 'expected revenue',
    confidence: 'medium',
    status: 'Needs review',
    evidence: ['84 checkouts in the last 48h', '$40.55 average checkout value', '11% modeled recovery rate'],
    action: 'Review recovery draft',
    time: '42 min ago',
  },
  {
    id: 'rec-4',
    agent: 'Pricing Agent',
    agentColor: '#fb7185',
    title: 'Test a bundle on the Everyday Tee',
    description: 'Pairing the tee with the Everyday Cap may lift basket value without changing item price.',
    impact: '+8.4%',
    impactLabel: 'modeled AOV lift',
    confidence: 'medium',
    status: 'Needs review',
    evidence: ['Tee appears in 42% of orders', 'Cap co-purchase rate: 6.8%', 'Margin remains above 64%'],
    action: 'Review bundle test',
    time: '1 hr ago',
  },
]

const revenueData = [28, 34, 31, 43, 47, 45, 54, 52, 61, 58, 67, 72, 68, 76, 82, 79, 91, 86, 96, 103, 111, 106, 118, 124, 120, 134, 131, 142, 151, 163]
const weekLabels = ['May 14', 'May 18', 'May 22', 'May 26', 'May 30', 'Jun 03', 'Jun 07', 'Jun 12']

function App() {
  const [activePage, setActivePage] = useState<PageKey>('dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [jarvisOpen, setJarvisOpen] = useState(false)
  const [jarvisLive, setJarvisLive] = useState(false)
  const [evidenceId, setEvidenceId] = useState<string | null>(null)
  const [recommendations, setRecommendations] = useState(recommendationsSeed)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [lightMode, setLightMode] = useState(false)

  const showToast = (message: string, kind: ToastKind = 'success') => {
    setToast({ message, kind })
    window.setTimeout(() => setToast(null), 3600)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
      if (event.key === 'Escape') {
        setCommandOpen(false)
        setNotificationOpen(false)
        setProfileOpen(false)
        setEvidenceId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const navigate = (page: PageKey) => {
    setActivePage(page)
    setMobileNavOpen(false)
    setCommandOpen(false)
  }

  const updateRecommendation = (id: string, status: RecommendationStatus) => {
    setRecommendations((current) => current.map((item) => (item.id === id ? { ...item, status } : item)))
    const label = status === 'Approved' ? 'Recommendation approved and queued safely.' : 'Recommendation rejected. Reason captured for calibration.'
    showToast(label, status === 'Approved' ? 'success' : 'info')
    setEvidenceId(null)
  }

  const currentEvidence = recommendations.find((item) => item.id === evidenceId) ?? null
  const activeMeta = pageMeta[activePage]

  return (
    <div className={`app-shell ${lightMode ? 'light-mode' : ''}`}>
      <Sidebar
        activePage={activePage}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavOpen}
        onNavigate={navigate}
        onCollapse={() => setSidebarCollapsed((value) => !value)}
        onCloseMobile={() => setMobileNavOpen(false)}
        onOpenCommand={() => setCommandOpen(true)}
      />

      <main className={`main-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
        <TopBar
          activeMeta={activeMeta}
          onMenu={() => setMobileNavOpen(true)}
          onOpenCommand={() => setCommandOpen(true)}
          onOpenNotifications={() => setNotificationOpen(true)}
          onOpenProfile={() => setProfileOpen((value) => !value)}
          profileOpen={profileOpen}
          onToggleTheme={() => setLightMode((value) => !value)}
          lightMode={lightMode}
          onNavigate={navigate}
        />
        <div className="page-scroll">
          {activePage === 'dashboard' && <DashboardPage recommendations={recommendations} onNavigate={navigate} onOpenEvidence={setEvidenceId} onToast={showToast} />}
          {activePage === 'products' && <ProductsPage onToast={showToast} />}
          {activePage === 'orders' && <OrdersPage />}
          {activePage === 'customers' && <CustomersPage onToast={showToast} />}
          {activePage === 'inventory' && <InventoryPage onToast={showToast} />}
          {activePage === 'analytics' && <AnalyticsPage />}
          {activePage === 'command-center' && <CommandCenterPage onToast={showToast} />}
          {activePage === 'recommendations' && (
            <RecommendationsPage recommendations={recommendations} onOpenEvidence={setEvidenceId} onUpdate={updateRecommendation} />
          )}
          {activePage === 'automation' && <AutomationPage onToast={showToast} />}
          {activePage === 'campaigns' && <CampaignsPage onToast={showToast} />}
          {activePage === 'copilot' && <CopilotPage onToast={showToast} />}
          {activePage === 'reports' && <ReportsPage onToast={showToast} />}
          {activePage === 'exports' && <ExportsPage onToast={showToast} />}
          {activePage === 'support' && <SupportPage onToast={showToast} />}
          {activePage === 'billing' && <BillingPage onToast={showToast} onNavigate={navigate} />}
          {activePage === 'settings' && <SettingsPage onToast={showToast} lightMode={lightMode} onToggleTheme={() => setLightMode((value) => !value)} />}
        </div>
      </main>

      {!jarvisLive && !jarvisOpen && <JarvisOrb onClick={() => setJarvisOpen(true)} />}
      {jarvisOpen && (
        <JarvisPanel
          onClose={() => setJarvisOpen(false)}
          onStartLive={() => {
            setJarvisOpen(false)
            setJarvisLive(true)
          }}
          onToast={showToast}
          activePage={activeMeta.title}
        />
      )}
      {jarvisLive && (
        <JarvisLiveBar
          onEnd={() => setJarvisLive(false)}
          onPause={() => showToast('Jarvis is quiet for the next 5 minutes.', 'info')}
          onOpen={() => setJarvisOpen(true)}
        />
      )}
      {currentEvidence && (
        <EvidenceDrawer
          recommendation={currentEvidence}
          onClose={() => setEvidenceId(null)}
          onApprove={() => updateRecommendation(currentEvidence.id, 'Approved')}
          onReject={() => updateRecommendation(currentEvidence.id, 'Rejected')}
        />
      )}
      {notificationOpen && <NotificationDrawer onClose={() => setNotificationOpen(false)} onNavigate={navigate} />}
      {commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} onNavigate={navigate} />}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

function Sidebar({
  activePage,
  collapsed,
  mobileOpen,
  onNavigate,
  onCollapse,
  onCloseMobile,
  onOpenCommand,
}: {
  activePage: PageKey
  collapsed: boolean
  mobileOpen: boolean
  onNavigate: (page: PageKey) => void
  onCollapse: () => void
  onCloseMobile: () => void
  onOpenCommand: () => void
}) {
  return (
    <>
      {mobileOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={onCloseMobile} />}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="brand-row">
          <button className="brand-lockup" onClick={() => onNavigate('dashboard')} aria-label="Go to dashboard">
            <span className="brand-mark"><span /></span>
            {!collapsed && <span className="brand-name">Profit<span>Pilot</span></span>}
          </button>
          <button className="sidebar-collapse" onClick={onCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <button className="mobile-close" onClick={onCloseMobile} aria-label="Close navigation"><X size={18} /></button>
        </div>

        {!collapsed ? (
          <button className="workspace-switcher" onClick={() => onNavigate('settings')}>
            <span className="workspace-avatar">NS</span>
            <span className="workspace-copy"><strong>Nouri Supply Co.</strong><small>Shopify store</small></span>
            <ChevronDown size={15} />
          </button>
        ) : (
          <button className="workspace-switcher compact" onClick={() => onNavigate('settings')} aria-label="Open workspace">
            <span className="workspace-avatar">NS</span>
          </button>
        )}

        {!collapsed && (
          <button className="command-trigger" onClick={onOpenCommand}>
            <Search size={15} /><span>Search anything</span><kbd>⌘ K</kbd>
          </button>
        )}

        <nav className="side-nav" aria-label="Primary navigation">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              {!collapsed && <div className="nav-group-label">{group.label}</div>}
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    className={`nav-item ${activePage === item.id ? 'active' : ''}`}
                    onClick={() => onNavigate(item.id)}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon size={17} strokeWidth={activePage === item.id ? 2.25 : 1.8} />
                    {!collapsed && <span>{item.label}</span>}
                    {!collapsed && item.badge && <span className={`nav-badge ${item.id === 'recommendations' ? 'amber' : ''}`}>{item.badge}</span>}
                    {collapsed && item.badge && <span className="collapsed-badge" />}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {!collapsed && (
            <div className="usage-card">
              <div className="usage-card-top"><span><Zap size={13} /> AI usage</span><span>62%</span></div>
              <div className="usage-track"><span style={{ width: '62%' }} /></div>
              <p>124 of 200 recommendations</p>
              <button onClick={() => onNavigate('billing')}>Manage plan <ArrowUpRight size={13} /></button>
            </div>
          )}
          <button className="help-link" onClick={() => onNavigate('support')} title={collapsed ? 'Help center' : undefined}>
            <CircleHelp size={17} />{!collapsed && <span>Help center</span>}
          </button>
          <div className="sidebar-user">
            <span className="user-avatar">AA</span>
            {!collapsed && <span className="sidebar-user-copy"><strong>Anas Ali</strong><small>Owner</small></span>}
            {!collapsed && <MoreHorizontal size={16} />}
          </div>
        </div>
      </aside>
    </>
  )
}

function TopBar({
  activeMeta,
  onMenu,
  onOpenCommand,
  onOpenNotifications,
  onOpenProfile,
  profileOpen,
  onToggleTheme,
  lightMode,
  onNavigate,
}: {
  activeMeta: { title: string; description: string; icon: LucideIcon }
  onMenu: () => void
  onOpenCommand: () => void
  onOpenNotifications: () => void
  onOpenProfile: () => void
  profileOpen: boolean
  onToggleTheme: () => void
  lightMode: boolean
  onNavigate: (page: PageKey) => void
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="mobile-menu-button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
        <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{activeMeta.title}</strong></div>
      </div>
      <div className="topbar-actions">
        <button className="top-search" onClick={onOpenCommand}><Search size={16} /><span>Search</span><kbd>⌘ K</kbd></button>
        <div className="topbar-divider" />
        <button className="icon-button notification-button" onClick={onOpenNotifications} aria-label="Open notifications">
          <Bell size={18} /><span className="notification-dot" />
        </button>
        <button className="icon-button" onClick={onToggleTheme} aria-label="Toggle theme">{lightMode ? <Moon size={18} /> : <Sun size={18} />}</button>
        <div className="profile-wrap">
          <button className="profile-button" onClick={onOpenProfile}>
            <span className="profile-avatar">AA</span><span className="profile-name">Anas Ali</span><ChevronDown size={14} />
          </button>
          {profileOpen && (
            <div className="profile-menu">
              <div className="profile-menu-head"><span className="profile-avatar large">AA</span><span><strong>Anas Ali</strong><small>Owner · Nouri Supply Co.</small></span></div>
              <button onClick={() => onNavigate('settings')}><Settings size={15} /> Settings</button>
              <button onClick={() => onNavigate('billing')}><CreditCard size={15} /> Billing & plan</button>
              <button onClick={onToggleTheme}>{lightMode ? <Sun size={15} /> : <Moon size={15} />} {lightMode ? 'Dark mode' : 'Light mode'}</button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function DashboardPage({
  recommendations,
  onNavigate,
  onOpenEvidence,
  onToast,
}: {
  recommendations: Recommendation[]
  onNavigate: (page: PageKey) => void
  onOpenEvidence: (id: string) => void
  onToast: (message: string, kind?: ToastKind) => void
}) {
  return (
    <div className="page-content dashboard-page">
      <PageHeader
        eyebrow="Wednesday, June 12, 2024"
        title="Good morning, Anas"
        description="Here’s what your AI employee found while you were away."
        actions={<><button className="button secondary" onClick={() => onToast('Health check queued. We will notify you when it is complete.', 'info')}><RefreshCw size={15} /> Run health check</button><button className="button primary" onClick={() => onNavigate('recommendations')}><WandSparkles size={15} /> Review 4 recommendations</button></>}
      />

      <div className="sync-banner"><span className="sync-pulse"><span /></span><span><strong>Shopify is connected</strong> · Last synced 4 minutes ago</span><button onClick={() => onToast('Store sync is already up to date.', 'success')}>View sync status <ArrowUpRight size={13} /></button></div>

      <div className="stat-grid">
        <StatCard label="Revenue" value="$24,680" change="12.4%" detail="vs. previous 30 days" positive icon={WalletCards} accent="gold" spark={[28, 35, 31, 42, 38, 56, 61, 68, 75]} />
        <StatCard label="Orders" value="486" change="8.2%" detail="vs. previous 30 days" positive icon={ShoppingBag} accent="blue" spark={[25, 38, 35, 41, 48, 43, 55, 63, 69]} />
        <StatCard label="Average order value" value="$50.78" change="1.6%" detail="vs. previous 30 days" positive={false} icon={Target} accent="purple" spark={[68, 65, 72, 61, 64, 58, 60, 54, 52]} />
        <StatCard label="AI-attributed revenue" value="$3,842" change="21.7%" detail="this month" positive icon={Sparkles} accent="green" spark={[24, 29, 35, 32, 44, 49, 51, 62, 78]} />
      </div>

      <div className="dashboard-grid top-grid">
        <section className="card revenue-card">
          <div className="card-heading">
            <div><div className="section-kicker"><span className="kicker-dot blue" /> Revenue overview</div><h2>$24,680 <span className="inline-change positive"><ArrowUpRight size={13} /> 12.4%</span></h2></div>
            <div className="segmented-control"><button className="selected">30 days</button><button>90 days</button><button>12 months</button></div>
          </div>
          <div className="chart-legend"><span><i className="legend-line blue" /> Revenue</span><span><i className="legend-line muted" /> Previous period</span><span className="chart-last-updated"><Clock3 size={13} /> Updated 4m ago</span></div>
          <RevenueChart />
        </section>
        <section className="card health-card">
          <div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot green" /> Store health</div><h3>Everything looks healthy</h3></div><button className="more-button"><MoreHorizontal size={18} /></button></div>
          <div className="health-content"><HealthGauge /><div className="health-score-copy"><strong>82<span>/100</span></strong><p>↑ 6 points this month</p></div></div>
          <div className="health-items"><HealthItem label="Revenue momentum" value="Strong" tone="green" /><HealthItem label="Inventory coverage" value="Watch" tone="amber" /><HealthItem label="Customer retention" value="Strong" tone="green" /></div>
          <button className="text-button full" onClick={() => onNavigate('analytics')}>View health breakdown <ArrowUpRight size={14} /></button>
        </section>
      </div>

      <div className="dashboard-grid middle-grid">
        <section className="card opportunities-card">
          <div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot purple" /> AI employee</div><h3>Worth your attention</h3></div><button className="text-button" onClick={() => onNavigate('recommendations')}>See all <ArrowUpRight size={14} /></button></div>
          <div className="opportunity-list">
            {recommendations.slice(0, 3).map((recommendation) => <OpportunityRow key={recommendation.id} recommendation={recommendation} onOpen={() => onOpenEvidence(recommendation.id)} />)}
          </div>
        </section>
        <section className="card briefing-card">
          <div className="briefing-glow" />
          <div className="briefing-head"><div className="jarvis-mini-orb"><span /></div><div><div className="section-kicker">JARVIS BRIEFING <span className="live-label"><i /> LIVE</span></div><h3>Your morning briefing</h3></div><button className="more-button"><MoreHorizontal size={18} /></button></div>
          <p className="briefing-intro">“Your store had a strong start to the week. I found two opportunities worth $10.5k in potential recovery.”</p>
          <div className="briefing-metrics"><div><strong>$4,230</strong><span>yesterday’s revenue <em>↑ 12%</em></span></div><div><strong>23 units</strong><span>top seller: Premium Hoodie</span></div></div>
          <button className="button briefing-button" onClick={() => onToast('Jarvis is ready when you are.', 'info')}><Mic size={15} /> Talk to Jarvis <span>⌘ J</span></button>
        </section>
      </div>

      <section className="card activity-card">
        <div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot amber" /> Recent activity</div><h3>What your AI employee has been doing</h3></div><button className="more-button"><MoreHorizontal size={18} /></button></div>
        <div className="activity-table"><ActivityRow icon={CheckCircle2} tone="green" title="Win-back campaign attributed a purchase" detail="Sarah M. · Customer Agent" time="12 min ago" value="+$189" /><ActivityRow icon={RefreshCw} tone="blue" title="Inventory sync completed" detail="184 products checked · 0 errors" time="36 min ago" /><ActivityRow icon={ShieldCheck} tone="purple" title="Fraud signal reviewed" detail="Order #PP-10482 · low risk" time="1 hr ago" /><ActivityRow icon={FileText} tone="amber" title="Weekly report generated" detail="Available in your report vault" time="2 hrs ago" action="View report" /></div>
      </section>
    </div>
  )
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-header"><div><div className="page-eyebrow">{eyebrow ?? 'ProfitPilot workspace'}</div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>
}

function StatCard({ label, value, change, detail, positive, icon: Icon, accent, spark }: { label: string; value: string; change: string; detail: string; positive: boolean; icon: LucideIcon; accent: string; spark: number[] }) {
  return <div className="card stat-card"><div className="stat-top"><span className={`stat-icon ${accent}`}><Icon size={17} /></span><span className={`stat-change ${positive ? 'positive' : 'negative'}`}>{positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{change}</span></div><div className="stat-value">{value}</div><div className="stat-bottom"><span>{label}<small>{detail}</small></span><Sparkline data={spark} tone={accent} /></div></div>
}

function Sparkline({ data, tone }: { data: number[]; tone: string }) {
  const width = 82
  const height = 30
  const max = Math.max(...data)
  const min = Math.min(...data)
  const points = data.map((value, index) => `${(index / (data.length - 1)) * width},${height - ((value - min) / Math.max(max - min, 1)) * (height - 5) - 2}`).join(' ')
  return <svg className={`sparkline ${tone}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function RevenueChart() {
  const width = 760
  const height = 230
  const left = 12
  const right = 12
  const top = 18
  const bottom = 24
  const max = 180
  const points = revenueData.map((value, index) => {
    const x = left + (index / (revenueData.length - 1)) * (width - left - right)
    const y = top + (1 - value / max) * (height - top - bottom)
    return [x, y]
  })
  const line = points.map(([x, y]) => `${x},${y}`).join(' ')
  const area = `${left},${height - bottom} ${line} ${width - right},${height - bottom}`
  return <div className="revenue-chart"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Revenue trend chart"><defs><linearGradient id="revenueFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4f8cff" stopOpacity=".28" /><stop offset="100%" stopColor="#4f8cff" stopOpacity="0" /></linearGradient><linearGradient id="revenueStroke" x1="0" x2="1"><stop offset="0%" stopColor="#60a5fa" /><stop offset="100%" stopColor="#8b5cf6" /></linearGradient></defs>{[0, 1, 2, 3].map((lineIndex) => { const y = top + lineIndex * ((height - top - bottom) / 3); return <line key={lineIndex} x1={left} x2={width - right} y1={y} y2={y} stroke="currentColor" className="chart-grid-line" /> })}<polygon points={area} fill="url(#revenueFill)" /><polyline points={line} fill="none" stroke="url(#revenueStroke)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="5" fill="#0f1117" stroke="#71a7ff" strokeWidth="3" /></svg><div className="chart-y-labels"><span>$6k</span><span>$4k</span><span>$2k</span><span>$0</span></div><div className="chart-x-labels">{weekLabels.map((label) => <span key={label}>{label}</span>)}</div><div className="chart-hover-label"><span>Jun 12</span><strong>$4,230</strong><small>+12.4%</small></div></div>
}

function HealthGauge() {
  return <div className="health-gauge"><div className="gauge-inner"><strong>82</strong><span>HEALTH</span></div></div>
}

function HealthItem({ label, value, tone }: { label: string; value: string; tone: 'green' | 'amber' }) {
  return <div className="health-item"><span><i className={`status-dot ${tone}`} />{label}</span><strong className={tone}>{value}</strong></div>
}

function OpportunityRow({ recommendation, onOpen }: { recommendation: Recommendation; onOpen: () => void }) {
  return <button className="opportunity-row" onClick={onOpen}><span className="agent-icon" style={{ '--agent-color': recommendation.agentColor } as CSSProperties}><Sparkles size={15} /></span><span className="opportunity-copy"><strong>{recommendation.title}</strong><small>{recommendation.agent} · {recommendation.time}</small></span><span className="opportunity-impact"><strong>{recommendation.impact}</strong><small>{recommendation.impactLabel}</small></span><ChevronRight size={16} className="row-arrow" /></button>
}

function ActivityRow({ icon: Icon, tone, title, detail, time, value, action }: { icon: LucideIcon; tone: string; title: string; detail: string; time: string; value?: string; action?: string }) {
  return <div className="activity-row"><span className={`activity-icon ${tone}`}><Icon size={15} /></span><span className="activity-copy"><strong>{title}</strong><small>{detail}</small></span>{value && <strong className="activity-value">{value}</strong>}<span className="activity-time">{time}</span>{action && <button className="text-button">{action} <ArrowUpRight size={13} /></button>}</div>
}

function SectionScaffold({ page, actions, children }: { page: PageKey; actions?: ReactNode; children: ReactNode }) {
  const meta = pageMeta[page]
  const Icon = meta.icon
  return <div className="page-content"><PageHeader eyebrow={<span className="header-with-icon"><Icon size={14} /> AI EMPLOYEE WORKSPACE</span>} title={meta.title} description={meta.description} actions={actions} />{children}</div>
}

function RecommendationsPage({ recommendations, onOpenEvidence, onUpdate }: { recommendations: Recommendation[]; onOpenEvidence: (id: string) => void; onUpdate: (id: string, status: RecommendationStatus) => void }) {
  const pending = recommendations.filter((item) => item.status === 'Needs review')
  return <SectionScaffold page="recommendations" actions={<><button className="button secondary"><Filter size={15} /> Filters <span className="filter-count">2</span></button><button className="button primary" onClick={() => pending.forEach((item) => onUpdate(item.id, 'Approved'))}><Check size={15} /> Approve all safe</button></>}>
    <div className="recommendation-summary"><div className="summary-number"><strong>{pending.length}</strong><span>decisions need your review</span></div><div className="summary-divider" /><div className="summary-stat"><span className="confidence-dot high" /><strong>$10.5k</strong><small>modeled opportunity</small></div><div className="summary-stat"><span className="confidence-dot medium" /><strong>86%</strong><small>average confidence</small></div><div className="summary-spacer" /><button className="text-button"><Clock3 size={14} /> Decision history <ArrowUpRight size={13} /></button></div>
    <div className="recommendation-toolbar"><div className="tabs"><button className="active">Needs review <span>{pending.length}</span></button><button>Approved</button><button>Rejected</button></div><div className="sort-control"><ListFilter size={14} /> Sort by <strong>Impact</strong><ChevronDown size={14} /></div></div>
    <div className="recommendation-list">{recommendations.map((item) => <RecommendationCard key={item.id} recommendation={item} onOpenEvidence={() => onOpenEvidence(item.id)} onApprove={() => onUpdate(item.id, 'Approved')} onReject={() => onUpdate(item.id, 'Rejected')} />)}</div>
  </SectionScaffold>
}

function RecommendationCard({ recommendation, onOpenEvidence, onApprove, onReject }: { recommendation: Recommendation; onOpenEvidence: () => void; onApprove: () => void; onReject: () => void }) {
  const confidenceLabel = recommendation.confidence === 'high' ? 'High confidence' : recommendation.confidence === 'medium' ? 'Medium confidence' : 'Limited data'
  return <article className={`recommendation-card ${recommendation.status !== 'Needs review' ? 'is-resolved' : ''}`}><div className="recommendation-card-main"><div className="recommendation-card-top"><span className="agent-pill" style={{ '--agent-color': recommendation.agentColor } as CSSProperties}><span />{recommendation.agent}</span><span className={`confidence-pill ${recommendation.confidence}`}><span />{confidenceLabel}</span><span className="recommendation-time">{recommendation.time}</span><button className="more-button"><MoreHorizontal size={18} /></button></div><h3>{recommendation.title}</h3><p>{recommendation.description}</p><div className="evidence-snippets">{recommendation.evidence.map((item) => <span key={item}><CheckCircle2 size={13} />{item}</span>)}</div></div><div className="recommendation-card-side"><span className="impact-label">{recommendation.impactLabel}</span><strong>{recommendation.impact}</strong><button className="text-button" onClick={onOpenEvidence}><Eye size={14} /> See evidence</button>{recommendation.status === 'Needs review' ? <div className="recommendation-actions"><button className="button reject" onClick={onReject}><X size={14} /> Reject</button><button className="button approve" onClick={onApprove}><Check size={14} /> Approve</button></div> : <span className={`resolved-label ${recommendation.status === 'Approved' ? 'approved' : 'rejected'}`}><CheckCircle2 size={14} />{recommendation.status}</span>}</div></article>
}

function EvidenceDrawer({ recommendation, onClose, onApprove, onReject }: { recommendation: Recommendation; onClose: () => void; onApprove: () => void; onReject: () => void }) {
  return <><button className="drawer-backdrop" onClick={onClose} aria-label="Close evidence" /><aside className="evidence-drawer"><div className="drawer-header"><div><span className="drawer-kicker"><Sparkles size={13} /> IMMUTABLE EVIDENCE PACK</span><h2>Why this matters</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="drawer-scroll"><div className="drawer-agent"><span className="agent-icon large" style={{ '--agent-color': recommendation.agentColor } as CSSProperties}><Sparkles size={18} /></span><span><strong>{recommendation.agent}</strong><small>Decision {recommendation.id.replace('rec-', '#00')}</small></span><span className={`confidence-pill ${recommendation.confidence}`}><span />{recommendation.confidence === 'high' ? 'High' : recommendation.confidence === 'medium' ? 'Medium' : 'Low'}</span></div><div className="drawer-hero"><span>{recommendation.impactLabel}</span><strong>{recommendation.impact}</strong><small>Modeled from your store data · no AI-generated numbers</small></div><div className="drawer-section"><div className="drawer-section-title"><Database size={15} /> Evidence</div><div className="evidence-stack">{recommendation.evidence.map((item, index) => <div className="evidence-line" key={item}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item}</strong><CheckCircle2 size={15} /></div>)}</div></div><div className="drawer-section"><div className="drawer-section-title"><FileText size={15} /> Proposed action</div><div className="proposed-action"><div className="proposed-action-icon"><Mail size={17} /></div><div><strong>{recommendation.action}</strong><p>Jarvis will prepare the action for your review. Nothing is sent until you approve it.</p></div></div></div><div className="drawer-section"><div className="drawer-section-title"><ShieldCheck size={15} /> Safety checks</div><div className="safety-list"><span><Check size={14} /> PII minimized before AI analysis</span><span><Check size={14} /> Idempotency key reserved</span><span><Check size={14} /> Audit trail will be recorded</span></div></div></div><div className="drawer-footer"><button className="button secondary" onClick={onReject}><X size={15} /> Not now</button><button className="button primary" onClick={onApprove}><Check size={15} /> Approve action</button></div></aside></>
}

function ProductsPage({ onToast }: { onToast: (message: string, kind?: ToastKind) => void }) {
  const products = [{ name: 'Premium Hoodie', sku: 'PH-04', price: '$89.00', stock: '18', status: 'Low stock', trend: '+23%', color: 'blue' }, { name: 'Everyday Tee', sku: 'ET-02', price: '$42.00', stock: '284', status: 'Healthy', trend: '+8%', color: 'green' }, { name: 'Everyday Cap', sku: 'EC-09', price: '$28.00', stock: '96', status: 'Healthy', trend: '+4%', color: 'green' }, { name: 'Canvas Weekender', sku: 'CW-11', price: '$124.00', stock: '0', status: 'Out of stock', trend: '-12%', color: 'red' }, { name: 'Ribbed Lounge Set', sku: 'RL-07', price: '$76.00', stock: '42', status: 'Watch', trend: '+2%', color: 'amber' }]
  return <SectionScaffold page="products" actions={<><button className="button secondary"><Download size={15} /> Export</button><button className="button primary" onClick={() => onToast('New product flow is ready for Shopify sync.', 'info')}><Plus size={15} /> Add product</button></>}>
    <div className="metric-strip"><MiniMetric label="Total products" value="184" sub="↑ 6 this month" tone="blue" /><MiniMetric label="Healthy stock" value="142" sub="77.2% of catalog" tone="green" /><MiniMetric label="Need attention" value="11" sub="3 high priority" tone="amber" /><MiniMetric label="Catalog revenue" value="$18.4k" sub="↑ 14.8% vs last period" tone="purple" /></div>
    <div className="card table-card"><div className="table-toolbar"><div className="table-search"><Search size={15} /><input placeholder="Search products" /></div><div className="toolbar-actions"><button className="filter-button"><Filter size={14} /> Status <ChevronDown size={14} /></button><button className="filter-button"><SlidersHorizontal size={14} /> More filters</button><button className="icon-button"><MoreHorizontal size={17} /></button></div></div><div className="table-wrap"><table><thead><tr><th><span className="checkbox" /></th><th>Product</th><th>Price</th><th>Inventory</th><th>30d trend</th><th>AI signal</th><th /></tr></thead><tbody>{products.map((product) => <tr key={product.sku}><td><span className="checkbox" /></td><td><div className="product-cell"><span className="product-thumb"><Package size={17} /></span><span><strong>{product.name}</strong><small>{product.sku}</small></span></div></td><td className="td-strong">{product.price}</td><td><span className={`stock-number ${product.color}`}>{product.stock}</span><small className="td-sub"> units</small></td><td><span className={`trend-value ${product.trend.startsWith('-') ? 'down' : 'up'}`}>{product.trend}</span></td><td><span className={`status-badge ${product.color}`}>{product.status}</span></td><td><button className="more-button"><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div><div className="table-footer"><span>Showing 1–5 of 184 products</span><div className="pagination"><button className="icon-button"><ChevronLeft size={15} /></button><button className="page-number active">1</button><button className="page-number">2</button><button className="page-number">3</button><span>…</span><button className="page-number">19</button><button className="icon-button"><ChevronRight size={15} /></button></div></div></div>
  </SectionScaffold>
}

function OrdersPage() {
  const orders = [{ id: '#PP-10492', customer: 'Maya Patel', items: '2 items', total: '$168.00', status: 'Fulfilled', date: 'Today, 10:42 AM', channel: 'AI win-back' }, { id: '#PP-10491', customer: 'Jordan Lee', items: '1 item', total: '$89.00', status: 'Processing', date: 'Today, 09:18 AM', channel: 'Direct' }, { id: '#PP-10490', customer: 'Oliver Smith', items: '3 items', total: '$246.50', status: 'Fulfilled', date: 'Yesterday, 8:04 PM', channel: 'AI campaign' }, { id: '#PP-10489', customer: 'Ava Williams', items: '1 item', total: '$42.00', status: 'At risk', date: 'Yesterday, 5:21 PM', channel: 'Direct' }, { id: '#PP-10488', customer: 'Liam Chen', items: '4 items', total: '$311.00', status: 'Fulfilled', date: 'Yesterday, 2:16 PM', channel: 'Organic' }]
  return <SectionScaffold page="orders" actions={<><button className="button secondary"><Download size={15} /> Export</button><button className="button primary"><Filter size={15} /> Filter orders</button></>}><div className="metric-strip"><MiniMetric label="Orders today" value="34" sub="↑ 12.4% vs last Tuesday" tone="blue" /><MiniMetric label="Processing" value="8" sub="All within SLA" tone="amber" /><MiniMetric label="Fulfillment rate" value="96.8%" sub="↑ 1.2% this week" tone="green" /><MiniMetric label="AI-attributed" value="18" sub="$1,842 in revenue" tone="purple" /></div><div className="card table-card"><div className="table-toolbar"><div className="tabs compact"><button className="active">All orders <span>486</span></button><button>Needs attention <span>4</span></button><button>AI-attributed</button></div><div className="toolbar-actions"><button className="filter-button"><Calendar size={14} /> Last 30 days <ChevronDown size={14} /></button></div></div><div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Source</th><th>Date</th><th /></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong className="order-id">{order.id}</strong></td><td><div className="customer-cell"><span className="customer-avatar">{order.customer.split(' ').map((part) => part[0]).join('')}</span><span><strong>{order.customer}</strong><small>{order.items}</small></span></div></td><td className="td-strong">{order.total}</td><td><span className={`status-badge ${order.status === 'At risk' ? 'red' : order.status === 'Processing' ? 'amber' : 'green'}`}>{order.status}</span></td><td>{order.channel.includes('AI') ? <span className="ai-source"><Sparkles size={13} /> {order.channel}</span> : <span className="muted-cell">{order.channel}</span>}</td><td className="muted-cell">{order.date}</td><td><button className="more-button"><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div><div className="table-footer"><span>Showing 1–5 of 486 orders</span><div className="pagination"><button className="icon-button"><ChevronLeft size={15} /></button><button className="page-number active">1</button><button className="page-number">2</button><button className="page-number">3</button><span>…</span><button className="page-number">98</button><button className="icon-button"><ChevronRight size={15} /></button></div></div></div></SectionScaffold>
}

function CustomersPage({ onToast }: { onToast: (message: string, kind?: ToastKind) => void }) {
  const customers = [{ name: 'Sarah Mitchell', email: 'sarah.m•••@gmail.com', segment: 'VIP', ltv: '$1,248', last: '2 days ago', risk: 'Healthy', initials: 'SM' }, { name: 'Maya Patel', email: 'maya.p•••@icloud.com', segment: 'Repeat', ltv: '$862', last: 'Today', risk: 'Healthy', initials: 'MP' }, { name: 'Jordan Lee', email: 'jordan.l•••@outlook.com', segment: 'At risk', ltv: '$729', last: '78 days ago', risk: 'High risk', initials: 'JL' }, { name: 'Oliver Smith', email: 'oliver.s•••@gmail.com', segment: 'VIP', ltv: '$684', last: 'Yesterday', risk: 'Healthy', initials: 'OS' }, { name: 'Ava Williams', email: 'ava.w•••@yahoo.com', segment: 'New', ltv: '$126', last: 'Yesterday', risk: 'Watch', initials: 'AW' }]
  return <SectionScaffold page="customers" actions={<><button className="button secondary"><Download size={15} /> Export</button><button className="button primary" onClick={() => onToast('Customer segment created. Configure it in Campaigns.', 'success')}><Plus size={15} /> Create segment</button></>}><div className="metric-strip"><MiniMetric label="Total customers" value="8,429" sub="↑ 4.6% this month" tone="blue" /><MiniMetric label="Repeat customers" value="31.8%" sub="+2.1 pts vs last month" tone="green" /><MiniMetric label="At risk" value="284" sub="$42.8k total LTV" tone="amber" /><MiniMetric label="Average LTV" value="$218" sub="↑ 8.7% this quarter" tone="purple" /></div><div className="segment-pills"><button className="segment-pill active"><span className="segment-dot purple" />All customers <strong>8,429</strong></button><button className="segment-pill"><span className="segment-dot gold" />VIP <strong>412</strong></button><button className="segment-pill"><span className="segment-dot red" />At risk <strong>284</strong></button><button className="segment-pill"><span className="segment-dot blue" />New <strong>1,084</strong></button><button className="segment-pill"><Plus size={14} /> Create custom</button></div><div className="card table-card"><div className="table-toolbar"><div className="table-search"><Search size={15} /><input placeholder="Search by name or email" /></div><div className="toolbar-actions"><button className="filter-button"><Filter size={14} /> RFM filters</button><button className="icon-button"><MoreHorizontal size={17} /></button></div></div><div className="table-wrap"><table><thead><tr><th><span className="checkbox" /></th><th>Customer</th><th>Segment</th><th>Lifetime value</th><th>Last purchase</th><th>Churn risk</th><th /></tr></thead><tbody>{customers.map((customer) => <tr key={customer.email}><td><span className="checkbox" /></td><td><div className="customer-cell"><span className="customer-avatar lilac">{customer.initials}</span><span><strong>{customer.name}</strong><small>{customer.email}</small></span></div></td><td><span className="status-badge neutral">{customer.segment}</span></td><td className="td-strong">{customer.ltv}</td><td className="muted-cell">{customer.last}</td><td><span className={`risk-label ${customer.risk === 'High risk' ? 'red' : customer.risk === 'Watch' ? 'amber' : 'green'}`}><span />{customer.risk}</span></td><td><button className="more-button"><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div><div className="table-footer"><span>Showing 1–5 of 8,429 customers</span><span className="table-footer-note"><ShieldCheck size={14} /> Personal data is minimized in AI analysis</span></div></div></SectionScaffold>
}

function InventoryPage({ onToast }: { onToast: (message: string, kind?: ToastKind) => void }) {
  return <SectionScaffold page="inventory" actions={<><button className="button secondary"><Download size={15} /> Export inventory</button><button className="button primary" onClick={() => onToast('Reorder suggestions are ready to review.', 'info')}><WandSparkles size={15} /> Review suggestions</button></>}><div className="inventory-hero"><div><span className="section-kicker"><span className="kicker-dot blue" /> Inventory pulse</span><h2>Most of your catalog is in a good place.</h2><p>11 products need attention based on days of cover and recent velocity.</p></div><div className="inventory-health"><HealthGauge /><div><strong>86%</strong><small>healthy coverage</small></div></div></div><div className="metric-strip"><MiniMetric label="Units in stock" value="12,840" sub="Across 184 products" tone="blue" /><MiniMetric label="Low stock" value="11" sub="3 critical today" tone="amber" /><MiniMetric label="Stockout risk" value="$8.2k" sub="Revenue at risk" tone="red" /><MiniMetric label="Dead stock" value="24 SKUs" sub="$5.4k tied up" tone="purple" /></div><div className="inventory-grid"><section className="card inventory-list-card"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot amber" /> Needs attention</div><h3>Stockout watchlist</h3></div><button className="text-button">View all <ArrowUpRight size={14} /></button></div><div className="inventory-list"><InventoryRow name="Premium Hoodie" sku="PH-04" units="18 units" days="4 days" percent={19} tone="red" action="Reorder now" /><InventoryRow name="Ribbed Lounge Set" sku="RL-07" units="42 units" days="12 days" percent={41} tone="amber" action="Review" /><InventoryRow name="Canvas Weekender" sku="CW-11" units="0 units" days="Out of stock" percent={0} tone="red" action="Restock" /><InventoryRow name="Everyday Tee" sku="ET-02" units="284 units" days="63 days" percent={77} tone="green" action="Healthy" /></div></section><section className="card dead-stock-card"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot purple" /> Cash recovery</div><h3>Dead stock</h3></div><button className="more-button"><MoreHorizontal size={18} /></button></div><div className="dead-stock-number"><strong>$5,420</strong><span>tied up in 24 SKUs</span></div><div className="dead-stock-chart"><div className="dead-bar" style={{ height: '34%' }} /><div className="dead-bar" style={{ height: '48%' }} /><div className="dead-bar" style={{ height: '43%' }} /><div className="dead-bar selected" style={{ height: '78%' }} /><div className="dead-bar" style={{ height: '57%' }} /><div className="dead-bar" style={{ height: '63%' }} /><div className="dead-bar" style={{ height: '88%' }} /></div><div className="dead-stock-footer"><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span></div><button className="text-button full">See clearance opportunities <ArrowUpRight size={14} /></button></section></div></SectionScaffold>
}

function InventoryRow({ name, sku, units, days, percent, tone, action }: { name: string; sku: string; units: string; days: string; percent: number; tone: string; action: string }) {
  return <div className="inventory-row"><span className="product-thumb small"><Package size={15} /></span><span className="inventory-product"><strong>{name}</strong><small>{sku} · {units}</small></span><span className="cover-cell"><span className="cover-bar"><i className={tone} style={{ width: `${Math.max(percent, 4)}%` }} /></span><small>{days}</small></span><button className={`inventory-action ${tone}`}>{action}</button></div>
}

function AnalyticsPage() {
  return <SectionScaffold page="analytics" actions={<><button className="button secondary"><Calendar size={15} /> May 14 – Jun 12 <ChevronDown size={14} /></button><button className="button primary"><Download size={15} /> Export</button></>}><div className="metric-strip"><MiniMetric label="Revenue" value="$24,680" sub="↑ 12.4% vs previous" tone="gold" /><MiniMetric label="Conversion rate" value="3.42%" sub="↑ 0.28 pts" tone="blue" /><MiniMetric label="Returning rate" value="31.8%" sub="↑ 2.1 pts" tone="green" /><MiniMetric label="Gross margin" value="64.2%" sub="↑ 1.8 pts" tone="purple" /></div><div className="analytics-grid"><section className="card analytics-main-card"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot blue" /> Performance</div><h3>Revenue and orders</h3></div><div className="chart-tabs"><button className="active">Revenue</button><button>Orders</button><button>AOV</button></div></div><RevenueChart /></section><section className="card channel-card"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot purple" /> Attribution</div><h3>Where revenue came from</h3></div><button className="more-button"><MoreHorizontal size={18} /></button></div><div className="donut-wrap"><div className="donut-chart"><div><strong>100%</strong><small>revenue</small></div></div><div className="channel-legend"><LegendRow color="blue" label="Direct" value="$11,420" percent="46.3%" /><LegendRow color="purple" label="AI-driven" value="$3,842" percent="15.6%" /><LegendRow color="gold" label="Organic" value="$6,218" percent="25.2%" /><LegendRow color="muted" label="Other" value="$3,200" percent="12.9%" /></div></div></section></div><div className="card insight-row-card"><div className="section-kicker"><span className="kicker-dot green" /> Deterministic insights</div><div className="insight-row-list"><InsightItem icon={TrendingUp} tone="green" title="Revenue is compounding" detail="The last 3 weeks each outperformed the previous by 8%+" /><InsightItem icon={Users} tone="purple" title="Retention is your edge" detail="Returning customers now contribute 31.8% of orders" /><InsightItem icon={AlertTriangle} tone="amber" title="Watch Friday coverage" detail="One best seller may stock out before the weekend" /></div></div></SectionScaffold>
}

function MiniMetric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return <div className="card mini-metric"><span className={`mini-metric-icon ${tone}`}><span /></span><div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div></div>
}

function LegendRow({ color, label, value, percent }: { color: string; label: string; value: string; percent: string }) { return <div className="legend-row"><span><i className={`legend-dot ${color}`} />{label}</span><strong>{value}</strong><small>{percent}</small></div> }
function InsightItem({ icon: Icon, tone, title, detail }: { icon: LucideIcon; tone: string; title: string; detail: string }) { return <div className="insight-item"><span className={`insight-icon ${tone}`}><Icon size={16} /></span><span><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={15} /></div> }

function CommandCenterPage({ onToast }: { onToast: (message: string, kind?: ToastKind) => void }) {
  const agents = [{ name: 'Revenue Agent', icon: TrendingUp, status: 'Working', color: 'gold', task: 'Scanning sales trends', runs: '248 decisions' }, { name: 'Inventory Agent', icon: Box, status: 'Working', color: 'blue', task: 'Watching 11 SKUs', runs: '184 checks' }, { name: 'Customer Agent', icon: Users, status: 'Working', color: 'purple', task: 'Monitoring churn signals', runs: '1,284 segments' }, { name: 'Pricing Agent', icon: Tag, status: 'Paused', color: 'red', task: 'Waiting for approval', runs: '18 decisions' }, { name: 'Campaign Agent', icon: Send, status: 'Working', color: 'green', task: 'Measuring win-back', runs: '3 active tests' }, { name: 'Product Agent', icon: Package, status: 'Working', color: 'cyan', task: 'Reviewing catalog', runs: '92 insights' }, { name: 'Executive Agent', icon: Briefcase, status: 'Ready', color: 'purple', task: 'Briefing at 8:00 AM', runs: '12 reports' }]
  return <SectionScaffold page="command-center" actions={<><button className="button secondary"><Settings size={15} /> Agent settings</button><button className="button primary" onClick={() => onToast('A full store scan has been queued.', 'success')}><RefreshCw size={15} /> Run full scan</button></>}><div className="command-health"><div className="command-health-copy"><div className="section-kicker"><span className="live-dot" /> ALL SYSTEMS OPERATIONAL</div><h2>Your AI employee is on the job.</h2><p>Seven specialized agents are monitoring your store with safety-first automation.</p></div><div className="command-health-stats"><div><strong>7/7</strong><span>agents online</span></div><div><strong>99.8%</strong><span>pipeline health</span></div><div><strong>$0.84</strong><span>AI cost today</span></div></div></div><div className="agent-grid">{agents.map((agent) => { const Icon = agent.icon; return <div className="card agent-card" key={agent.name}><div className="agent-card-top"><span className={`agent-big-icon ${agent.color}`}><Icon size={19} /></span><span className={`agent-status ${agent.status === 'Paused' ? 'paused' : ''}`}><i />{agent.status}</span><button className="more-button"><MoreHorizontal size={17} /></button></div><h3>{agent.name}</h3><p>{agent.task}</p><div className="agent-card-footer"><span><Activity size={13} /> {agent.runs}</span><span className="agent-pulse"><i /><i /><i /></span></div></div> })}</div><div className="command-bottom-grid"><section className="card pipeline-card"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot blue" /> Pipeline health</div><h3>Monitor → Detect → Explain → Measure</h3></div><span className="success-badge"><CheckCircle2 size={13} /> Healthy</span></div><div className="pipeline-steps"><PipelineStep number="01" label="Monitor" value="12,804" detail="events today" tone="blue" /><PipelineStep number="02" label="Detect" value="28" detail="signals found" tone="purple" /><PipelineStep number="03" label="Explain" value="16" detail="evidence packs" tone="gold" /><PipelineStep number="04" label="Measure" value="$3,842" detail="attributed" tone="green" /></div></section><section className="card cost-card"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot amber" /> Cost meter</div><h3>AI usage this month</h3></div><button className="more-button"><MoreHorizontal size={17} /></button></div><div className="cost-value"><strong>$18.42</strong><span>of $150 budget</span></div><div className="usage-track large"><span style={{ width: '12.3%' }} /></div><div className="cost-footer"><span>12.3% used</span><span>Daily cap: $5.00</span></div></section></div></SectionScaffold>
}

function PipelineStep({ number, label, value, detail, tone }: { number: string; label: string; value: string; detail: string; tone: string }) { return <div className="pipeline-step"><span className={`pipeline-number ${tone}`}>{number}</span><div><strong>{label}</strong><span>{value} <small>{detail}</small></span></div><CheckCircle2 size={16} /></div> }

function AutomationPage({ onToast }: { onToast: (message: string, kind?: ToastKind) => void }) {
  const workflows = [{ name: 'VIP win-back sequence', trigger: 'Customer inactive for 75 days', steps: 4, runs: '38 this month', status: 'Active', updated: 'Updated 2h ago' }, { name: 'Low stock alert', trigger: 'Product reaches 7 days of cover', steps: 2, runs: '11 this month', status: 'Active', updated: 'Updated yesterday' }, { name: 'New customer welcome', trigger: 'Order created', steps: 3, runs: '184 this month', status: 'Active', updated: 'Updated 3d ago' }, { name: 'Post-purchase review', trigger: 'Order fulfilled + 14 days', steps: 3, runs: 'Paused', status: 'Paused', updated: 'Updated 6d ago' }]
  return <SectionScaffold page="automation" actions={<><button className="button secondary"><Rows3 size={15} /> Templates</button><button className="button primary" onClick={() => onToast('Workflow builder opened. Start with a trigger.', 'info')}><Plus size={15} /> New workflow</button></>}><div className="automation-mode"><div className="automation-mode-icon"><ShieldCheck size={22} /></div><div><strong>Manual mode is on</strong><p>Your store is protected. Workflows prepare actions for approval until you opt into semi-automatic mode.</p></div><button className="text-button">Review safety policy <ArrowUpRight size={14} /></button></div><div className="automation-stats"><MiniMetric label="Active workflows" value="3" sub="1 paused" tone="blue" /><MiniMetric label="Runs this month" value="233" sub="100% idempotent" tone="green" /><MiniMetric label="Actions approved" value="184" sub="92% success rate" tone="purple" /></div><div className="card workflow-table-card"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot blue" /> Workflow library</div><h3>Safe, observable automations</h3></div><button className="filter-button"><Filter size={14} /> Filter</button></div><div className="workflow-list">{workflows.map((workflow) => <div className="workflow-row" key={workflow.name}><span className={`workflow-icon ${workflow.status === 'Active' ? 'active' : 'paused'}`}><Workflow size={17} /></span><span className="workflow-copy"><strong>{workflow.name}</strong><small><Radio size={12} /> {workflow.trigger}</small></span><span className="workflow-steps"><strong>{workflow.steps}</strong><small>steps</small></span><span className="workflow-runs"><strong>{workflow.runs}</strong><small>{workflow.updated}</small></span><span className={`status-badge ${workflow.status === 'Active' ? 'green' : 'neutral'}`}>{workflow.status}</span><button className="more-button"><MoreHorizontal size={17} /></button></div>)}</div></div></SectionScaffold>
}

function CampaignsPage({ onToast }: { onToast: (message: string, kind?: ToastKind) => void }) {
  const campaigns = [{ name: 'Summer essentials win-back', type: 'Email', audience: '38 VIP customers', status: 'Running', revenue: '$1,842', sent: 'Jun 10, 2024' }, { name: 'New customer welcome', type: 'Email', audience: '184 new customers', status: 'Completed', revenue: '$624', sent: 'Jun 07, 2024' }, { name: 'Abandoned checkout reminder', type: 'Email', audience: '84 high-intent shoppers', status: 'Draft', revenue: '—', sent: 'Not scheduled' }]
  return <SectionScaffold page="campaigns" actions={<><button className="button secondary"><Rows3 size={15} /> Template gallery</button><button className="button primary" onClick={() => onToast('Campaign composer opened.', 'info')}><Plus size={15} /> New campaign</button></>}><div className="campaign-hero"><div className="campaign-hero-copy"><span className="section-kicker"><span className="kicker-dot purple" /> Campaign center</span><h2>Messages with a measurable point of view.</h2><p>Every campaign has a suppression check, an unsubscribe link, and attribution baked in.</p><button className="button primary" onClick={() => onToast('Starting from the win-back template.', 'success')}><WandSparkles size={15} /> Start with AI</button></div><div className="campaign-hero-art"><div className="campaign-ring ring-one" /><div className="campaign-ring ring-two" /><div className="campaign-mail-card"><Mail size={22} /><span>+$1,842</span><small>AI-attributed revenue</small></div></div></div><div className="metric-strip"><MiniMetric label="Active campaigns" value="1" sub="2 drafts ready" tone="blue" /><MiniMetric label="Messages sent" value="384" sub="This month" tone="purple" /><MiniMetric label="Open rate" value="42.8%" sub="↑ 6.4% vs average" tone="green" /><MiniMetric label="Campaign revenue" value="$2,466" sub="Tracked & verified" tone="gold" /></div><div className="card campaign-table-card"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot purple" /> Recent campaigns</div><h3>Performance at a glance</h3></div><button className="text-button">View analytics <ArrowUpRight size={14} /></button></div><div className="campaign-list">{campaigns.map((campaign) => <div className="campaign-row" key={campaign.name}><span className="campaign-icon"><Mail size={17} /></span><span className="campaign-copy"><strong>{campaign.name}</strong><small>{campaign.type} · {campaign.audience}</small></span><span className={`status-badge ${campaign.status === 'Running' ? 'green' : campaign.status === 'Draft' ? 'neutral' : 'blue'}`}>{campaign.status}</span><span className="campaign-revenue"><strong>{campaign.revenue}</strong><small>attributed revenue</small></span><span className="campaign-date">{campaign.sent}</span><button className="more-button"><MoreHorizontal size={17} /></button></div>)}</div></div></SectionScaffold>
}

function CopilotPage({ onToast }: { onToast: (message: string, kind?: ToastKind) => void }) {
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState(false)
  return <SectionScaffold page="copilot" actions={<button className="button secondary"><Clock3 size={15} /> Thread history</button>}><div className="copilot-layout"><div className="copilot-main"><div className="copilot-welcome"><div className="copilot-orb"><Sparkles size={22} /></div><div><span className="section-kicker">PROFITPILOT COPILOT</span><h2>Ask the data a better question.</h2><p>Grounded answers only. Every response links back to a deterministic evidence pack.</p></div></div>{asked && <div className="copilot-answer"><div className="answer-head"><span className="copilot-small-orb"><Sparkles size={14} /></span><strong>Copilot</strong><span>just now</span></div><h3>Sales are up $2,720 compared with the previous 30 days.</h3><p>The lift is primarily explained by returning-customer revenue and the Premium Hoodie, which sold 23 units this week. I found three supporting signals:</p><div className="answer-evidence"><span><TrendingUp size={14} /> Returning revenue <strong>+18.2%</strong></span><span><Package size={14} /> Premium Hoodie <strong>23 units</strong></span><span><Users size={14} /> Repeat order rate <strong>31.8%</strong></span></div><div className="answer-footer"><span className="confidence-pill high"><span /> High confidence</span><button className="text-button" onClick={() => onToast('Evidence pack copied to clipboard.', 'success')}><ExternalLink size={14} /> Open evidence</button></div></div>}<div className="copilot-composer"><div className="composer-label"><span><Command size={14} /> 10 supported intents</span><span>Numbers are always from your store</span></div><div className="composer-input"><textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try: Why did sales change this week?" rows={2} /><button className="send-button" disabled={!query.trim()} onClick={() => { setAsked(true); setQuery('') }}><ArrowUpRight size={17} /></button></div><div className="suggested-prompts"><span>Try asking</span><button onClick={() => setQuery('Which products are at stockout risk?')}>Which products are at stockout risk?</button><button onClick={() => setQuery('What changed in revenue this week?')}>What changed in revenue this week?</button></div></div></div><aside className="copilot-sidebar card"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot blue" /> Recent threads</div><h3>Your questions</h3></div><button className="more-button"><MoreHorizontal size={17} /></button></div><div className="thread-list"><ThreadItem title="Why did sales change this week?" time="Today, 9:42 AM" active={asked} /><ThreadItem title="Which customers are at risk?" time="Yesterday" /><ThreadItem title="Show me my top products" time="Jun 8" /></div><button className="text-button full"><Plus size={14} /> New thread</button></aside></div></SectionScaffold>
}

function ThreadItem({ title, time, active }: { title: string; time: string; active?: boolean }) { return <button className={`thread-item ${active ? 'active' : ''}`}><MessageSquare size={15} /><span><strong>{title}</strong><small>{time}</small></span><ChevronRight size={14} /></button> }

function ReportsPage({ onToast }: { onToast: (message: string, kind?: ToastKind) => void }) {
  const reports = [{ name: 'Weekly revenue brief', period: 'Jun 03 – Jun 09, 2024', type: 'Weekly', size: '1.2 MB', status: 'Ready' }, { name: 'Monthly executive review', period: 'May 01 – May 31, 2024', type: 'Monthly', size: '2.8 MB', status: 'Ready' }, { name: 'Weekly revenue brief', period: 'May 27 – Jun 02, 2024', type: 'Weekly', size: '1.1 MB', status: 'Ready' }]
  return <SectionScaffold page="reports" actions={<><button className="button secondary"><Calendar size={15} /> Schedules</button><button className="button primary" onClick={() => onToast('Report generation queued.', 'success')}><Plus size={15} /> Generate report</button></>}><div className="report-banner"><div className="report-banner-icon"><FileBarChart size={24} /></div><div><span className="section-kicker">NEXT DELIVERY · TOMORROW AT 08:00</span><h2>Your weekly revenue brief is on autopilot.</h2><p>Closed-period reporting with the evidence behind every number.</p></div><button className="text-button">Manage schedule <ArrowUpRight size={14} /></button></div><div className="metric-strip"><MiniMetric label="Reports this year" value="24" sub="100% delivered on time" tone="blue" /><MiniMetric label="Latest report" value="2.8 MB" sub="Generated Jun 10" tone="purple" /><MiniMetric label="Recipients" value="3" sub="Merchant team" tone="green" /></div><div className="card vault-card"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot blue" /> PDF vault</div><h3>Past reports</h3></div><div className="table-search"><Search size={15} /><input placeholder="Search reports" /></div></div><div className="report-list">{reports.map((report, index) => <div className="report-row" key={`${report.name}-${report.period}`}><span className="report-file-icon"><FileText size={18} /></span><span className="report-copy"><strong>{report.name}</strong><small>{report.period} · {report.type}</small></span><span className="report-size">{report.size}</span><span className="status-badge green"><CheckCircle2 size={12} />{report.status}</span><button className="icon-button" onClick={() => onToast(`Downloading ${report.name.toLowerCase()}…`, 'info')}><Download size={16} /></button><button className="more-button"><MoreHorizontal size={17} /></button></div>)}</div></div></SectionScaffold>
}

function ExportsPage({ onToast }: { onToast: (message: string, kind?: ToastKind) => void }) {
  const exportTypes = [{ title: 'Orders export', description: 'Orders, line items, fulfillment, and attribution', icon: ShoppingBag, tone: 'blue', format: 'CSV · XLSX' }, { title: 'Customer export', description: 'Segments and lifetime value without sensitive PII', icon: Users, tone: 'purple', format: 'CSV · XLSX' }, { title: 'Audit log export', description: 'Immutable actions and approval history', icon: ShieldCheck, tone: 'green', format: 'CSV' }, { title: 'Revenue report', description: 'Closed-period metrics and evidence packs', icon: FileBarChart, tone: 'gold', format: 'PDF' }]
  return <SectionScaffold page="exports" actions={<button className="button secondary"><Clock3 size={15} /> Export history</button>}><div className="export-intro"><div><span className="section-kicker"><span className="kicker-dot blue" /> Take your data with you</span><h2>Clean exports. No surprises.</h2><p>Exports are generated in the background and stored securely for 7 days.</p></div><div className="export-limit"><span>PLAN LIMIT</span><strong>50,000 rows</strong><small>per export</small></div></div><div className="export-grid">{exportTypes.map((type) => { const Icon = type.icon; return <div className="card export-card" key={type.title}><span className={`export-icon ${type.tone}`}><Icon size={20} /></span><h3>{type.title}</h3><p>{type.description}</p><div className="export-card-bottom"><span>{type.format}</span><button className="button secondary" onClick={() => onToast(`${type.title} queued. We’ll notify you when it’s ready.`, 'success')}><Download size={14} /> Export</button></div></div> })}</div><div className="card export-history"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot green" /> Recent exports</div><h3>Ready to download</h3></div><button className="text-button">View all <ArrowUpRight size={14} /></button></div><div className="export-history-row"><span className="report-file-icon"><FileText size={17} /></span><span><strong>orders_jun_12_2024.csv</strong><small>Orders · 486 rows · Generated 4 min ago</small></span><span className="status-badge green">Ready</span><button className="button secondary" onClick={() => onToast('Download started.', 'success')}><Download size={14} /> Download</button></div></div></SectionScaffold>
}

function SupportPage({ onToast }: { onToast: (message: string, kind?: ToastKind) => void }) {
  return <SectionScaffold page="support" actions={<button className="button primary" onClick={() => onToast('New support ticket created.', 'success')}><Plus size={15} /> New ticket</button>}><div className="support-hero"><div className="support-hero-icon"><LifeBuoy size={22} /></div><div><span className="section-kicker">REAL PEOPLE, WHEN YOU NEED THEM</span><h2>How can we help you grow?</h2><p>Your support history is always available to your team and the ProfitPilot operators.</p></div><div className="support-sla"><span>YOUR PLAN SLA</span><strong>24 hours</strong><small>Growth priority support</small></div></div><div className="support-grid"><section className="card ticket-card"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot blue" /> Your tickets</div><h3>Open conversations</h3></div><button className="filter-button"><Filter size={14} /> Filter</button></div><div className="ticket-list"><TicketRow id="#TK-0284" title="Question about campaign attribution" status="In progress" updated="Updated 18 min ago" priority="High" /><TicketRow id="#TK-0279" title="Help connecting merchant email" status="Waiting on you" updated="Updated yesterday" priority="Normal" /><TicketRow id="#TK-0268" title="Understanding my health score" status="Resolved" updated="Resolved Jun 8" priority="Normal" /></div></section><section className="card support-links"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot purple" /> Learn</div><h3>Helpful resources</h3></div></div><ResourceLink icon={FileText} title="ProfitPilot playbook" detail="Learn the core loop" /><ResourceLink icon={ShieldCheck} title="Safety & permissions" detail="How approvals work" /><ResourceLink icon={CircleHelp} title="Help center" detail="Answers to common questions" /><ResourceLink icon={MessageSquare} title="Message the team" detail="Usually replies in 4 hours" /></section></div></SectionScaffold>
}

function TicketRow({ id, title, status, updated, priority }: { id: string; title: string; status: string; updated: string; priority: string }) { return <button className="ticket-row"><span className="ticket-icon"><TicketCheck size={16} /></span><span><strong>{title}</strong><small>{id} · {updated}</small></span><span className={`status-badge ${status === 'Resolved' ? 'green' : status === 'Waiting on you' ? 'amber' : 'blue'}`}>{status}</span><span className="ticket-priority">{priority}</span><ChevronRight size={15} /></button> }
function ResourceLink({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) { return <button className="resource-link"><span className="resource-icon"><Icon size={16} /></span><span><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={14} /></button> }

function BillingPage({ onToast, onNavigate }: { onToast: (message: string, kind?: ToastKind) => void; onNavigate: (page: PageKey) => void }) {
  return <SectionScaffold page="billing" actions={<button className="button secondary"><FileText size={15} /> Invoice history</button>}><div className="billing-current"><div className="billing-plan"><span className="plan-icon"><Rocket size={19} /></span><div><span className="section-kicker">CURRENT PLAN</span><h2>Growth <span>· $149 / month</span></h2><p>Your next billing date is July 12, 2024.</p></div><span className="status-badge green">Active</span></div><button className="button primary" onClick={() => onToast('Plan change flow opened.', 'info')}>Manage plan <ArrowUpRight size={15} /></button></div><div className="billing-grid"><section className="card usage-panel"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot blue" /> Plan usage</div><h3>This billing period</h3></div><span className="muted-cell">Jun 12, 2024</span></div><Quota label="AI recommendations" used="124" total="150" percent={82.6} tone="blue" /><Quota label="Jarvis messages" used="486" total="700" percent={69.4} tone="purple" /><Quota label="Email sends" used="8,240" total="15,000" percent={54.9} tone="green" /><Quota label="Automation workflows" used="8" total="15" percent={53.3} tone="gold" /><button className="text-button full" onClick={() => onNavigate('settings')}>View all entitlements <ArrowUpRight size={14} /></button></section><section className="card roi-panel"><div className="card-heading"><div><div className="section-kicker"><span className="kicker-dot gold" /> Return on AI</div><h3>Is ProfitPilot paying for itself?</h3></div><button className="more-button"><MoreHorizontal size={17} /></button></div><div className="roi-value"><strong>$3,842</strong><span>AI-attributed revenue</span></div><div className="roi-bar"><span style={{ width: '78%' }} /></div><div className="roi-breakdown"><span>ProfitPilot cost <strong>$149</strong></span><span>Return <strong className="positive">25.8x</strong></span></div><div className="roi-note"><Sparkles size={14} /> Attribution is measured from signed tracking links and verified orders.</div></section></div><div className="plan-comparison"><div className="plan-comparison-head"><div><span className="section-kicker"><span className="kicker-dot purple" /> Plans that grow with you</span><h2>Keep more of what you grow.</h2></div><div className="billing-toggle"><button className="active">Monthly</button><button>Annual <span>2 months free</span></button></div></div><div className="plan-cards"><PlanCard name="Start" price="$49" desc="For new stores finding their rhythm" features={['30 AI recommendations', '3 active AI agents', '1,000 products synced']} /><PlanCard name="Growth" price="$149" desc="For stores ready to scale with confidence" features={['150 AI recommendations', '6 active AI agents', '15,000 email sends']} current /><PlanCard name="Commander" price="$349" desc="For teams making growth a system" features={['Unlimited recommendations', 'All 7 AI agents', 'Advanced attribution']} /></div></div></SectionScaffold>
}

function Quota({ label, used, total, percent, tone }: { label: string; used: string; total: string; percent: number; tone: string }) { return <div className="quota"><div><span>{label}</span><strong>{used} <small>/ {total}</small></strong></div><div className="usage-track"><span className={percent > 80 ? 'near-limit' : ''} style={{ width: `${percent}%` }} /></div><small>{percent.toFixed(0)}% used</small></div> }
function PlanCard({ name, price, desc, features, current }: { name: string; price: string; desc: string; features: string[]; current?: boolean }) { return <div className={`plan-card ${current ? 'current' : ''}`}>{current && <span className="popular-tag">CURRENT PLAN</span>}<h3>{name}</h3><div className="plan-price"><strong>{price}</strong><span>/mo</span></div><p>{desc}</p><div className="plan-features">{features.map((feature) => <span key={feature}><Check size={14} />{feature}</span>)}</div><button className={`button ${current ? 'secondary' : 'ghost'}`}>{current ? 'Your current plan' : 'Explore plan'}</button></div> }

function SettingsPage({ onToast, lightMode, onToggleTheme }: { onToast: (message: string, kind?: ToastKind) => void; lightMode: boolean; onToggleTheme: () => void }) {
  return <SectionScaffold page="settings"><div className="settings-layout"><aside className="settings-nav card"><button className="settings-nav-item active"><Settings size={15} /> General</button><button className="settings-nav-item"><Bell size={15} /> Notifications</button><button className="settings-nav-item"><Bot size={15} /> Jarvis preferences</button><button className="settings-nav-item"><Users size={15} /> Team members</button><button className="settings-nav-item"><Mail size={15} /> Merchant email</button><button className="settings-nav-item"><ShieldCheck size={15} /> Security & audit</button><button className="settings-nav-item danger"><Trash2 size={15} /> Danger zone</button></aside><div className="settings-panels"><SettingsPanel title="Store preferences" description="Control how ProfitPilot speaks about your store."><SettingRow label="Store name" description="Shown in your workspace and reports"><input className="setting-input" value="Nouri Supply Co." readOnly /></SettingRow><SettingRow label="Timezone" description="Used for reports, schedules, and greetings"><button className="setting-select"><Globe2 size={14} /> America/New_York <ChevronDown size={14} /></button></SettingRow><SettingRow label="Currency" description="How revenue and impact are displayed"><button className="setting-select">USD · US Dollar <ChevronDown size={14} /></button></SettingRow></SettingsPanel><SettingsPanel title="Appearance" description="Make ProfitPilot feel like your workspace."><SettingRow label="Theme" description="Dark mode is easier on the eyes at night"><div className="theme-choice"><button className={!lightMode ? 'selected' : ''} onClick={() => lightMode && onToggleTheme()}><Moon size={15} /> Dark</button><button className={lightMode ? 'selected' : ''} onClick={() => !lightMode && onToggleTheme()}><Sun size={15} /> Light</button></div></SettingRow><SettingRow label="Reduced motion" description="Respect your system accessibility preference"><Toggle on={false} /></SettingRow></SettingsPanel><SettingsPanel title="Notifications" description="Choose which moments deserve your attention."><SettingRow label="Daily briefing" description="A concise summary at the start of your day"><Toggle on /></SettingRow><SettingRow label="High-priority stockouts" description="Only alerts that could impact revenue in 7 days"><Toggle on /></SettingRow><SettingRow label="Campaign performance" description="Weekly digest of sends and attribution"><Toggle on /></SettingRow></SettingsPanel><div className="settings-save"><span><ShieldCheck size={15} /> Changes are saved automatically</span><button className="button primary" onClick={() => onToast('Settings are up to date.', 'success')}>Save changes</button></div></div></div></SectionScaffold>
}
function SettingsPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <section className="card settings-panel"><div className="settings-panel-head"><div><h3>{title}</h3><p>{description}</p></div></div><div className="settings-rows">{children}</div></section> }
function SettingRow({ label, description, children }: { label: string; description: string; children: ReactNode }) { return <div className="setting-row"><div><strong>{label}</strong><small>{description}</small></div>{children}</div> }
function Toggle({ on }: { on: boolean }) { return <span className={`toggle ${on ? 'on' : ''}`}><span /></span> }

function JarvisOrb({ onClick }: { onClick: () => void }) { return <button className="jarvis-orb-wrap" onClick={onClick} aria-label="Open Jarvis"><span className="jarvis-orb-ring ring-a" /><span className="jarvis-orb-ring ring-b" /><span className="jarvis-orb"><span className="orb-core" /><span className="orb-shine" /></span><span className="jarvis-orb-label">Ask Jarvis</span></button> }

function JarvisPanel({ onClose, onStartLive, onToast, activePage }: { onClose: () => void; onStartLive: () => void; onToast: (message: string, kind?: ToastKind) => void; activePage: string }) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState([{ from: 'jarvis', text: `Good morning, Sir. I’m looking at ${activePage.toLowerCase()} with you. What would you like to understand?` }])
  const sendMessage = () => { if (!message.trim()) return; const next = message.trim(); setMessages((current) => [...current, { from: 'user', text: next }, { from: 'jarvis', text: 'I’ll ground that in your store data. I found a high-confidence signal and can show you the evidence pack.' }]); setMessage(''); onToast('Jarvis prepared an evidence-backed answer.', 'success') }
  return <aside className="jarvis-panel"><div className="jarvis-panel-header"><div className="jarvis-title"><span className="jarvis-mini-orb"><span /></span><span><strong>Jarvis</strong><small>Your AI employee</small></span><span className="live-label"><i /> Online</span></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="jarvis-context"><span><Radio size={13} /> Page-aware</span><span>{activePage}</span></div><div className="jarvis-messages">{messages.map((item, index) => <div className={`jarvis-message ${item.from}`} key={`${item.text}-${index}`}>{item.from === 'jarvis' && <span className="message-orb"><Sparkles size={12} /></span>}<p>{item.text}</p></div>)}</div><div className="jarvis-suggestions"><button onClick={() => setMessage('Show me today’s biggest opportunity')}>Biggest opportunity</button><button onClick={() => setMessage('What needs my attention?')}>What needs attention?</button></div><div className="jarvis-composer"><textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage() } }} placeholder="Ask Jarvis anything about your store…" rows={2} /><div className="jarvis-composer-actions"><button className="icon-button"><Mic size={16} /></button><span>Enter to send</span><button className="send-button" disabled={!message.trim()} onClick={sendMessage}><ArrowUpRight size={16} /></button></div></div><div className="jarvis-panel-footer"><button onClick={onStartLive}><Volume2 size={15} /> Start voice mode</button><span><ShieldCheck size={12} /> PII-safe by design</span></div></aside>
}

function JarvisLiveBar({ onEnd, onPause, onOpen }: { onEnd: () => void; onPause: () => void; onOpen: () => void }) { return <div className="jarvis-live-bar"><div className="live-bar-brand"><span className="jarvis-mini-orb"><span /></span><strong>Jarvis Live</strong><span className="live-bar-status"><i /> Listening</span></div><div className="live-bar-center"><span className="audio-wave"><i /><i /><i /><i /><i /><i /><i /></span><span>Say “show me” to open evidence</span></div><div className="live-bar-actions"><button onClick={onPause}><Pause size={14} /> Pause</button><button onClick={onOpen}><MessageSquare size={14} /> Chat</button><button className="end-session" onClick={onEnd}><X size={14} /> End session</button></div></div> }

function NotificationDrawer({ onClose, onNavigate }: { onClose: () => void; onNavigate: (page: PageKey) => void }) { return <><button className="drawer-backdrop" onClick={onClose} aria-label="Close notifications" /><aside className="notification-drawer"><div className="drawer-header"><div><span className="drawer-kicker"><Bell size={13} /> NOTIFICATIONS</span><h2>Worth your attention</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="notification-tabs"><button className="active">All <span>4</span></button><button>Unread <span>2</span></button></div><div className="notifications-list"><NotificationItem icon={AlertTriangle} tone="amber" title="Premium Hoodie may stock out" detail="4 days of cover at current velocity" time="21 min ago" onClick={() => { onNavigate('inventory'); onClose() }} /><NotificationItem icon={Sparkles} tone="purple" title="New recommendation ready" detail="38 high-value customers are at risk" time="8 min ago" onClick={() => { onNavigate('recommendations'); onClose() }} unread /><NotificationItem icon={CheckCircle2} tone="green" title="Win-back campaign converted" detail="Sarah purchased · +$189 attributed" time="12 min ago" onClick={() => { onNavigate('campaigns'); onClose() }} /><NotificationItem icon={FileText} tone="blue" title="Weekly report is ready" detail="Your report is available in the vault" time="2 hrs ago" onClick={() => { onNavigate('reports'); onClose() }} /></div><button className="text-button full">Mark all as read <Check size={14} /></button></aside></> }
function NotificationItem({ icon: Icon, tone, title, detail, time, unread, onClick }: { icon: LucideIcon; tone: string; title: string; detail: string; time: string; unread?: boolean; onClick: () => void }) { return <button className={`notification-item ${unread ? 'unread' : ''}`} onClick={onClick}><span className={`notification-icon ${tone}`}><Icon size={15} /></span><span><strong>{title}</strong><small>{detail}</small><em>{time}</em></span>{unread && <i className="unread-dot" />}</button> }

function CommandPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate: (page: PageKey) => void }) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => { const normalized = query.toLowerCase(); return navGroups.flatMap((group) => group.items).filter((item) => item.label.toLowerCase().includes(normalized)).slice(0, 8) }, [query])
  return <div className="command-overlay" role="dialog" aria-modal="true"><button className="command-overlay-close" onClick={onClose} aria-label="Close search" /><div className="command-panel"><div className="command-input-wrap"><Search size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages, actions, and insights…" /><kbd>ESC</kbd></div><div className="command-results"><span className="command-section-label">Navigate</span>{results.map((item) => { const Icon = item.icon; return <button key={item.id} className="command-result" onClick={() => onNavigate(item.id)}><span className="command-result-icon"><Icon size={16} /></span><span>{item.label}</span><ChevronRight size={15} /></button> })}{results.length === 0 && <div className="command-empty"><Search size={20} /><strong>No matching pages</strong><span>Try a different search.</span></div>}</div><div className="command-footer"><span><ArrowUpRight size={13} /> Open</span><span><ChevronDown size={13} /><ChevronUp size={13} /> Navigate</span><span><span className="esc-key">ESC</span> Close</span></div></div></div>
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) { return <div className={`toast ${toast.kind}`}><span className="toast-icon">{toast.kind === 'success' ? <CheckCircle2 size={16} /> : toast.kind === 'warning' ? <AlertTriangle size={16} /> : <Info size={16} />}</span><span>{toast.message}</span><button onClick={onClose} aria-label="Close notification"><X size={15} /></button></div> }

export default App
