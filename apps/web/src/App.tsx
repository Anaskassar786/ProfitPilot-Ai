import { useEffect, useMemo, useRef, useState } from 'react'
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
import { analyzeRecommendations, createBillingCharge, resetSyncCircuit, createCampaignTemplate, createTicket, decideRecommendation, exportRows, fetchAgentStatuses, fetchAnalytics, fetchBilling, fetchBillingPlans, fetchBillingRoi, fetchBillingUsage, fetchCampaignTemplates, fetchCatalog, fetchInventory, fetchJarvisPreferences, initializeCsrf, fetchRecommendations, fetchSessionContext, fetchTickets, redeemGiftCode, requestSync, requestSyncAll, saveMerchantEmail, verifyMerchantEmail, ApiClientError } from './api.js'
import { AutomationWorkspace } from './automation.js'
import type { AgentStatus, AnalyticsSnapshot, CatalogProduct, Recommendation, SectionId, WorkspaceContext } from './model.js'
import type { InventoryPageResult } from './inventory-model.js'
import { CopilotWorkspace, JarvisExperience, ReportsWorkspace } from './f8.js'
import { AdminOpsWorkspace } from './f9.js'
import type { JarvisEvidence, JarvisPreference } from './f8-model.js'
import { PASSIVE_RECOMMENDATION_INTERVAL_MS, PASSIVE_SNOOZE_MS, passiveRecommendationsAllowed, selectPassiveRecommendation } from './passive-jarvis.js'
import {
  averageOrderValue,
  formatMoney,
  formatNumber,
  formatStoreDisplayName,
  latestSyncLabel,
  revenuePoints,
  storeHealthView,
  sumOrders,
  sumRevenue,
  workspaceContext,
} from './model.js'
import type { ChartPeriod } from './model.js'
import { DashboardLayout } from './dashboard.js'
import { CommandCenterWorkspace } from './command-center.js'
import { ProductsWorkspace } from './products.js'
import { OrdersWorkspace } from './orders.js'
import { CustomersPage } from './customers.js'
import { InventoryWorkspace } from './inventory.js'
import { AnalyticsPage as RedesignedAnalyticsPage } from './analytics.js'
import { RecommendationsWorkspace } from './recommendations.js'

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
      { id: 'command-center', label: 'AI Command Center', icon: Bot, tag: 'AI' },
      { id: 'recommendations', label: 'Recommendations', icon: WandSparkles, tag: 'AI' },
      { id: 'automation', label: 'Automation', icon: Workflow, tag: 'Automate' },
      { id: 'campaigns', label: 'Campaigns', icon: Send, tag: 'Marketing' },
      { id: 'copilot', label: 'Copilot', icon: Sparkles, tag: 'Ask' },
    ],
  },
  {
    label: 'Business',
    items: [
      { id: 'reports', label: 'Reports', icon: FileBarChart, tag: 'Reports' },
      { id: 'exports', label: 'Exports', icon: Download },
      { id: 'support', label: 'Support tickets', icon: LifeBuoy },
      { id: 'billing', label: 'Billing', icon: WalletCards, tag: 'Plans' },
      { id: 'settings', label: 'Settings', icon: Settings },
      { id: 'admin-ops', label: 'Admin Ops', icon: ShieldCheck, tag: 'Admin' },
    ],
  },
]

const pageMeta: Readonly<Record<SectionId, Readonly<{ title: string; description: string; icon: LucideIcon }>>> = {
  dashboard: { title: 'Dashboard', description: 'A clear view of the store data ProfitPilot is receiving.', icon: LayoutDashboard },
  products: { title: 'Products', description: 'Catalog records synced from Shopify, with no invented inventory.', icon: Package },
  orders: { title: 'Orders', description: 'Search, filter, inspect, and export real Shopify orders with plan-aware intelligence.', icon: ShoppingBag },
  customers: { title: 'Customers', description: 'Customer data stays tenant-scoped and minimized by default.', icon: Users },
  inventory: { title: 'Inventory', description: 'Inventory levels and days-of-cover from your Shopify store.', icon: Box },
  analytics: { title: 'Analytics', description: 'AI-powered insights into your store performance.', icon: LineChart },
  'command-center': { title: 'AI Command Center', description: 'Seven agents explain deterministic store evidence. They never invent numbers.', icon: Bot },
  recommendations: { title: 'Recommendations', description: 'Evidence-backed decisions from your synced Shopify data.', icon: WandSparkles },
  automation: { title: 'Automation', description: 'Design and activate workflows. High-risk steps still need approval.', icon: Workflow },
  campaigns: { title: 'Campaigns', description: 'Email customers from your verified merchant address after you approve a send.', icon: Send },
  copilot: { title: 'Copilot', description: 'A grounded query surface for the evidence packs built by ProfitPilot.', icon: Sparkles },
  reports: { title: 'Reports', description: 'Closed-period PDF reports built from your real store data.', icon: FileBarChart },
  exports: { title: 'Exports', description: 'Export real synced records when the data plane has something to deliver.', icon: Download },
  support: { title: 'Support tickets', description: 'A direct, auditable line to the ProfitPilot team.', icon: LifeBuoy },
  billing: { title: 'Billing', description: 'Your trial, plan, usage, and verified AI return on this store.', icon: WalletCards },
  settings: { title: 'Settings', description: 'Store context, preferences, and security controls.', icon: Settings },
  'admin-ops': { title: 'Admin Ops', description: 'Launch controls, merchant flags, queue inspection, and retries.', icon: ShieldCheck },
}

type NavItem = Readonly<{ id: SectionId; label: string; icon: LucideIcon; tag?: string }>
type LoadState = 'idle' | 'loading' | 'ready' | 'partial' | 'offline'
type ToastKind = 'success' | 'info' | 'warning' | 'error'
type ToastState = Readonly<{ message: string; kind: ToastKind }>
const syncModules = ['products', 'orders', 'customers', 'inventory', 'checkouts', 'collections', 'discounts', 'transactions'] as const
type SyncModuleProgress = Readonly<{ module: (typeof syncModules)[number]; status: 'syncing' | 'succeeded' | 'failed'; detail: string }>

type WorkspaceData = Readonly<{ analytics: AnalyticsSnapshot | null; catalog: readonly CatalogProduct[]; agents: readonly AgentStatus[]; recommendations: readonly Recommendation[]; inventory: InventoryPageResult | null; loadState: LoadState; error: string | null }>

export default function App() {
  // PR #46: a #/recommendations deep link (with optional /:id) opens the
  // Recommendations page directly, so shared links and refreshes land where
  // the user expects instead of resetting to the dashboard.
  const [activePage, setActivePage] = useState<SectionId>(() => (window.location.hash.startsWith('#/recommendations') ? 'recommendations' : 'dashboard'))
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [jarvisOpen, setJarvisOpen] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [jarvisEvidence, setJarvisEvidence] = useState<JarvisEvidence | null>(null)
  const [jarvisPreference, setJarvisPreference] = useState<JarvisPreference | null>(null)
  const [passiveRecommendation, setPassiveRecommendation] = useState<Recommendation | null>(null)
  const [selectedRecommendation, setSelectedRecommendation] = useState<Recommendation | null>(null)
  const dismissedRecommendationIds = useRef(new Set<string>())
  const shownRecommendationIds = useRef(new Set<string>())
  const snoozedRecommendations = useRef<Readonly<Record<string, number>>>({})
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [readNotificationIds, setReadNotificationIds] = useState<ReadonlySet<string>>(new Set())
  const [lightMode, setLightMode] = useState(() => {
    try {
      const stored = window.localStorage.getItem('profitpilot:theme')
      if (stored === 'light') return true
      if (stored === 'dark') return false
      // Fallback to prefers-color-scheme for first-time visitors
      if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: light)').matches
      }
      return false
    } catch {
      return false
    }
  })
  const [toast, setToast] = useState<ToastState | null>(null)
  const [syncProgress, setSyncProgress] = useState<readonly SyncModuleProgress[]>([])
  const [syncAllRunning, setSyncAllRunning] = useState(false)
  const [data, setData] = useState<WorkspaceData>({ analytics: null, catalog: [], agents: [], recommendations: [], inventory: null, loadState: 'idle', error: null })
  // Tenant context comes first from the URL (the post-OAuth redirect carries
  // storeId/shop/host), then from the session cookie via /session/context so a
  // refresh inside Shopify admin keeps the workspace attached.
  const urlContext = useMemo(() => workspaceContext(window.location.search), [])
  const [resolvedContext, setResolvedContext] = useState<WorkspaceContext>({ storeId: null, shop: null })
  const context: WorkspaceContext = { storeId: urlContext.storeId ?? resolvedContext.storeId, shop: urlContext.shop ?? resolvedContext.shop }

  useEffect(() => {
    if (urlContext.storeId) return
    const query = urlContext.shop ? `?shop=${encodeURIComponent(urlContext.shop)}` : ''
    void fetchSessionContext(query)
      .then((result) => setResolvedContext(result))
      .catch(() => setResolvedContext({ storeId: null, shop: null }))
  }, [urlContext.storeId, urlContext.shop])

  useEffect(() => {
    // Unsafe requests (sync, billing, tickets, ...) must echo a signed CSRF
    // token once the session cookie is present, or the API rejects them.
    void initializeCsrf().catch(() => {})
  }, [])

  const showToast = (message: string, kind: ToastKind = 'success') => {
    setToast({ message, kind })
    window.setTimeout(() => setToast(null), 3600)
  }

  const loadData = async () => {
    if (!context.storeId) {
      setData({ analytics: null, catalog: [], agents: [], recommendations: [], inventory: null, loadState: 'idle', error: null })
      return
    }
    setData((current) => ({ ...current, loadState: 'loading', error: null }))
    // Inventory is loaded here too so a sync immediately refreshes real stock
    // levels instead of leaving the Inventory page on stale or empty data.
    const [analyticsResult, catalogResult, agentsResult, recommendationsResult, inventoryResult] = await Promise.allSettled([fetchAnalytics(context.storeId), fetchCatalog(context.storeId), fetchAgentStatuses(), fetchRecommendations(context.storeId), fetchInventory(context.storeId)])
    const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : null
    const catalog = catalogResult.status === 'fulfilled' ? catalogResult.value : []
    const agents = agentsResult.status === 'fulfilled' ? agentsResult.value : []
    const recommendations = recommendationsResult.status === 'fulfilled' ? recommendationsResult.value : []
    const inventory = inventoryResult.status === 'fulfilled' ? inventoryResult.value : null
    const errors = [analyticsResult, catalogResult].filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    setData({ analytics, catalog, agents, recommendations, inventory, loadState: errors.length === 2 ? 'offline' : errors.length > 0 ? 'partial' : 'ready', error: errors[0] ? `Some synced data could not be loaded: ${errorMessage(errors[0].reason)}` : null })
  }

  useEffect(() => { void loadData() }, [context.storeId])

  // PR #46: notification read-state is per store and survives reloads.
  useEffect(() => {
    if (!context.storeId) { setReadNotificationIds(new Set()); return }
    setReadNotificationIds(new Set(readStoredStringArray(`profitpilot:notifications:read:${context.storeId}`)))
  }, [context.storeId])
  const persistReadNotifications = (ids: readonly string[]) => { if (context.storeId) storeStringArray(`profitpilot:notifications:read:${context.storeId}`, [...new Set(ids)]) }
  const unreadNotificationIds = useMemo(() => new Set(data.recommendations.filter((item) => item.status === 'PENDING' && !readNotificationIds.has(item.id)).map((item) => item.id)), [data.recommendations, readNotificationIds])

  useEffect(() => {
    if (!context.storeId) { setJarvisPreference(null); setPassiveRecommendation(null); return }
    const storeId = context.storeId
    let cancelled = false
    let timer: number | null = null
    dismissedRecommendationIds.current = new Set(readStoredStringArray(`profitpilot:jarvis:dismissed:${storeId}`))
    snoozedRecommendations.current = readStoredNumberRecord(`profitpilot:jarvis:snoozed:${storeId}`)
    shownRecommendationIds.current = new Set()
    setPassiveRecommendation(null)
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return
      const [recommendationsResult, preferenceResult] = await Promise.allSettled([fetchRecommendations(storeId), fetchJarvisPreferences(storeId)])
      if (cancelled) return
      if (recommendationsResult.status === 'fulfilled') setData((current) => ({ ...current, recommendations: recommendationsResult.value }))
      if (preferenceResult.status === 'fulfilled') setJarvisPreference(preferenceResult.value)
    }
    const startTimer = () => {
      if (timer !== null) window.clearInterval(timer)
      timer = document.visibilityState === 'visible' ? window.setInterval(() => { void refresh() }, PASSIVE_RECOMMENDATION_INTERVAL_MS) : null
    }
    const onVisibility = () => { startTimer(); if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisibility)
    startTimer()
    void refresh()
    return () => { cancelled = true; if (timer !== null) window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [context.storeId])

  useEffect(() => {
    if (!context.storeId || !passiveRecommendationsAllowed(jarvisPreference)) { setPassiveRecommendation(null); return }
    if (passiveRecommendation && passiveRecommendation.status === 'PENDING' && data.recommendations.some((item) => item.id === passiveRecommendation.id && item.status === 'PENDING')) return
    const next = selectPassiveRecommendation({ recommendations: data.recommendations, preference: jarvisPreference, dismissedIds: dismissedRecommendationIds.current, shownIds: shownRecommendationIds.current, snoozedUntil: snoozedRecommendations.current })
    if (next) shownRecommendationIds.current.add(next.id)
    setPassiveRecommendation(next)
  }, [context.storeId, data.recommendations, jarvisPreference, passiveRecommendation])

  // Theme persistence — Q9
  useEffect(() => {
    try {
      window.localStorage.setItem('profitpilot:theme', lightMode ? 'light' : 'dark')
    } catch {
      // localStorage may be disabled
    }
  }, [lightMode])

  // Sync All auto-dismiss — Fix 1.2: 3.5s success, 6s failure with fade
  const [syncDismissing, setSyncDismissing] = useState(false)
  useEffect(() => {
    if (syncProgress.length === 0) {
      setSyncDismissing(false)
      return
    }
    const hasFailed = syncProgress.some((m) => m.status === 'failed')
    const delay = hasFailed ? 6000 : 3500
    // Start fade a bit before clearing
    const fadeTimer = window.setTimeout(() => setSyncDismissing(true), delay - 400)
    const clearTimer = window.setTimeout(() => {
      setSyncProgress([])
      setSyncDismissing(false)
    }, delay)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(clearTimer)
    }
  }, [syncProgress])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true) }
      if (event.key === '?' && !isTypingTarget(event.target)) setShortcutsOpen(true)
      if (event.key === 'Escape') { setCommandOpen(false); setNotificationsOpen(false); setProfileOpen(false); setEvidenceOpen(false); setShortcutsOpen(false) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const navigate = (page: SectionId) => {
    if (page === 'automation' && !window.location.pathname.startsWith('/automation')) window.history.pushState({}, '', `/automation${window.location.search}`)
    else if (page !== 'automation' && window.location.pathname.startsWith('/automation')) window.history.pushState({}, '', `/${window.location.search}`)
    setActivePage(page)
    setMobileOpen(false)
    setCommandOpen(false)
    // Leaving Recommendations clears its hash route so a later refresh does
    // not bounce back; entering it establishes the base route for deep links.
    try {
      if (page === 'recommendations') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/recommendations`)
      else if (window.location.hash.startsWith('#/recommendations')) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    } catch { /* embedded browsers may restrict history access */ }
  }

  // Browser back/forward between the recommendations hash route and other
  // pages keeps the visible page in sync.
  useEffect(() => {
    const onHashNavigation = () => {
      const onRecommendations = window.location.hash.startsWith('#/recommendations')
      setActivePage((current) => (onRecommendations ? 'recommendations' : current === 'recommendations' ? 'dashboard' : current))
    }
    window.addEventListener('popstate', onHashNavigation)
    window.addEventListener('hashchange', onHashNavigation)
    return () => { window.removeEventListener('popstate', onHashNavigation); window.removeEventListener('hashchange', onHashNavigation) }
  }, [])
  const sync = async (module: string) => {
    if (!context.storeId) { setOnboardingOpen(true); return }
    try {
      await requestSync(context.storeId, module)
      showToast(`${module} synced from Shopify.`, 'success')
      await loadData()
    } catch (error: unknown) {
      // A 503 with an open Shopify circuit is recoverable: close the breaker
      // and retry once so a burst of earlier failures does not keep the store
      // locked out for the whole cooldown window.
      if (isCircuitOpen(error)) {
        try {
          await resetSyncCircuit(context.storeId)
          await requestSync(context.storeId, module)
          showToast(`${module} synced after clearing the Shopify circuit.`, 'success')
          await loadData()
          return
        } catch (retryError: unknown) { showToast(errorMessage(retryError), 'error'); return }
      }
      showToast(errorMessage(error), 'error')
    }
  }
  const syncAll = async () => {
    if (!context.storeId) { setOnboardingOpen(true); return }
    setSyncAllRunning(true)
    setSyncProgress(syncModules.map((module) => ({ module, status: 'syncing', detail: 'Sync in progress…' })))
    try {
      const result = await requestSyncAll(context.storeId)
      setSyncProgress(syncModules.map((module) => {
        const report = result.modules.find((item) => item.module === module)
        if (!report) return { module, status: 'failed', detail: 'No module report returned' }
        return report.status === 'succeeded'
          ? { module, status: 'succeeded', detail: `${report.result.records} records · ${report.result.pages} pages` }
          : { module, status: 'failed', detail: report.error.message }
      }))
      showToast(result.failed.length > 0 ? `Sync all finished: ${result.succeeded.length} succeeded, ${result.failed.length} failed.` : 'Sync all finished successfully for all 8 modules.', result.failed.length > 0 ? 'warning' : 'success')
      await loadData()
    } catch (error: unknown) {
      const message = errorMessage(error)
      setSyncProgress(syncModules.map((module) => ({ module, status: 'failed', detail: message })))
      showToast(message, 'error')
    } finally {
      setSyncAllRunning(false)
    }
  }
  const phaseGate = (phase: string, capability: string) => {
    try { throw new PhaseNotImplementedError(phase, capability) } catch (error: unknown) { showToast(error instanceof Error ? error.message : 'This capability is phase-gated.', 'info') }
  }
  const dismissPassiveRecommendation = () => {
    if (!passiveRecommendation || !context.storeId) return
    dismissedRecommendationIds.current.add(passiveRecommendation.id)
    storeStringArray(`profitpilot:jarvis:dismissed:${context.storeId}`, [...dismissedRecommendationIds.current])
    setPassiveRecommendation(null)
  }
  const snoozePassiveRecommendation = () => {
    if (!passiveRecommendation || !context.storeId) return
    const next = { ...snoozedRecommendations.current, [passiveRecommendation.id]: Date.now() + PASSIVE_SNOOZE_MS }
    snoozedRecommendations.current = next
    shownRecommendationIds.current.delete(passiveRecommendation.id)
    storeNumberRecord(`profitpilot:jarvis:snoozed:${context.storeId}`, next)
    setPassiveRecommendation(null)
  }
  const reviewPassiveRecommendation = () => {
    if (!passiveRecommendation) return
    setSelectedRecommendation(passiveRecommendation)
    setJarvisEvidence(null)
    setJarvisOpen(true)
    setEvidenceOpen(true)
    setPassiveRecommendation(null)
  }

  return (
    <div className={`app-shell ${lightMode ? 'light-mode' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Sidebar activePage={activePage} collapsed={collapsed} mobileOpen={mobileOpen} context={context} onNavigate={navigate} onCollapse={() => setCollapsed((value) => !value)} onClose={() => setMobileOpen(false)} onOpenCommand={() => setCommandOpen(true)} onOnboarding={() => setOnboardingOpen(true)} />
      <main id="main-content" tabIndex={-1} className={`main-shell ${collapsed ? 'sidebar-is-collapsed' : ''}`}>
        <TopBar active={pageMeta[activePage]} unreadCount={unreadNotificationIds.size} onMenu={() => setMobileOpen(true)} onCommand={() => setCommandOpen(true)} onNotifications={() => setNotificationsOpen(true)} onProfile={() => setProfileOpen((value) => !value)} profileOpen={profileOpen} lightMode={lightMode} onTheme={() => setLightMode((value) => !value)} onShortcuts={() => setShortcutsOpen(true)} />
        <div className="page-scroll">
          {(data.loadState === 'offline' || data.loadState === 'partial') && <OfflineBanner error={data.error} partial={data.loadState === 'partial'} onRetry={() => void loadData()} />}
          {!context.storeId && <ContextBanner onConnect={() => setOnboardingOpen(true)} />}
          <PageRouter
            active={activePage}
            context={context}
            data={data}
            onNavigate={navigate}
            onSync={sync}
            onSyncAll={syncAll}
            syncProgress={syncProgress}
            syncAllRunning={syncAllRunning}
            syncDismissing={syncDismissing}
            onRefresh={() => void loadData()}
            onToast={showToast}
            onPhaseGate={phaseGate}
            lightMode={lightMode}
            onTheme={() => setLightMode((value) => !value)}
          />
        </div>
      </main>
      <JarvisExperience open={jarvisOpen} context={context} page={activePage} onOpen={() => setJarvisOpen(true)} onClose={() => setJarvisOpen(false)} onEvidence={(evidence) => { setSelectedRecommendation(null); setJarvisEvidence(evidence ?? null); setEvidenceOpen(true) }} onToast={showToast} onPreferenceChange={setJarvisPreference} />
      {passiveRecommendation && <PassiveRecommendationCard recommendation={passiveRecommendation} onReview={reviewPassiveRecommendation} onDismiss={dismissPassiveRecommendation} onSnooze={snoozePassiveRecommendation} />}
      {notificationsOpen && <NotificationDrawer recommendations={data.recommendations} unreadIds={unreadNotificationIds} onOpenRecommendation={(id) => { setReadNotificationIds((current) => new Set([...current, id])); persistReadNotifications([...readNotificationIds, id]); setNotificationsOpen(false); navigate('recommendations') }} onMarkAllRead={() => { const all = data.recommendations.filter((item) => item.status === 'PENDING').map((item) => item.id); setReadNotificationIds(new Set([...readNotificationIds, ...all])); persistReadNotifications([...readNotificationIds, ...all]) }} onClose={() => setNotificationsOpen(false)} />}
      {commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} onNavigate={navigate} />}
      {/* PR #46: the global drawer only ever shows an explicitly selected
          recommendation (passive Jarvis review) or Jarvis page evidence — the
          old `?? data.recommendations[0]` fallback showed the wrong record. */}
      {evidenceOpen && <EvidenceDrawer recommendation={selectedRecommendation} jarvisEvidence={jarvisEvidence} onClose={() => { setEvidenceOpen(false); setJarvisEvidence(null); setSelectedRecommendation(null) }} />}
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
      {!collapsed ? <button className="workspace-switcher" onClick={context.storeId ? () => onNavigate('settings') : onOnboarding}><span className={`workspace-avatar ${context.storeId ? 'connected' : ''}`}>{context.storeId ? 'ON' : '—'}</span><span className="workspace-copy"><strong>{context.shop ?? 'No Shopify store'}</strong><small>{context.storeId ? 'Shopify connected' : 'Connect a store to begin'}</small></span><ChevronDown size={15} /></button> : <button className="workspace-switcher compact" onClick={context.storeId ? () => onNavigate('settings') : onOnboarding} aria-label="Open store context"><span className="workspace-avatar">{context.storeId ? 'ON' : '—'}</span></button>}
      {!collapsed && <button className="command-trigger search-workspace" onClick={onOpenCommand}><Search size={15} /><span>Search workspace</span><kbd>⌘ K</kbd></button>}
      <nav className="side-nav" aria-label="Primary navigation">{navGroups.map((group) => <div className="nav-group" key={group.label}>{!collapsed && <div className="nav-group-label">{group.label}</div>}{group.items.map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => onNavigate(item.id)} title={collapsed ? item.label : undefined}><Icon size={17} strokeWidth={activePage === item.id ? 2.25 : 1.8} />{!collapsed && <span>{item.label}</span>}{!collapsed && item.tag && <span className={`nav-tag ${item.tag === 'AI' ? 'purple' : ''}`}>{item.tag}</span>}{collapsed && item.tag && <i className="collapsed-badge" />}</button> })}</div>)}</nav>
      <div className="sidebar-footer">{!collapsed && <div className="version-card"><div><span className="live-dot" />Shopify data</div><strong>{context.storeId ? 'Store context ready' : 'Awaiting Shopify'}</strong><small>{context.storeId ? 'API-backed workspace' : 'Use the install flow to connect'}</small>{!context.storeId && <button onClick={onOnboarding}>Connect Shopify <ArrowUpRight size={13} /></button>}</div>}<button className="help-link" onClick={() => onNavigate('support')} title={collapsed ? 'Help center' : undefined}><CircleHelp size={17} />{!collapsed && <span>Help center</span>}</button>{!collapsed && <nav className="legal-links" aria-label="Legal and compliance"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="/legal/security">Security</a><a href="/legal/cookies">Cookies</a><a href="/legal/dpa">DPA</a></nav>}<div className="sidebar-user"><span className="user-avatar">AA</span>{!collapsed && <span className="sidebar-user-copy"><strong>ProfitPilot team</strong><small>Connected workspace</small></span>}{!collapsed && <MoreHorizontal size={16} />}</div></div>
    </aside>
  </>
}

function TopBar({ active, unreadCount, onMenu, onCommand, onNotifications, onProfile, profileOpen, lightMode, onTheme, onShortcuts }: { active: Readonly<{ title: string; icon: LucideIcon }>; unreadCount: number; onMenu: () => void; onCommand: () => void; onNotifications: () => void; onProfile: () => void; profileOpen: boolean; lightMode: boolean; onTheme: () => void; onShortcuts: () => void }) {
  const ActiveIcon = active.icon
  return <header className="topbar"><div className="topbar-left"><button className="mobile-menu-button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong><ActiveIcon size={14} />{active.title}</strong></div></div><div className="topbar-actions"><button className="top-search" onClick={onCommand}><Search size={16} /><span>Search</span><kbd>⌘ K</kbd></button><button className="icon-button" onClick={onShortcuts} aria-label="Keyboard shortcuts"><Keyboard size={17} /></button><div className="topbar-divider" /><button className="icon-button notification-button" onClick={onNotifications} aria-label={unreadCount > 0 ? `Open notifications (${unreadCount} new)` : 'Open notifications'}><Bell size={18} />{unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}</button><button className="icon-button" onClick={onTheme} aria-label="Toggle theme">{lightMode ? <Moon size={18} /> : <Sun size={18} />}</button><button className="profile-button" onClick={onProfile} aria-expanded={profileOpen}><span className="profile-avatar">PP</span><span className="profile-name">Workspace</span><ChevronDown size={14} /></button></div></header>
}

function PageRouter({
  active,
  context,
  data,
  onNavigate,
  onSync,
  onSyncAll,
  syncProgress,
  syncAllRunning,
  syncDismissing,
  onRefresh,
  onToast,
  onPhaseGate,
  lightMode,
  onTheme,
}: {
  active: SectionId
  context: WorkspaceContext
  data: WorkspaceData
  onNavigate: (page: SectionId) => void
  onSync: (module: string) => Promise<void>
  onSyncAll: () => Promise<void>
  syncProgress: readonly SyncModuleProgress[]
  syncAllRunning: boolean
  syncDismissing?: boolean
  onRefresh: () => void
  onToast: (message: string, kind?: ToastKind) => void
  onPhaseGate: (phase: string, capability: string) => void
  lightMode: boolean
  onTheme: () => void
}) {
  if (active === 'dashboard')
    return (
      <DashboardPage
        context={context}
        data={data}
        onNavigate={onNavigate}
        onSync={onSync}
        onSyncAll={onSyncAll}
        syncProgress={syncProgress}
        syncAllRunning={syncAllRunning}
        syncDismissing={!!syncDismissing}
      />
    )
  if (active === 'products') return <ProductsPage context={context} catalog={data.catalog} analytics={data.analytics} onSync={onSync} />
  if (active === 'orders') return <PageLayout eyebrow="Order operations" title="Orders" description="Search, filter, inspect, and export real Shopify orders with plan-enforced intelligence."><OrdersWorkspace context={context} onSync={onSync} onNavigate={(page) => { if (page === 'billing') onNavigate('billing'); else onNavigate(page) }} onToast={onToast} /></PageLayout>
  if (active === 'customers') return <PageLayout eyebrow="Customer intelligence" title="Customers" description="Real Shopify customers, honest order-history coverage, and plan-enforced retention intelligence."><CustomersPage context={context} onSync={onSync} onNavigateBilling={() => onNavigate('billing')} onToast={onToast} /></PageLayout>
  if (active === 'analytics') return <RedesignedAnalyticsPage context={context} snapshot={data.analytics} onSync={onSync} onNavigateBilling={() => onNavigate('billing')} />
  if (active === 'inventory') return <PageLayout eyebrow="Stock intelligence" title="Inventory" description="Real Shopify stock levels, locations, and value with plan-enforced inventory intelligence."><InventoryWorkspace context={context} onSync={onSync} onNavigate={() => onNavigate('billing')} onToast={onToast} /></PageLayout>
  if (active === 'command-center') return <CommandCenterPage context={context} onToast={onToast} onNavigate={(page) => onNavigate(page as SectionId)} />
  if (active === 'recommendations') return <PageLayout eyebrow="AI employee" title="Recommendations" description="Evidence-backed decisions from your synced Shopify data — approve, reject, and watch your AI team learn."><RecommendationsWorkspace context={context} onToast={onToast} onNavigateBilling={() => onNavigate('billing')} /></PageLayout>
  if (active === 'automation') return <AutomationWorkspace context={context} onToast={onToast} onNavigateBilling={() => onNavigate('billing')} />
  if (active === 'campaigns') return <CampaignsPage onPhaseGate={onPhaseGate} context={context} onToast={onToast} />
  if (active === 'copilot') return <PageLayout eyebrow="Grounded questions" title="Copilot" description="A closed ten-intent grammar answers from tenant-scoped evidence packs."><CopilotWorkspace context={context} /></PageLayout>
  if (active === 'reports') return <PageLayout eyebrow="Closed-period PDFs" title="Reports" description="Closed-period PDF reports, deterministic forecast methods, and honest delivery status."><ReportsWorkspace context={context} /></PageLayout>
  if (active === 'admin-ops') return <PageLayout eyebrow="Operator controls" title="Admin Ops" description="Final controls for maintenance, merchant flags, queues, and operational recovery."><AdminOpsWorkspace context={context} /></PageLayout>
  if (active === 'billing') return <BillingPage context={context} onPhaseGate={onPhaseGate} onToast={onToast} />
  if (active === 'settings') return <SettingsPage context={context} lightMode={lightMode} onTheme={onTheme} onToast={onToast} />
  if (active === 'support') return <SupportPage context={context} onToast={onToast} />
  if (active === 'exports') return <ExportsPage context={context} />
  return <EmptyDataPage page={active} context={context} onSync={onSync} />
}

function DashboardPage({
  context,
  data,
  onNavigate,
  onSync,
  onSyncAll,
  syncProgress,
  syncAllRunning,
  syncDismissing,
}: {
  context: WorkspaceContext
  data: WorkspaceData
  onNavigate: (page: SectionId) => void
  onSync: (module: string) => Promise<void>
  onSyncAll: () => Promise<void>
  syncProgress: readonly SyncModuleProgress[]
  syncAllRunning: boolean
  syncDismissing?: boolean
}) {
  const displayName = formatStoreDisplayName(context.shop)
  const greetingTitle = context.storeId ? 'Good morning' : 'Connect your Shopify store'
  const greetingDescription = context.storeId
    ? displayName
      ? `Welcome back, ${displayName} — your workspace is ready for real Shopify data.`
      : 'Your workspace is ready for real Shopify data. Start a sync to build the first analytics snapshot.'
    : 'ProfitPilot never invents store numbers. Connect Shopify to unlock the live data plane.'

  return (
    <PageLayout
      eyebrow="Store intelligence"
      title={greetingTitle}
      description={greetingDescription}
      actions={
        <>
          <button className="button secondary" onClick={() => onNavigate('analytics')}>
            <LineChart size={15} /> Open analytics
          </button>
          <button className="button primary" disabled={syncAllRunning} onClick={() => void onSyncAll()}>
            <RotateCcw size={15} className={syncAllRunning ? 'spin' : ''} /> {syncAllRunning ? 'Syncing all…' : 'Sync all'}
          </button>
        </>
      }
    >
      <div className="sync-banner">
        <span className="sync-pulse">
          <span />
        </span>
        <span>
          <strong>{context.storeId ? 'Shopify data plane ready' : 'No store context'}</strong> · {latestSyncLabel(data.analytics)}
        </span>
        <button onClick={() => void onSync('orders')}>{context.storeId ? 'Sync orders' : 'Connect Shopify'} <ArrowUpRight size={13} /></button>
      </div>
      {syncProgress.length > 0 && <SyncAllProgress modules={syncProgress} dismissing={!!syncDismissing} />}
      <DashboardLayout
        data={{
          analytics: data.analytics,
          catalog: data.catalog as unknown as Array<{ productId: string; payload: Record<string, unknown> }>,
          loadState: data.loadState,
        }}
        onSync={onSync}
        onSyncAll={onSyncAll}
        syncAllRunning={syncAllRunning}
        onNavigate={onNavigate as (page: string) => void}
        storeName={context.shop}
        storeId={context.storeId}
      />
    </PageLayout>
  )
}

function SyncAllProgress({ modules, dismissing }: { modules: readonly SyncModuleProgress[]; dismissing?: boolean }) {
  return (
    <section className={`sync-all-progress ${dismissing ? 'dismissing' : ''}`} aria-live="polite" aria-label="Shopify sync progress">
      {modules.map((item) => (
        <div key={item.module} className={`sync-module ${item.status}`} title={item.detail}>
          {item.status === 'succeeded' ? <CheckCircle2 size={13} /> : item.status === 'failed' ? <AlertCircle size={13} /> : <RefreshCw className="spin" size={13} />}
          <span>
            <strong>{item.module}</strong>
            <small>{item.detail}</small>
          </span>
        </div>
      ))}
    </section>
  )
}

function ProductsPage({ context, catalog, analytics, onSync }: { context: WorkspaceContext; catalog: readonly CatalogProduct[]; analytics: AnalyticsSnapshot | null; onSync: (module: string) => Promise<void> }) {
  return <PageLayout eyebrow="Catalog intelligence" title="Products" description="A real Shopify product workspace with variant-level stock, prices, images, and sales performance." actions={<><button className="button secondary" onClick={() => void onSync('orders')}><ShoppingBag size={15} /> Sync orders</button><button className="button primary" onClick={() => void onSync('products')}><RefreshCw size={15} /> Sync products</button></>}>
    <ProductsWorkspace context={context} catalog={catalog} analytics={analytics} onSync={onSync} />
  </PageLayout>
}

function EmptyDataPage({ page, context, onSync }: { page: SectionId; context: WorkspaceContext; onSync: (module: string) => Promise<void> }) { const meta = pageMeta[page]; const Icon = meta.icon; return <PageLayout eyebrow="Store data" title={meta.title} description={meta.description}><EmptyState icon={Icon} title={`No ${meta.title.toLowerCase()} data yet`} description={context.storeId ? 'This section is wired to the foundation and will render once its source module has real rows.' : 'Connect Shopify first. ProfitPilot does not ship demo records.'} action={context.storeId ? `Sync ${meta.title}` : 'Connect Shopify'} onAction={() => void onSync(page)} /></PageLayout> }

function CommandCenterPage({ context, onToast, onNavigate }: { context: WorkspaceContext; onToast: (message: string, kind?: ToastKind) => void; onNavigate: (page: string) => void }) {
  return <PageLayout eyebrow="AI employee" title="AI Command Center" description="Your intelligent workforce, always on duty. Every number is deterministic evidence — agents only explain, never invent.">
    <CommandCenterWorkspace context={context} onToast={onToast} onNavigate={onNavigate} />
  </PageLayout>
}

function RecommendationsPage({ context, recommendations, onEvidence, onDecide, onRefresh, onToast }: { context: WorkspaceContext; recommendations: readonly Recommendation[]; onEvidence: () => void; onDecide: (id: string, decision: 'approve' | 'reject', expectedVersion: number) => Promise<void>; onRefresh: () => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const analyze = async () => {
    if (!context.storeId) { onToast('Connect Shopify before generating recommendations.', 'info'); return }
    try {
      const result = await analyzeRecommendations(context.storeId)
      onToast(result.recommendations.length ? `Generated ${result.recommendations.length} recommendation${result.recommendations.length === 1 ? '' : 's'} from your store snapshot.` : 'Analysis ran, but there is not enough synced evidence yet.', result.recommendations.length ? 'success' : 'info')
      onRefresh()
    } catch (error: unknown) { onToast(errorMessage(error), 'error') }
  }
  const pending = recommendations.filter((item) => item.status === 'PENDING')
  const modeledImpact = recommendations.reduce((sum, item) => sum + item.impactValue, 0)
  return <PageLayout eyebrow="AI employee" title="Recommendations" description="Real deterministic signals with immutable evidence packs. AI language is optional and never supplies the numbers." actions={<><button className="button secondary" onClick={onEvidence}><Eye size={15} /> Evidence drawer</button><button className="button primary" onClick={onRefresh}><RefreshCw size={15} /> Refresh decisions</button></>}>
    <div className="recommendation-summary"><div><strong>{recommendations.length}</strong><span>recommendations returned</span></div><div className="summary-divider" /><div className="summary-stat"><span className="confidence-dot purple" /><strong>{pending.length}</strong><small>pending approval</small></div><div className="summary-stat"><span className="confidence-dot high" /><strong>{formatMoney(modeledImpact)}</strong><small>deterministic impact</small></div><div className="summary-spacer" /><span className="data-contract"><ShieldCheck size={14} /> Tenant-scoped API</span></div>
    {recommendations.length === 0 ? <EmptyState icon={WandSparkles} title="No recommendations yet" description="Evidence is generated from your synced Shopify snapshot. After products and orders sync, click Generate recommendations. ProfitPilot will not invent a recommendation without store rows." action="How evidence works" onAction={onEvidence} /> : <div className="recommendation-list">{recommendations.map((item) => <RecommendationCard key={item.id} recommendation={item} onEvidence={onEvidence} onDecide={onDecide} />)}</div>}
  </PageLayout>
}

function RecommendationCard({ recommendation, onEvidence, onDecide }: { recommendation: Recommendation; onEvidence: () => void; onDecide: (id: string, decision: 'approve' | 'reject', expectedVersion: number) => Promise<void> }) {
  return <article className="recommendation-card"><div className="recommendation-card-main"><div className="recommendation-card-top"><span className="agent-pill"><span />{recommendation.agent}</span><span className={`confidence-pill ${recommendation.confidenceLevel.toLowerCase()}`}><span />{recommendation.confidenceLevel}</span><span className="recommendation-time">{recommendation.status}</span></div><h3>{recommendation.title}</h3><p>{recommendation.reason}</p><div className="evidence-snippets"><span><Database size={13} /> Rule {recommendation.ruleId} · v1.0.0</span><span><ShieldCheck size={13} /> {recommendation.explanationStatus}</span>{recommendation.explanation && <span><MessageSquare size={13} /> {recommendation.explanation}</span>}</div></div><div className="recommendation-card-side"><span className="impact-label">{recommendation.impactLabel}</span><strong>{formatMoney(recommendation.impactValue, recommendation.currency)}</strong><button className="text-button" onClick={onEvidence}><Eye size={14} /> Evidence</button>{recommendation.status === 'PENDING' ? <div className="recommendation-actions"><button className="button reject" onClick={() => void onDecide(recommendation.id, 'reject', recommendation.version)}>Reject</button><button className="button approve" onClick={() => void onDecide(recommendation.id, 'approve', recommendation.version)}><Check size={14} /> Approve</button></div> : <span className="resolved-label"><CheckCircle2 size={14} />{recommendation.status}</span>}</div></article>
}

function CampaignsPage({ context, onPhaseGate, onToast }: { context: WorkspaceContext; onPhaseGate: (phase: string, capability: string) => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [templates, setTemplates] = useState<readonly import('./api.js').CampaignTemplateRecord[]>([])
  const refresh = () => { if (!context.storeId) { setTemplates([]); return }; void fetchCampaignTemplates(context.storeId).then(setTemplates).catch((error: unknown) => onToast(errorMessage(error), 'error')) }
  useEffect(() => { refresh() }, [context.storeId])
  const create = async () => { try { await createCampaignTemplate({ id: crypto.randomUUID(), storeId: context.storeId ?? '', name: 'New compliant email', kind: 'EMAIL', subject: 'Hello {{customer.first_name}}', body: 'Your unsubscribe link: {{unsubscribe.url}}' }); onToast('Closed-variable template created.', 'success'); refresh() } catch (error: unknown) { onToast(errorMessage(error), 'error') } }
  return <PageLayout eyebrow="Marketing center" title="Campaigns" description="Closed 11-variable templates, suppression checks, HMAC tracking, and merchant-owned sending." actions={<><button className="button secondary" onClick={refresh}><RefreshCw size={15} /> Refresh templates</button><button className="button primary" onClick={() => void create()}><Plus size={15} /> New template</button></>}><div className="campaign-hero"><div><div className="section-kicker"><span className="kicker-dot purple" /> Two-layer email flow</div><h2>System mail and merchant campaigns never share a sender.</h2><p>{context.storeId ? 'Campaigns send approved emails to customers from your store address. Verify that address in Settings, then create a template and review it before send.' : 'Connect a store before creating merchant campaign templates.'}</p></div><div className="campaign-hero-art"><Mail size={28} /><span>Email</span></div></div><div className="sync-banner"><ShieldCheck size={15} /><span>Verify your merchant email in Settings before any campaign can send.</span><button onClick={() => onToast('Open Settings → Merchant campaign email to save and confirm your From address.', 'info')}>Open verification</button></div>{templates.length === 0 ? <EmptyState icon={Mail} title="No templates yet" description="Create a closed-variable email template. Invalid variables and missing unsubscribe links fail honestly on the server." action="Create template" onAction={() => void create()} /> : <div className="template-grid">{templates.map((template) => <div className="card template-card" key={template.id}><span className="export-icon purple"><Mail size={18} /></span><h3>{template.name}</h3><p>{template.subject}</p><div className="template-footer"><span>{template.variables.length} variables · {template.kind}</span><button className="button secondary" onClick={() => onToast('Verify merchant email in Settings, then return here to send this template.', 'info')}>Verify to send</button></div></div>)}</div>}</PageLayout>
}

function CopilotPage({ onPhaseGate }: { onPhaseGate: (phase: string, capability: string) => void }) { const [query, setQuery] = useState(''); return <PageLayout eyebrow="Advanced query" title="Copilot" description="A closed-intent grammar will answer from evidence packs once F8 is implemented." actions={<button className="button secondary"><Clock3 size={15} /> Thread history</button>}><div className="copilot-layout"><section className="copilot-main"><div className="copilot-welcome"><span className="copilot-orb"><Sparkles size={22} /></span><div><div className="section-kicker">10 SUPPORTED INTENTS · F8</div><h2>Ask a grounded question.</h2><p>There are no generated answers in this phase.</p></div></div><div className="copilot-empty"><Database size={24} /><strong>Copilot is not answering yet</strong><span>F8 will connect closed grammar intents to real evidence tables.</span><button className="button secondary" onClick={() => onPhaseGate('F8', 'Copilot answer generation')}><LockKeyhole size={14} /> View gate</button></div><div className="copilot-composer"><div className="composer-label"><span><Command size={13} /> Try a future intent</span><span>Numbers will come from F2 tables</span></div><div className="composer-input"><textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Why did sales change this week?" rows={2} /><button className="send-button" disabled={!query.trim()} onClick={() => onPhaseGate('F8', 'Copilot answer generation')}><ArrowUpRight size={16} /></button></div><div className="suggested-prompts"><button onClick={() => setQuery('Which products are at stockout risk?')}>Stockout risk</button><button onClick={() => setQuery('What changed in revenue?')}>Revenue change</button></div></div></section><aside className="card copilot-sidebar"><CardHeading kicker="Thread history" dot="blue" title="No questions yet" /><EmptySmall icon={MessageSquare} text="F8 threads are not created yet." /></aside></div></PageLayout> }

function ReportsPage({ onPhaseGate }: { onPhaseGate: (phase: string, capability: string) => void }) { return <PageLayout eyebrow="Reporting shell" title="Reports" description="Report vault and scheduling will only render closed-period PDFs from F8." actions={<button className="button primary" onClick={() => onPhaseGate('F8', 'PDF report generation')}><Plus size={15} /> Generate report</button>}><div className="report-banner"><span className="report-banner-icon"><FileBarChart size={22} /></span><div><div className="section-kicker">DETERMINISTIC PDF VAULT</div><h2>Reporting is not enabled yet.</h2><p>F8 will add closed periods, R2 storage, and idempotent delivery.</p></div><span className="phase-tag">AI</span></div><EmptyState icon={FileText} title="No reports generated" description="There are no placeholder PDFs in this vault. Generate reports after the F8 reporting package is implemented." action="View F8 boundary" onAction={() => onPhaseGate('F8', 'PDF report generation')} /></PageLayout> }

function ExportsPage({ context }: { context: WorkspaceContext }) {
  const [message, setMessage] = useState<string | null>(null)
  const runExport = async (format: 'CSV' | 'XLSX' | 'PDF', dataset: 'orders' | 'catalog' | 'audit' | 'revenue') => {
    if (!context.storeId) { setMessage('Connect a store before exporting.'); return }
    try {
      const result = await exportRows(format, [], fetch, { storeId: context.storeId, dataset })
      setMessage(`${result.filename} is ready (${result.rows} rows). The 50,000-row ceiling is a file-safety limit, not a plan quota.`)
      if (result.bodyBase64) {
        const binary = atob(result.bodyBase64)
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
        const url = URL.createObjectURL(new Blob([bytes], { type: result.contentType }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = result.filename
        anchor.click()
        URL.revokeObjectURL(url)
      }
    } catch (error: unknown) { setMessage(errorMessage(error)) }
  }
  const exportTypes: ReadonlyArray<{ title: string; icon: LucideIcon; format: 'CSV' | 'XLSX' | 'PDF'; dataset: 'orders' | 'catalog' | 'audit' | 'revenue'; detail: string }> = [
    { title: 'Daily aggregate export', icon: ShoppingBag, format: 'CSV', dataset: 'orders', detail: 'Closed daily order counts from Shopify sync.' },
    { title: 'Catalog XLSX', icon: Package, format: 'XLSX', dataset: 'catalog', detail: 'Synced product titles and ids.' },
    { title: 'Audit log CSV', icon: ShieldCheck, format: 'CSV', dataset: 'audit', detail: 'Tenant-scoped operational events.' },
    { title: 'Revenue PDF', icon: FileBarChart, format: 'PDF', dataset: 'revenue', detail: 'Closed-period revenue rows.' },
  ]
  return <PageLayout eyebrow="Data portability" title="Exports" description="Download real synced rows. Each file stops at 50,000 rows so a huge store cannot stall the browser — this is a technical safety limit, not a plan quota.">
    <div className="export-intro"><div><div className="section-kicker"><span className="kicker-dot blue" /> Store-scoped writers</div><h2>{context.storeId ? 'Choose a real dataset to export.' : 'Connect a store before exporting.'}</h2><p>Generate downloads the file immediately. Empty files mean that dataset has not been synced yet.</p></div><span className="export-limit"><strong>50,000</strong><small>row safety ceiling</small></span></div>
    {message && <div className="sync-banner"><CheckCircle2 size={15} /><span>{message}</span></div>}
    <div className="export-grid">{exportTypes.map(({ title, icon: Icon, format, dataset, detail }) => <div className="card export-card" key={title}><span className="export-icon blue"><Icon size={20} /></span><h3>{title}</h3><p>{detail}</p><div className="export-card-bottom"><span>{format}</span><button className="button secondary" onClick={() => void runExport(format, dataset)}>Generate</button></div></div>)}</div>
  </PageLayout>
}

function SupportPage({ context, onToast }: { context: WorkspaceContext; onToast: (message: string, kind?: ToastKind) => void }) {
  const [tickets, setTickets] = useState<readonly import('./api.js').TicketRecord[]>([])
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL')
  const refresh = () => { if (context.storeId) void fetchTickets(context.storeId).then(setTickets).catch((error: unknown) => onToast(errorMessage(error), 'error')) }
  useEffect(() => { refresh() }, [context.storeId])
  const create = async () => {
    if (!context.storeId) { onToast('Connect Shopify before opening a ticket.', 'info'); return }
    if (!subject.trim() || !description.trim()) { onToast('Add a subject and a short description.', 'info'); return }
    try {
      await createTicket(context.storeId, subject.trim(), 'growth', fetch, { description: description.trim(), priority })
      onToast('Support ticket submitted. We will follow up in this inbox.', 'success')
      setSubject(''); setDescription(''); setPriority('NORMAL'); setOpen(false); refresh()
    } catch (error: unknown) { onToast(errorMessage(error), 'error') }
  }
  return <PageLayout eyebrow="Operator inbox" title="Support tickets" description="Send a real question to the ProfitPilot team. Status and priority stay auditable." actions={<button className="button primary" onClick={() => setOpen(true)}><Plus size={15} /> New ticket</button>}>
    <div className="support-hero"><span className="support-hero-icon"><LifeBuoy size={22} /></span><div><div className="section-kicker">SUPPORT INBOX</div><h2>{tickets.length ? `${tickets.length} open ticket${tickets.length === 1 ? '' : 's'}` : 'No open tickets.'}</h2><p>{context.storeId ? 'Use the form to describe the issue. Duplicate “New merchant question” tickets are no longer created.' : 'Connect a store before opening a ticket.'}</p></div><span className="support-sla"><strong>24h</strong><small>Growth response target</small></span></div>
    {open && <section className="card ticket-form"><div className="card-heading"><div><span className="section-kicker">NEW TICKET</span><h3>How can we help?</h3></div></div><label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="e.g. Inventory sync failed" /></label><label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="What happened, and what should we look at?" /></label><label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as 'NORMAL' | 'HIGH' | 'URGENT')}><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label><div className="modal-actions"><button className="button secondary" onClick={() => setOpen(false)}>Cancel</button><button className="button primary" onClick={() => void create()}>Submit ticket</button></div></section>}
    {tickets.length === 0 && !open ? <EmptyState icon={Inbox} title="Your support inbox is clear" description="Create a ticket when there is a real question for the ProfitPilot team." action="New ticket" onAction={() => setOpen(true)} /> : <div className="ticket-list-card">{tickets.map((ticket) => <div className="ticket-row" key={ticket.id}><span className="ticket-icon"><TicketCheck size={16} /></span><span><strong>{ticket.subject}</strong><small>{ticket.priority} · {ticket.status}{ticket.description ? ` · ${ticket.description.slice(0, 80)}` : ''}</small></span><span className="status-badge neutral">{ticket.status}</span></div>)}</div>}
  </PageLayout>
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
  return <PageLayout eyebrow="Plans and usage" title="Billing" description="Plan, quota, and ROI values are loaded from the real billing API. Suspended stores keep read-only access." actions={<button className="button secondary" onClick={() => context.storeId ? void fetchBilling(context.storeId).then(setAccount).catch((error: unknown) => onToast(errorMessage(error), 'error')) : onToast('Connect Shopify from Settings.', 'info')}>{context.storeId ? 'Refresh billing' : 'Connect Shopify'} <RefreshCw size={14} /></button>}>
    {!context.storeId ? <EmptyState icon={WalletCards} title="Connect Shopify to view billing" description="Billing never assumes a plan. Complete the signed install flow to load a real subscription." action="Connect from Settings" onAction={() => onToast('Open the Shopify install flow from the workspace context.', 'info')} /> : <>
      <div className="billing-current"><div className="billing-plan"><span className="plan-icon"><WalletCards size={19} /></span><div><div className="section-kicker">CURRENT PLAN</div><h2>{account?.subscription ? `${account.subscription.plan} · ${account.subscription.state}` : account?.trial?.state === 'ACTIVE' ? `You're on the Free Trial (${Math.max(0, Math.ceil((account.trial.expiresAt - Date.now()) / 86_400_000))} days remaining)` : 'No active plan — choose a plan below to get started'}</h2><p>{account?.subscription?.currentPeriodEnd ? `Current period ends ${new Date(account.subscription.currentPeriodEnd).toLocaleDateString()}.` : account?.trial?.expiresAt ? `Trial ends ${new Date(account.trial.expiresAt).toLocaleDateString()}. Basic analytics stay available until you choose a plan.` : 'Start a plan or redeem a gift code when you are ready.'}</p></div><span className={`status-badge ${account?.subscription ? 'green' : account?.trial ? 'amber' : 'neutral'}`}>{account?.subscription?.state ?? account?.trial?.state ?? 'Trial'}</span></div></div>
      <div className="billing-grid"><section className="card usage-panel"><CardHeading kicker="Usage meters" dot="blue" title="Current period" />{account?.trial && !account.subscription ? <p className="usage-trial-note">Free trial includes limited analytics. Usage meters fill in after a paid plan starts.</p> : null}{usage.length ? usage.map((meter) => <Quota key={meter.feature} label={meter.feature} value={`${meter.used}${meter.limit === null ? '' : ` / ${meter.limit}`}`} percent={meter.limit ? Math.min(100, meter.used / meter.limit * 100) : 0} />) : <EmptySmall icon={Gauge} text="No usage recorded yet for this period." />}</section><section className="card roi-panel"><CardHeading kicker="Return on AI" dot="gold" title="Verified attribution" /><p className="roi-help">Revenue that can be tied to an approved ProfitPilot action. $0 means no attributed outcomes yet — not a billing error.</p>{roi ? <div className="roi-live"><strong>{formatMoney(roi.attributedRevenue)}</strong><span>AI-attributed revenue</span><div className="roi-breakdown"><MetricLine label="AI operational cost" value={formatMoney(roi.aiCostDollars)} /><MetricLine label="Net return" value={formatMoney(roi.netReturn)} /><MetricLine label="Multiple" value={roi.multiple === null ? '—' : `${roi.multiple.toFixed(1)}×`} /></div></div> : <EmptySmall icon={Sparkles} text="No attributed outcomes yet." />}</section></div>
      <section className="card gift-panel"><div><div className="section-kicker"><Tag size={13} /> GIFT ACCESS</div><h3>Have a gift code?</h3><p>One store can redeem one code. Redemption replaces the limited trial.</p></div><div className="gift-input"><input value={giftCode} onChange={(event) => setGiftCode(event.target.value.toUpperCase())} placeholder="Enter gift code" /><button className="button secondary" onClick={() => void redeem()} disabled={!giftCode.trim()}>Redeem</button></div></section>
      <div className="plan-comparison"><div className="section-kicker"><span className="kicker-dot purple" /> AVAILABLE PLANS</div><h2>Choose the level of autonomy you need.</h2><div className="plan-cards">{plans.map((plan) => <div className={`plan-card ${plan.recommended ? 'recommended' : ''} ${account?.subscription?.plan === plan.tier ? 'current' : ''}`} key={plan.code}>{plan.recommended && <span className="plan-recommended">Recommended</span>}<h3>{plan.code}</h3><div className="plan-price"><strong>${plan.monthlyPrice}</strong><span>/month</span></div><p>{plan.headline ?? `$${plan.annualPrice}/year · ${plan.annualMonthsFree} months free`}</p><ul className="plan-features">{(plan.features ?? [`$${plan.annualPrice}/year · ${plan.annualMonthsFree} months free`]).map((feature) => <li key={feature}>{feature}</li>)}</ul><button className="button primary" onClick={() => void startCharge(plan.code)}>{account?.subscription?.plan === plan.tier ? 'Current plan' : 'Choose plan'} <ArrowUpRight size={14} /></button></div>)}</div></div>
    </>}
  </PageLayout>
}

function SettingsPage({ context, lightMode, onTheme, onToast }: { context: WorkspaceContext; lightMode: boolean; onTheme: () => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [email, setEmail] = useState(''); const [fromName, setFromName] = useState(''); const [verificationToken, setVerificationToken] = useState(''); const [verified, setVerified] = useState(false)
  const saveEmail = async () => { if (!context.storeId) { onToast('Connect Shopify before configuring merchant email.', 'info'); return } try { const result = await saveMerchantEmail(context.storeId, email, fromName); setVerificationToken(result.verificationToken); onToast('Verification token created. Verify before campaigns send.', 'success') } catch (error: unknown) { onToast(errorMessage(error), 'error') } }
  const verifyEmail = async () => { try { await verifyMerchantEmail(verificationToken); setVerified(true); onToast('Merchant email verified.', 'success') } catch (error: unknown) { onToast(errorMessage(error), 'error') } }
  return <PageLayout eyebrow="Workspace controls" title="Settings" description="Store context, merchant-owned campaign identity, and accessibility preferences."><div className="settings-layout"><aside className="settings-nav card"><button className="settings-nav-item active"><Settings size={15} /> General</button><button className="settings-nav-item"><Bell size={15} /> Notifications</button><button className="settings-nav-item"><Bot size={15} /> Jarvis preferences</button><button className="settings-nav-item"><Users size={15} /> Team members</button><button className="settings-nav-item"><ShieldCheck size={15} /> Security & audit</button><button className="settings-nav-item danger"><Trash2 size={15} /> Danger zone</button></aside><div className="settings-panels"><SettingsPanel title="Store context" description="The UI reads this context from the embedded Shopify URL."><SettingRow label="Shopify store" description="No store name is fabricated"><span className="setting-readonly">{context.shop ?? 'Not provided'}</span></SettingRow><SettingRow label="Tenant id" description="Used for tenant-scoped requests"><span className="setting-readonly mono">{context.storeId ?? 'Not provided'}</span></SettingRow></SettingsPanel><SettingsPanel title="Merchant campaign email" description="Campaigns never send from ProfitPilot system email. Verification is required."><SettingRow label="Merchant email" description="The From address for customer campaigns"><input className="setting-input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="merchant@example.com" /></SettingRow><SettingRow label="From name" description="Shown to campaign recipients"><input className="setting-input" value={fromName} onChange={(event) => setFromName(event.target.value)} placeholder="Your store" /></SettingRow><div className="email-verification-row"><span className={`status-badge ${verified ? 'green' : 'amber'}`}>{verified ? 'Verified' : 'Verification required'}</span><button className="button secondary" onClick={() => void saveEmail()} disabled={!email || !fromName}>Save and verify</button>{verificationToken && !verified && <button className="button primary" onClick={() => void verifyEmail()}>Confirm verification</button>}</div></SettingsPanel><SettingsPanel title="Appearance" description="Dark mode is the default ProfitPilot surface."><SettingRow label="Theme" description="Optional light mode for daytime work"><div className="theme-choice"><button className={!lightMode ? 'selected' : ''} onClick={() => lightMode && onTheme()}><Moon size={15} /> Dark</button><button className={lightMode ? 'selected' : ''} onClick={() => !lightMode && onTheme()}><Sun size={15} /> Light</button></div></SettingRow><SettingRow label="Reduced motion" description="Respect the operating system preference"><Toggle on={false} /></SettingRow></SettingsPanel><div className="settings-save"><span><ShieldCheck size={15} /> Merchant identity is explicit</span><button className="button primary" onClick={() => onToast('Preferences are saved locally for this shell.', 'success')}>Save preferences</button></div></div></div></PageLayout>
}

function PageLayout({ eyebrow, title, description, actions, children }: { eyebrow: ReactNode; title: string; description: string; actions?: ReactNode; children: ReactNode }) { return <div className="page-content"><div className="page-header"><div><div className="page-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>{children}</div> }

function CardHeading({ kicker, dot, title, action }: { kicker: string; dot: string; title: string; action?: ReactNode }) { return <div className="card-heading"><div><div className="section-kicker"><span className={`kicker-dot ${dot}`} />{kicker}</div><h3>{title}</h3></div>{action ?? <MoreHorizontal size={18} className="muted-icon" />}</div> }
function MetricCard({ label, value, detail, icon: Icon, tone, gated }: { label: string; value: string; detail: string; icon: LucideIcon; tone: string; gated?: boolean }) { return <div className="card stat-card"><div className="stat-top"><span className={`stat-icon ${tone}`}><Icon size={17} /></span>{gated ? <span className="phase-tag">F4</span> : <span className="data-mark"><CheckCircle2 size={13} /></span>}</div><div className="stat-value">{value}</div><div className="stat-bottom"><span>{label}<small>{detail}</small></span></div></div> }
function MiniMetric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) { return <div className="card mini-metric"><span className={`mini-metric-icon ${tone}`}><span /></span><div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div></div> }
function HealthGauge({ health }: { health: import('./model.js').StoreHealthView }) {
  const sweep = health.score === null ? 0 : Math.max(8, Math.round(health.score * 2.4))
  return <div className={`health-gauge ${health.tone}`} style={health.score !== null ? { background: `conic-gradient(from 220deg, var(--health-color) ${sweep}deg, rgba(107,114,128,.14) 0)` } : undefined}><div className="gauge-inner"><strong>{health.score === null ? '—' : health.score}<small>{health.score === null ? '' : '/100'}</small></strong><span>{health.score === null ? 'NO DATA' : `${health.grade} · ${health.label}`}</span></div></div>
}
function HealthLine({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className="health-item"><span><i className={`status-dot ${tone}`} />{label}</span><strong className={tone}>{value}</strong></div> }
function ChartSkeleton() { return <div className="chart-skeleton" aria-label="Loading chart"><span /><span /><span /><span /><span /></div> }
function AreaChart({ points }: { points: readonly import('./model.js').RevenuePoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const values = points.map((point) => point.value)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  const coords = points.map((point, index) => ({ x: (index / Math.max(points.length - 1, 1)) * 100, y: 92 - ((point.value - min) / span) * 78, point }))
  const line = coords.map((coord) => `${coord.x},${coord.y}`).join(' ')
  const active = hover !== null ? coords[hover] : null
  return <div className="revenue-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Revenue trend"><defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#3B82F6" stopOpacity=".3" /><stop offset="100%" stopColor="#3B82F6" stopOpacity="0" /></linearGradient></defs>{[16, 40, 64, 88].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} className="chart-grid-line" />)}<polygon points={`0,100 ${line} 100,100`} fill="url(#areaFill)" /><polyline points={line} fill="none" stroke="#5994FF" strokeWidth="1.7" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />{coords.map((coord, index) => <circle key={coord.point.day} cx={coord.x} cy={coord.y} r={hover === index ? 1.8 : 1.1} fill="#93C5FD" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} />)}</svg><div className="chart-y-labels"><span>{formatMoney(max)}</span><span>{formatMoney((max + min) / 2)}</span><span>{formatMoney(min)}</span></div><div className="chart-x-labels"><span>{points[0]?.day ?? ''}</span><span>{points[points.length - 1]?.day ?? ''}</span></div>{active && <div className="chart-tooltip" style={{ left: `${Math.min(86, Math.max(8, active.x))}%` }}><strong>{formatMoney(active.point.value)}</strong><span>{active.point.day}</span></div>}</div>
}
function EmptyChart({ onSync }: { onSync: () => void }) { return <div className="empty-chart"><LineChart size={24} /><strong>No closed-period analytics yet</strong><span>Run a real sync to draw this chart.</span><button className="text-button" onClick={onSync}><RefreshCw size={14} /> Sync data</button></div> }
function EmptyState({ icon: Icon, title, description, action, onAction }: { icon: LucideIcon; title: string; description: string; action: string; onAction: () => void }) { return <div className="empty-state"><span className="empty-icon"><Icon size={22} /></span><h3>{title}</h3><p>{description}</p><button className="button secondary" onClick={onAction}>{action} <ArrowUpRight size={14} /></button></div> }
function EmptySmall({ icon: Icon, text }: { icon: LucideIcon; text: string }) { return <div className="empty-small"><Icon size={18} /><span>{text}</span></div> }
function InsightItem({ icon: Icon, title, detail, tone }: { icon: LucideIcon; title: string; detail: string; tone: string }) { return <div className="insight-item"><span className={`insight-icon ${tone}`}><Icon size={16} /></span><span><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={15} /></div> }
function MetricLine({ label, value }: { label: string; value: string }) { return <div className="metric-line"><span>{label}</span><strong>{value}</strong></div> }
function Quota({ label, value, percent }: { label: string; value: string; percent: number }) { return <div className="quota"><div><span>{label}</span><strong>{value}</strong></div><div className="usage-track"><span style={{ width: `${percent}%` }} /></div></div> }
function Toggle({ on }: { on: boolean }) { return <span className={`toggle ${on ? 'on' : ''}`}><span /></span> }
function SettingRow({ label, description, children }: { label: string; description: string; children: ReactNode }) { return <div className="setting-row"><div><strong>{label}</strong><small>{description}</small></div>{children}</div> }
function SettingsPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <section className="card settings-panel"><div className="settings-panel-head"><h3>{title}</h3><p>{description}</p></div>{children}</section> }
function ProfileMenu({ lightMode, onTheme, onClose, onSettings }: { lightMode: boolean; onTheme: () => void; onClose: () => void; onSettings: () => void }) { return <div className="profile-menu"><div className="profile-menu-head"><span className="profile-avatar large">PP</span><span><strong>ProfitPilot</strong><small>Foundation workspace</small></span></div><button onClick={onSettings}><Settings size={15} /> Settings</button><button onClick={onTheme}>{lightMode ? <Sun size={15} /> : <Moon size={15} />} {lightMode ? 'Dark mode' : 'Light mode'}</button><button onClick={onClose}><LockKeyhole size={15} /> Security boundary</button></div> }
function OfflineBanner({ error, partial = false, onRetry }: { error: string | null; partial?: boolean; onRetry: () => void }) { return <div className="offline-banner"><CloudOff size={16} /><span><strong>{partial ? 'Partial data load' : 'API unavailable'}</strong>{error ? ` · ${error}` : ' · Showing empty states, never demo data.'}</span><button onClick={onRetry}><RotateCcw size={14} /> Retry</button></div> }
function ContextBanner({ onConnect }: { onConnect: () => void }) { return <div className="context-banner"><span className="context-banner-icon"><Server size={16} /></span><span><strong>No Shopify store context detected.</strong> Open the install flow to attach a real tenant before syncing.</span><button onClick={onConnect}>Connect Shopify <ArrowUpRight size={13} /></button></div> }
function EvidenceDrawer({ recommendation, jarvisEvidence, onClose }: { recommendation: Recommendation | null; jarvisEvidence: JarvisEvidence | null; onClose: () => void }) {
  const hash = recommendation && typeof recommendation.evidencePack.sha256 === 'string' ? recommendation.evidencePack.sha256 : null
  const evidence = jarvisEvidence
  return <><button className="drawer-backdrop" onClick={onClose} aria-label="Close evidence drawer" /><aside className="evidence-drawer"><div className="drawer-header"><div><span className="drawer-kicker"><Database size={13} /> {evidence ? 'JARVIS GROUNDED EVIDENCE' : 'IMMUTABLE EVIDENCE PACK'}</span><h2>{evidence ? 'Review before action' : recommendation ? recommendation.title : 'No evidence yet'}</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="drawer-scroll">{evidence ? <><div className="drawer-hero"><span>{evidence.page} · {evidence.confidenceLevel} confidence</span><strong>{evidence.suggestedAction?.label ?? 'Evidence only'}</strong><small>Generated from real tenant data · {evidence.generatedAt}</small></div><div className="drawer-section"><div className="drawer-section-title"><ShieldCheck size={15} /> Facts and sources</div><div className="evidence-stack">{evidence.facts.map((fact, index) => <div className="evidence-line" key={fact.key}><span>{String(index + 1).padStart(2, '0')}</span><strong>{fact.label}: {String(fact.value ?? '—')}</strong><small>{fact.source}</small><CheckCircle2 size={15} /></div>)}</div></div><div className="drawer-section"><div className="drawer-section-title"><LockKeyhole size={15} /> Action safety</div><div className="safety-list"><span><Check size={14} /> AI sees language-safe evidence only</span><span><Check size={14} /> Risky actions require explicit confirmation</span><span><Check size={14} /> Merchant-owned draft/sender checks remain enforced</span></div></div></> : recommendation ? <><div className="drawer-hero"><span>{recommendation.impactLabel}</span><strong>{formatMoney(recommendation.impactValue, recommendation.currency)}</strong><small>Deterministic rule output · {recommendation.ruleId}</small></div><div className="drawer-section"><div className="drawer-section-title"><ShieldCheck size={15} /> Proof and status</div><div className="evidence-stack"><div className="evidence-line"><span>01</span><strong>{recommendation.reason}</strong><CheckCircle2 size={15} /></div><div className="evidence-line"><span>02</span><strong>Confidence: {recommendation.confidenceLevel}</strong><CheckCircle2 size={15} /></div><div className="evidence-line"><span>03</span><strong className="mono">SHA-256: {hash ?? 'unavailable'}</strong><CheckCircle2 size={15} /></div></div></div><div className="drawer-section"><div className="drawer-section-title"><LockKeyhole size={15} /> Action safety</div><div className="safety-list"><span><Check size={14} /> {recommendation.actionRisk.replaceAll('_', ' ')} policy</span><span><Check size={14} /> CAS approval version {recommendation.version}</span><span><Check size={14} /> AI language: {recommendation.explanationStatus}</span></div></div></> : <div className="gated-panel"><LockKeyhole size={22} /><strong>No persisted evidence packs</strong><p>Run analysis after the store snapshot is available. The UI will never fabricate evidence.</p></div>}</div><div className="drawer-footer"><button className="button secondary" onClick={onClose}>Close</button></div></aside></>
}

function PassiveRecommendationCard({ recommendation, onReview, onDismiss, onSnooze }: { recommendation: Recommendation; onReview: () => void; onDismiss: () => void; onSnooze: () => void }) {
  return <aside className="passive-recommendation-card" aria-live="polite"><div className="passive-card-heading"><span className="passive-card-icon"><Sparkles size={15} /></span><span><small>JARVIS RECOMMENDATION</small><strong>{recommendation.title}</strong></span><button onClick={onDismiss} aria-label="Dismiss recommendation"><X size={14} /></button></div><p>{recommendation.reason}</p><div className="passive-card-meta"><span className={`status-badge ${recommendation.confidenceLevel === 'HIGH' ? 'green' : 'amber'}`}>{recommendation.confidenceLevel} confidence</span><span>Already in your recommendations</span></div><div className="passive-card-actions"><button className="button primary" onClick={onReview}><Eye size={13} /> Review evidence</button><button className="button secondary" onClick={onSnooze}><Clock3 size={13} /> Snooze 1 hour</button></div></aside>
}

/**
 * PR #46: the bell now shows real pending recommendations. "New" means a
 * PENDING recommendation whose id has not been marked read on this device;
 * opening the drawer and clicking a row (or "Mark all read") clears it.
 */
function NotificationDrawer({ recommendations, unreadIds, onOpenRecommendation, onMarkAllRead, onClose }: { recommendations: readonly Recommendation[]; unreadIds: ReadonlySet<string>; onOpenRecommendation: (id: string) => void; onMarkAllRead: () => void; onClose: () => void }) {
  const pending = recommendations.filter((item) => item.status === 'PENDING').slice(0, 10)
  const unreadCount = pending.filter((item) => unreadIds.has(item.id)).length
  return <><button className="drawer-backdrop" onClick={onClose} aria-label="Close notifications" /><aside className="notification-drawer"><div className="drawer-header"><div><span className="drawer-kicker"><Bell size={13} /> NOTIFICATIONS</span><h2>{unreadCount > 0 ? `${unreadCount} new recommendation${unreadCount === 1 ? '' : 's'}` : pending.length > 0 ? 'Pending recommendations' : 'No new notifications'}</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>{pending.length === 0 ? <div className="notification-empty"><Bell size={22} /><strong>Quiet by default</strong><span>New AI recommendations appear here the moment they are generated from your real store data.</span></div> : <div className="notification-list">{pending.map((item) => <button key={item.id} className={`notification-row ${unreadIds.has(item.id) ? 'unread' : ''}`} onClick={() => onOpenRecommendation(item.id)}><span className="notification-row-icon"><WandSparkles size={14} /></span><span className="notification-row-copy"><strong>{item.title}</strong><small>{formatMoney(item.impactValue, item.currency)} · pending your decision</small></span>{unreadIds.has(item.id) && <i className="notification-dot" />}</button>)}{unreadCount > 0 && <button className="text-button full" onClick={onMarkAllRead}>Mark all read <Check size={13} /></button>}</div>}<button className="text-button full" onClick={onClose}>Close drawer <X size={14} /></button></aside></>
}
function CommandPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate: (page: SectionId) => void }) { const [query, setQuery] = useState(''); const results = navGroups.flatMap((group) => group.items).filter((item) => item.label.toLowerCase().includes(query.toLowerCase())).slice(0, 10); return <div className="command-overlay"><button className="command-overlay-close" onClick={onClose} aria-label="Close command palette" /><div className="command-panel command-palette"><div className="command-input-wrap"><Search size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sections…" /><kbd>ESC</kbd></div><div className="command-results"><span className="command-section-label">Navigate</span>{results.map((item) => { const Icon = item.icon; return <button key={item.id} className="command-result" onClick={() => onNavigate(item.id)}><span className="command-result-icon"><Icon size={16} /></span><span>{item.label}</span>{item.tag && <small>{item.tag}</small>}<ChevronRight size={15} /></button> })}{results.length === 0 && <div className="command-empty"><Search size={20} /><strong>No matching section</strong><span>Try Dashboard, Analytics, or Settings.</span></div>}</div><div className="command-footer"><span><ArrowUpRight size={13} /> Open</span><span><ChevronDown size={13} /> Navigate</span><span><kbd>ESC</kbd> Close</span></div></div></div> }
function OnboardingModal({ onClose }: { onClose: () => void }) { const [shop, setShop] = useState(''); const [error, setError] = useState<string | null>(null); const connect = () => { const normalized = shop.trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) { setError('Enter a valid *.myshopify.com domain.'); return } window.location.assign(`/shopify/install?shop=${encodeURIComponent(normalized)}`) }; return <div className="modal-overlay"><div className="modal-card onboarding-modal"><div className="modal-icon"><ShoppingBag size={21} /></div><div className="section-kicker">SHOPIFY INSTALL</div><h2>Connect your real store</h2><p>ProfitPilot will start the signed OAuth flow. No demo workspace is created.</p><label>Shopify domain<input autoFocus value={shop} onChange={(event) => setShop(event.target.value)} placeholder="your-store.myshopify.com" /></label>{error && <div className="form-error"><AlertCircle size={14} />{error}</div>}<div className="modal-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" onClick={connect}>Continue to Shopify <ArrowUpRight size={14} /></button></div></div></div> }
function ShortcutsModal({ onClose }: { onClose: () => void }) { return <div className="modal-overlay"><div className="modal-card shortcuts-modal"><div className="modal-card-top"><div><div className="section-kicker"><Keyboard size={13} /> KEYBOARD SHORTCUTS</div><h2>Move with intention.</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><Shortcut keys="⌘ K" label="Open command palette" /><Shortcut keys="?" label="Open keyboard shortcuts" /><Shortcut keys="ESC" label="Close the active drawer or modal" /><Shortcut keys="⌘ /" label="Search the current section" /><button className="button primary full-width" onClick={onClose}>Done</button></div></div> }
function Shortcut({ keys, label }: { keys: string; label: string }) { return <div className="shortcut-row"><kbd>{keys}</kbd><span>{label}</span><Check size={14} /></div> }
function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) { const Icon = toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? AlertCircle : Info; return <div className={`toast ${toast.kind}`}><span className="toast-icon"><Icon size={16} /></span><span>{toast.message}</span><button onClick={onClose} aria-label="Close notification"><X size={15} /></button></div> }
function readStoredStringArray(key: string): readonly string[] { try { const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] } catch { return [] } }
function readStoredNumberRecord(key: string): Readonly<Record<string, number>> { try { const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}'); if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))) } catch { return {} } }
function storeStringArray(key: string, value: readonly string[]): void { try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* Storage may be disabled in a hardened embedded browser. */ } }
function storeNumberRecord(key: string, value: Readonly<Record<string, number>>): void { try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* Storage may be disabled in a hardened embedded browser. */ } }
/** True for the 503 the API returns while a store's Shopify circuit is open. */
function isCircuitOpen(error: unknown): boolean { return error instanceof ApiClientError && error.status === 503 && /circuit is open/i.test(error.message) }
function errorMessage(error: unknown): string { if (error instanceof ApiClientError) return error.message; if (error instanceof Error) return error.message; return 'The API could not be reached.' }
function isTypingTarget(target: EventTarget | null): boolean { return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement }
