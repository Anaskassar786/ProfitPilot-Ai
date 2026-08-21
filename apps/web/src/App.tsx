import { Button, AppNavigationMenu, AppTitleBar, showAppBridgeToast, PolarisEmpty, SimpleModal, LoadingSpinner } from './polaris-ui.js'
import { Banner, Layout, Page } from '@shopify/polaris'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { LucideIcon } from './icons.js'
// Section icons are Lucide glyphs plus PatternAI's own constellation mark,
// which renders the same `size`/`className` contract without being a Lucide
// forwardRef component — hence the widened icon type below.
type SectionIcon = LucideIcon | ((props: Readonly<{ size?: number | string; className?: string; strokeWidth?: number }>) => ReactElement)
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
  GraduationCap,
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
  ClipboardCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Gift,
  Tag,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserCircle,
  Users,
  Volume2,
  WalletCards,
  Workflow,
  X,
  Zap,
} from './icons.js'
import { PhaseNotImplementedError, PLAN_ENTITLEMENT_LIMITS, HIDDEN_METER_KEYS, FAIR_USE_ORDERS_30D, FAIR_USE_PRODUCTS_ACTIVE, FAIR_USE_CUSTOMERS } from '@profitpilot/types'
import type { EntitlementKey, PlanTier } from '@profitpilot/types'
import { analyzeRecommendations, createBillingCharge, resetSyncCircuit, createCampaignTemplate, createTicket, decideRecommendation, exportRows, fetchAgentStatuses, fetchAnalytics, fetchBilling, fetchBillingPlans, fetchBillingRoi, fetchBillingUsage, fetchCampaignTemplates, fetchCatalog, fetchInventory, fetchJarvisPreferences, initializeCsrf, fetchRecommendations, fetchSessionContext, fetchSyncStatus, fetchTickets, redeemGiftCode, requestSync, requestSyncAll, saveMerchantEmail, setEmbeddedAuthFailureHandler, setEmbeddedAuthRecoveryHandler, verifyBillingCharge, verifyMerchantEmail, warmUpEmbeddedSessionToken, ApiClientError } from './api.js'
import { AutomationWorkspace } from './automation.js'
import { isDeveloperWorkspace } from './dev-workspace.js'
import type { AgentStatus, AnalyticsSnapshot, CatalogProduct, Recommendation, SectionId, WorkspaceContext } from './model.js'
import type { InventoryPageResult } from './inventory-model.js'
import { JarvisExperience } from './f8.js'
import { JarvisNavIcon, JarvisWorkspace } from './jarvis-page.js'
import { ReportsWorkspace } from './reports.js'
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
import { greetingForHour } from './recommendations-model.js'
import { DashboardLayout } from './dashboard.js'
import { CommandCenterWorkspace } from './command-center.js'
import { ProductsWorkspace } from './products.js'
import { OrdersWorkspace } from './orders.js'
import { CustomersPage } from './customers.js'
import { InventoryWorkspace } from './inventory.js'
import { AnalyticsPage as RedesignedAnalyticsPage } from './analytics.js'
import { RecommendationsWorkspace } from './recommendations.js'
import { GrowthIqPage } from './executive.js'
import { StoreCoachWorkspace } from './store-coach.js'
import { AiCommandPage } from './ai-command-page.js'
import { HelpSupportPage } from './support.js'
import { isAiCommandHash, isCampaignsHash } from './ai-command-model.js'
import { CoachWidget } from './coach-widget.js'
import { PatternAiWorkspace } from './patternai.js'
import { ExportsWorkspace } from './exports.js'
import { QaChartBoard } from './qa-board.js'
import { PatternAiIcon } from './patternai-logo.js'
import { GrowthIqNavIcon } from './growthiq-logo.js'
import { AiCommandIcon } from './ai-command-logo.js'
import { SettingsPage } from './settings.js'
import { SETTINGS_EVENT, readWorkspaceSettings } from './settings-model.js'

/* ═══════════════════════════════════════════════════════════════════════
 * 🛑 Jarvis TEMPORARILY REMOVED from product navigation (Aug 2026).
 *    To restore: uncomment the `jarvis` item below in the 'AI employee'
 *    group and add its entry back in `pageMeta` & `PageRouter`.
 *    All existing Jarvis code, components, routes, APIs, and logic
 *    remain preserved — nothing was deleted.
 * ═══════════════════════════════════════════════════════════════════════ */
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
      { id: 'command-center', label: 'AI Command Center', icon: Bot },
      { id: 'recommendations', label: 'Recommendations', icon: Sparkles },
      { id: 'automation', label: 'Automation', icon: Workflow },
      { id: 'ai-command', label: 'AI Command', icon: AiCommandIcon },
      /* 🛑 Jarvis nav item temporarily removed — restore when Jarvis returns */
      // { id: 'jarvis', label: 'Jarvis', icon: JarvisNavIcon },
    ],
  },
  {
    label: 'AI Growth Command',
    items: [
      { id: 'store-coach', label: 'Store Coach', icon: GraduationCap },
      { id: 'ai-executive', label: 'GrowthIQ', icon: GrowthIqNavIcon },
      { id: 'patternai', label: 'PatternAI', icon: PatternAiIcon },
    ],
  },
  {
    label: 'Business',
    items: [
      { id: 'reports', label: 'Reports', icon: FileBarChart },
      { id: 'exports', label: 'Exports', icon: Download },
      { id: 'support', label: 'Help & Support', icon: LifeBuoy },
      { id: 'billing', label: 'Billing', icon: WalletCards },
      { id: 'settings', label: 'Settings', icon: Settings },
      /* Operator-only console — filtered out for regular merchants (see visibleNavGroups). */
      { id: 'admin-ops', label: 'Admin Ops', icon: ShieldCheck, devOnly: true },
      /* QA Chart Board — dev workspace only (the QA report as a live board). */
      { id: 'qa-board', label: 'QA Chart Board', icon: ClipboardCheck, devOnly: true },
    ],
  },
]

/**
 * Nav groups a given workspace may see. `devOnly` items (Admin Ops) are
 * stripped for regular merchants — only the app owner / developer workspace
 * (see `isDeveloperWorkspace`) ever renders them.
 */
function visibleNavGroups(devWorkspace: boolean): ReadonlyArray<{ label: string; items: ReadonlyArray<NavItem> }> {
  if (devWorkspace) return navGroups
  return navGroups
    .map((group) => ({ label: group.label, items: group.items.filter((item) => !item.devOnly) }))
    .filter((group) => group.items.length > 0)
}

/* 🛑 Jarvis pageMeta entry temporarily removed — restore when Jarvis returns */
const pageMeta: Readonly<Record<SectionId, Readonly<{ title: string; description: string; icon: SectionIcon }>>> = {
  dashboard: { title: 'Dashboard', description: 'A clear view of the store data ProfitPilot is receiving.', icon: LayoutDashboard },
  products: { title: 'Products', description: 'Catalog records synced from Shopify, with no invented inventory.', icon: Package },
  orders: { title: 'Orders', description: 'Search, filter, inspect, and export real Shopify orders with plan-aware intelligence.', icon: ShoppingBag },
  customers: { title: 'Customers', description: 'Customer data stays tenant-scoped and minimized by default.', icon: Users },
  inventory: { title: 'Inventory', description: 'Inventory levels and days-of-cover from your Shopify store.', icon: Box },
  analytics: { title: 'Analytics', description: 'AI-powered insights into your store performance.', icon: LineChart },
  'command-center': { title: 'AI Command Center', description: 'Your AI workforce, always working for you. Every insight backed by real data — never invented.', icon: Bot },
  recommendations: { title: 'Recommendations', description: 'Your AI team has been watching your store. Review opportunities and take action.', icon: Sparkles },
  'ai-growth-command': { title: 'Store Coach', description: 'Daily huddles, goals, and chat grounded in your real store data.', icon: GraduationCap },
  'store-coach': { title: 'Store Coach', description: 'Daily huddles, goals, and chat grounded in your real store data.', icon: GraduationCap },
  'ai-executive': { title: 'GrowthIQ', description: 'Intelligent growth for ambitious merchants — strategy, benchmarks, scenarios, and board reports from your real store data.', icon: GrowthIqNavIcon },
  automation: { title: 'Automation', description: 'Automate the busywork — recover carts, welcome customers, and stay on top of stock.', icon: Workflow },
  patternai: { title: 'PatternAI', description: 'Discover the patterns that drive your business — discoveries, lessons, personas, and Why? answers computed from your real synced data.', icon: PatternAiIcon },
  campaigns: { title: 'AI Command', description: 'Campaigns has been replaced by AI Command.', icon: AiCommandIcon },
  copilot: { title: 'AI Command', description: 'One command controls everything.', icon: AiCommandIcon },
  'ai-command': { title: 'AI Command', description: 'Ask questions and approve real store actions from one command surface.', icon: AiCommandIcon },
  /* 🛑 Jarvis page — data preserved for type safety but not rendered in UI (removed from navGroups & PageRouter) */
  jarvis: { title: 'Jarvis', description: 'Your spoken store assistant — page-aware briefings, no chat box.', icon: JarvisNavIcon },
  reports: { title: 'Business Reports', description: 'Generate professional reports from your real store data.', icon: FileBarChart },
  exports: { title: 'Data Exports', description: 'Download your real store data anytime — orders, products, activity, and revenue.', icon: Download },
  support: { title: 'Support tickets', description: 'A direct, auditable line to the ProfitPilot team.', icon: LifeBuoy },
  billing: { title: 'Billing', description: 'Your trial, plan, usage, and verified AI return on this store.', icon: WalletCards },
  settings: { title: 'Settings', description: 'Store context, preferences, and security controls.', icon: Settings },
  'admin-ops': { title: 'Admin Ops', description: 'Launch controls, merchant flags, queue inspection, and retries.', icon: ShieldCheck },
  'qa-board': { title: 'QA Chart Board', description: 'End-to-end QA results: every area tested, every bug found, every fix applied — as a live board.', icon: ClipboardCheck },
}

type NavItem = Readonly<{ id: SectionId; label: string; icon: SectionIcon; devOnly?: boolean }>
type LoadState = 'idle' | 'loading' | 'ready' | 'partial' | 'offline'
type ToastKind = 'success' | 'info' | 'warning' | 'error'
const syncModules = ['products', 'orders', 'customers', 'inventory', 'checkouts', 'collections', 'discounts', 'transactions'] as const
type SyncModuleProgress = Readonly<{ module: (typeof syncModules)[number]; status: 'syncing' | 'succeeded' | 'failed'; detail: string }>

type WorkspaceData = Readonly<{ analytics: AnalyticsSnapshot | null; catalog: readonly CatalogProduct[]; agents: readonly AgentStatus[]; recommendations: readonly Recommendation[]; inventory: InventoryPageResult | null; loadState: LoadState; error: string | null }>

const HEADER_NAV: ReadonlyArray<Readonly<{ label: string; page: SectionId }>> = [
  { label: 'Dashboard', page: 'dashboard' },
  { label: 'AI Command Center', page: 'command-center' },
  { label: 'Recommendations', page: 'recommendations' },
  { label: 'Automation', page: 'automation' },
  { label: 'Products', page: 'products' },
  { label: 'Orders', page: 'orders' },
  { label: 'Customers', page: 'customers' },
  { label: 'Inventory', page: 'inventory' },
  { label: 'Store Coach', page: 'store-coach' },
  { label: 'GrowthIQ', page: 'ai-executive' },
  { label: 'PatternAI', page: 'patternai' },
  { label: 'Reports', page: 'reports' },
  { label: 'Billing', page: 'billing' },
  { label: 'Settings', page: 'settings' },
]

function HeaderNavigation({ activePage, onNavigate }: { activePage: SectionId; onNavigate: (page: SectionId) => void }) {
  // HOTFIX 3: header tabs are SPA-only. They are buttons wired to the
  // client-side `navigate` (history.pushState + state) — never `<a href>`
  // anchors, so switching tabs can never hard-reload the embedded iframe.
  return (
    <nav className="header-navigation" aria-label="ProfitPilot pages">
      <div className="header-navigation-scroll">
        {HEADER_NAV.map((item) => (
          <button key={item.page} type="button" className={`header-navigation-tab ${activePage === item.page ? 'is-active' : ''}`} aria-current={activePage === item.page ? 'page' : undefined} onClick={() => onNavigate(item.page)}>
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  )
}

/**
 * HOTFIX 3 — globally cached bootstrap context (`hasStoreContext`).
 *
 * The resolved `/session/context` result is cached at module scope so tab
 * switching and remounts never re-run the boot-time loading sequence
 * (App Bridge token warm-up + tenant lookup). Keyed by shop so a different
 * store still bootstraps from scratch. SPA tab switches never hit this path
 * at all — the cache only short-circuits remounts (StrictMode, HMR, and any
 * legitimate reload that reaches the shell again).
 */
let embeddedBootstrapCache: Readonly<{ shop: string | null; context: WorkspaceContext }> | null = null

function readEmbeddedBootstrapCache(shop: string | null): WorkspaceContext | null {
  if (!embeddedBootstrapCache) return null
  const cacheKey = shop ?? embeddedBootstrapCache.shop
  if (embeddedBootstrapCache.shop === cacheKey) return embeddedBootstrapCache.context
  return null
}

function rememberEmbeddedBootstrapCache(shop: string | null, context: WorkspaceContext): void {
  embeddedBootstrapCache = { shop: shop ?? context.shop ?? null, context }
}

/** Clears the boot cache between isolated tests (exported for tests only). */
export function resetEmbeddedBootstrapCacheForTests(): void {
  embeddedBootstrapCache = null
}

export default function App() {
  // PR #46: a #/recommendations deep link (with optional /:id) opens the
  // Recommendations page directly, so shared links and refreshes land where
  // the user expects instead of resetting to the dashboard.
  // /ai-growth-command/patternai* deep links open PatternAI (the pre-rebrand
  // /ai-growth-command/insights* paths still resolve); its sub-tabs manage
  // their own detail segments from there.
  const [activePage, setActivePage] = useState<SectionId>(() => {
    /* 🛑 Jarvis hash routing temporarily removed */
    // if (window.location.hash.startsWith('#/jarvis')) return 'jarvis'
    if (window.location.hash.startsWith('#/recommendations')) return 'recommendations'
    if (hashSection(window.location.hash) !== null) return hashSection(window.location.hash)!
    if (isAiCommandHash(window.location.hash) || window.location.pathname.startsWith('/ai-command')) return 'ai-command'
    if (isCampaignsHash(window.location.hash) || window.location.pathname.startsWith('/campaigns') || window.location.hash.startsWith('#/copilot')) return 'ai-command'
    if (window.location.hash.startsWith('#/ai-growth-command/growthiq') || window.location.hash.startsWith('#/ai-growth-command/executive')) return 'ai-executive'
    if (window.location.pathname.startsWith('/ai-growth-command/patternai') || window.location.pathname.startsWith('/ai-growth-command/insights')) return 'patternai'
    if (window.location.pathname.startsWith('/ai-growth-command/growthiq') || window.location.pathname.startsWith('/ai-growth-command/executive')) return 'ai-executive'
    if (window.location.pathname.startsWith('/ai-growth-command')) return 'store-coach'
    if (window.location.pathname.startsWith('/automation')) return 'automation'
    const fromPath = sectionFromPath(window.location.pathname)
    if (fromPath) return fromPath
    return 'dashboard'
  })
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
  const [workspacePrefs, setWorkspacePrefs] = useState(() => readWorkspaceSettings(null))
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
  const [syncProgress, setSyncProgress] = useState<readonly SyncModuleProgress[]>([])
  const [syncAllRunning, setSyncAllRunning] = useState(false)
  const [data, setData] = useState<WorkspaceData>({ analytics: null, catalog: [], agents: [], recommendations: [], inventory: null, loadState: 'idle', error: null })
  // Tenant context comes first from the URL (the post-OAuth redirect carries
  // storeId/shop/host), then from the session cookie via /session/context so a
  // refresh inside Shopify admin keeps the workspace attached.
  const urlContext = useMemo(() => workspaceContext(window.location.search), [])
  const [resolvedContext, setResolvedContext] = useState<WorkspaceContext>({ storeId: null, shop: null })
  // HOTFIX 2: boot state for the embedded store context.
  //   'loading'     — bootstrap (App Bridge session token + /session/context)
  //                   still in flight; the shell must NEVER paint the connect
  //                   wall during this window.
  //   'ready'       — bootstrap settled; the connect wall may only appear when
  //                   it resolved to no store AND no shop is known.
  //   'unavailable' — bootstrap failed transiently; offer a retry, never an
  //                   "install from scratch" flow.
  const [authState, setAuthState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [sessionError, setSessionError] = useState<string | null>(null)
  const context: WorkspaceContext = { storeId: urlContext.storeId ?? resolvedContext.storeId, shop: urlContext.shop ?? resolvedContext.shop }
  /** True only when the bootstrap settled and the app is genuinely not
   * connected: no tenant row AND no shop known from the URL/API. */
  const showConnect = authState === 'ready' && !context.storeId && !context.shop
  // QA (2026-08-20): real Shopify connection health for the sidebar card,
  // fetched from /sync/status instead of assuming "all systems active".
  const [syncHealth, setSyncHealth] = useState<import('./api.js').SyncStatus | null>(null)
  useEffect(() => {
    if (!context.storeId) { setSyncHealth(null); return }
    let cancelled = false
    setSyncHealth(null)
    void fetchSyncStatus(context.storeId).then((status) => { if (!cancelled) setSyncHealth(status) }).catch(() => { if (!cancelled) setSyncHealth(null) })
    return () => { cancelled = true }
  }, [context.storeId])

  // HOTFIX 2 + HOTFIX 3: single embedded bootstrap path. (1) Reuse the
  // globally cached store context when present so tab switching/remounts
  // never re-run the loading sequence; (2) wait for the App Bridge session
  // token (retried once) so the very first fetch carries
  // `Authorization: Bearer …`; (3) resolve the tenant from /session/context.
  // A 401 or a transient failure is NEVER treated as "not installed", and a
  // successful bootstrap clears any banner a transient token race latched.
  useEffect(() => {
    if (urlContext.storeId) {
      setAuthState('ready')
      return
    }
    const cached = readEmbeddedBootstrapCache(urlContext.shop)
    if (cached) {
      setResolvedContext(cached)
      setSessionError(null)
      setAuthState('ready')
      return
    }
    let cancelled = false
    void (async () => {
      setAuthState('loading')
      await warmUpEmbeddedSessionToken()
      if (cancelled) return
      const query = urlContext.shop ? `?shop=${encodeURIComponent(urlContext.shop)}` : ''
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await fetchSessionContext(query)
          if (cancelled) return
          // The session is valid — clear any false session-expired latch
          // (HOTFIX 3 auto-clear).
          setSessionError(null)
          setResolvedContext(result)
          rememberEmbeddedBootstrapCache(urlContext.shop, result)
          setAuthState('ready')
          return
        } catch (error: unknown) {
          if (cancelled) return
          if (error instanceof ApiClientError && error.status === 401) {
            // Session expired AFTER the fetcher's silent fresh-token retry:
            // single re-auth banner, NOT an install wall.
            if (!urlContext.storeId && !context.storeId) setSessionError('Your Shopify session expired — reload the app to reconnect.')
            setAuthState('ready')
            return
          }
          if (attempt === 1) {
            setAuthState('unavailable')
            return
          }
        }
      }
    })()
    return () => { cancelled = true }
  }, [urlContext.storeId, urlContext.shop])

  const retryContext = () => {
    setSessionError(null)
    void (async () => {
      setAuthState('loading')
      await warmUpEmbeddedSessionToken()
      const query = urlContext.shop ? `?shop=${encodeURIComponent(urlContext.shop)}` : ''
      try {
        const result = await fetchSessionContext(query)
        setSessionError(null)
        setResolvedContext(result)
        rememberEmbeddedBootstrapCache(urlContext.shop, result)
        setAuthState('ready')
      } catch (error: unknown) {
        if (error instanceof ApiClientError && error.status === 401) {
          setSessionError('Your Shopify session expired — reload the app to reconnect.')
          setAuthState('ready')
          return
        }
        setAuthState('unavailable')
      }
    })()
  }

  const showToast = (message: string, kind: ToastKind = 'success') => {
    // Single toast surface: App Bridge toast when embedded, otherwise the
    // Polaris ToastHost inside Frame. Never also paint the custom `.toast`
    // node — that was the duplicate session-expired banner.
    showAppBridgeToast(message, kind)
  }

  useEffect(() => {
    // Embedded App Bridge session tokens (P0 App Store fix): the failure
    // handler only fires from the fetcher's 401-AFTER-fresh-token-retry path,
    // so a transient token race can never latch it. The single surface is
    // the Polaris session banner below — never stacked toasts.
    setEmbeddedAuthFailureHandler(() => {
      // Only the bootstrap phase is allowed to surface this banner, and only
      // when no usable store data has loaded yet — page data rendering
      // successfully means the session is valid.
      const primaryDataLoaded = Boolean(context.storeId && data.analytics)
      if (!primaryDataLoaded) setSessionError('Your Shopify session expired — reload the app to reconnect.')
    })
    // HOTFIX 3: any successful authenticated API call proves the session is
    // valid and auto-clears a false session-expired banner. The red banner
    // can never stay visible while real page data is rendering.
    setEmbeddedAuthRecoveryHandler(() => setSessionError(null))
    return () => {
      setEmbeddedAuthFailureHandler(null)
      setEmbeddedAuthRecoveryHandler(null)
    }
  }, [context.storeId, data.analytics])

  useEffect(() => {
    // Unsafe requests (sync, billing, tickets, ...) must echo a signed CSRF
    // token once the session cookie is present, or the API rejects them.
    void initializeCsrf().catch(() => {})
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const chargeId = params.get('charge_id')?.trim() || params.get('chargeId')?.trim()
    if (!chargeId || !context.storeId) return
    let cancelled = false
    void (async () => {
      try {
        await initializeCsrf()
        await verifyBillingCharge(context.storeId!, chargeId)
        if (cancelled) return
        showToast('Plan activated successfully!', 'success')
        params.delete('charge_id')
        params.delete('chargeId')
        const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`
        window.history.replaceState(null, '', next)
        window.dispatchEvent(new Event('profitpilot:billing-updated'))
      } catch (error: unknown) {
        if (!cancelled) showToast(errorMessage(error), 'error')
      }
    })()
    return () => { cancelled = true }
  }, [context.storeId])

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
    const nextLoadState = errors.length === 2 ? 'offline' : errors.length > 0 ? 'partial' : 'ready'
    // HOTFIX 3: real page data rendering successfully is proof the session is
    // valid — never leave a false session-expired banner above live content.
    if (nextLoadState === 'ready' || nextLoadState === 'partial') setSessionError(null)
    setData({ analytics, catalog, agents, recommendations, inventory, loadState: nextLoadState, error: errors[0] ? `Some synced data could not be loaded: ${errorMessage(errors[0].reason)}` : null })
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

  useEffect(() => {
    setWorkspacePrefs(readWorkspaceSettings(context.storeId))
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail) setWorkspacePrefs(detail)
    }
    window.addEventListener(SETTINGS_EVENT, onSettings)
    return () => window.removeEventListener(SETTINGS_EVENT, onSettings)
  }, [context.storeId])

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
    const next = page === 'campaigns' || page === 'copilot' ? 'ai-command' : page
    if (page === 'campaigns') showToast('Campaigns has been replaced by AI Command', 'info')
    if (next === 'automation' && !window.location.pathname.startsWith('/automation')) window.history.pushState({}, '', `/automation${window.location.search}`)
    else if (next !== 'automation' && window.location.pathname.startsWith('/automation')) window.history.pushState({}, '', `/${window.location.search}`)
    // Each AI Growth Command module is its own sidebar page with its own
    // pathname (same pattern PatternAI already used).
    const growthTarget = growthCommandPath(next)
    if (growthTarget && !window.location.pathname.startsWith(growthTarget)) window.history.pushState({}, '', `${growthTarget}${window.location.search}`)
    else if (!growthTarget && window.location.pathname.startsWith('/ai-growth-command')) window.history.pushState({}, '', `/${window.location.search}`)
    setActivePage(next)
    setMobileOpen(false)
    setCommandOpen(false)
    // Leaving Recommendations clears its hash route so a later refresh does
    // not bounce back; entering it establishes the base route for deep links.
    try {
      if (next === 'recommendations') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/recommendations`)
      /* 🛑 Jarvis hash navigation temporarily removed */
      // else if (next === 'jarvis') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/jarvis`)
      else if (next === 'ai-command') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/ai-command`)
      else if (next === 'ai-executive') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/ai-growth-command/growthiq`)
      else if (hashSection(window.location.hash) !== null || isAiCommandHash(window.location.hash) || isCampaignsHash(window.location.hash)) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    } catch { /* embedded browsers may restrict history access */ }
  }

  // Browser back/forward between the recommendations hash route, the
  // PatternAI path route, and other pages keeps the visible page in sync.
  useEffect(() => {
    const onHashNavigation = () => {
      const section = hashSection(window.location.hash)
      const onCommand = isAiCommandHash(window.location.hash) || isCampaignsHash(window.location.hash) || window.location.hash.startsWith('#/copilot')
      if (isCampaignsHash(window.location.hash)) showToast('Campaigns has been replaced by AI Command', 'info')
      const onPatternAi = window.location.pathname.startsWith('/ai-growth-command/patternai') || window.location.pathname.startsWith('/ai-growth-command/insights')
      const onExecutive = isGrowthIqLocation(window.location.pathname, window.location.hash)
      const onCoach = window.location.pathname.startsWith('/ai-growth-command')
      const onAutomation = window.location.pathname.startsWith('/automation')
      setActivePage((current) => (section !== null ? section : onCommand ? 'ai-command' : onPatternAi ? 'patternai' : onExecutive ? 'ai-executive' : onCoach ? 'store-coach' : onAutomation ? 'automation' : current === 'recommendations' || current === 'ai-command' /* 🛑 || current === 'jarvis' */ || current === 'ai-growth-command' || current === 'store-coach' || current === 'ai-executive' || current === 'patternai' || current === 'automation' ? 'dashboard' : current))
    }
    window.addEventListener('popstate', onHashNavigation)
    window.addEventListener('hashchange', onHashNavigation)
    return () => { window.removeEventListener('popstate', onHashNavigation); window.removeEventListener('hashchange', onHashNavigation) }
  }, [])
  const sync = async (module: string) => {
    if (!context.storeId) {
      // Installed merchants must never be thrown into the legacy install
      // modal: if a shop is known (or the bootstrap is still settling), the
      // right move is to wait/reload — not "connect from scratch".
      if (authState !== 'ready' || context.shop) { showToast('Your store context is still loading — try again in a moment.', 'info'); return }
      setOnboardingOpen(true)
      return
    }
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
    if (!context.storeId) {
      if (authState !== 'ready' || context.shop) { showToast('Your store context is still loading — try again in a moment.', 'info'); return }
      setOnboardingOpen(true)
      return
    }
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

  // HOTFIX 3: the banner region renders inside a Polaris Layout.Section (the
  // app shell is already wrapped in a Polaris Frame) so any banner pushes the
  // page content down gracefully instead of overlapping it.
  const showGlobalBanners =
    data.loadState === 'offline' ||
    data.loadState === 'partial' ||
    sessionError !== null ||
    showConnect ||
    (authState === 'ready' && !context.storeId && Boolean(context.shop) && !sessionError) ||
    (authState === 'unavailable' && !context.storeId)

  return (
    <div className={`app-shell ${lightMode ? 'light-mode' : ''} ${workspacePrefs.reducedMotion ? 'reduce-motion' : ''} ${workspacePrefs.bubbleEnabled ? '' : 'hide-jarvis'} jarvis-pos-${workspacePrefs.bubblePosition}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {/* HOTFIX 3: admin-side nav clicks route client-side through the SPA
          router — the iframe never hard-reloads on a tab switch. */}
      <AppNavigationMenu onNavigate={(section) => navigate(section as SectionId)} />
      <AppTitleBar title={pageMeta[activePage].title} />
      <HeaderNavigation activePage={activePage} onNavigate={navigate} />
      <main id="main-content" tabIndex={-1} className="page-scroll">
          {showGlobalBanners && (
            <Layout>
              <Layout.Section>
                {(data.loadState === 'offline' || data.loadState === 'partial') && <OfflineBanner error={data.error} partial={data.loadState === 'partial'} onRetry={() => void loadData()} />}
                {/* HOTFIX 2 + 3: one session-expired banner, one install banner
                    (only when the bootstrap settled with no store and no
                    known shop), and an honest "restoring context" notice for
                    installed merchants whose tenant lookup is pending or
                    failed — never a connect wall while auth is still loading.
                    The session banner auto-clears on the next successful API
                    call (or via onDismiss), so it can never stay stuck. */}
                {sessionError && <SessionExpiredBanner message={sessionError} onDismiss={() => setSessionError(null)} />}
                {showConnect && <ContextBanner onConnect={() => setOnboardingOpen(true)} />}
                {authState === 'ready' && !context.storeId && context.shop && !sessionError && <ContextPendingBanner shop={context.shop} />}
                {authState === 'unavailable' && !context.storeId && <ContextLoadErrorBanner onRetry={retryContext} />}
              </Layout.Section>
            </Layout>
          )}
          {(authState === 'ready' || urlContext.storeId) ? <PageRouter
            active={activePage}
            context={context}
            data={data}
            showConnect={showConnect}
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
            onOpenJarvis={() => setJarvisOpen(true)}
            workspaceSettings={workspacePrefs}
          /> : <div className="auth-gate"><LoadingSpinner label="Connecting your Shopify store…" /></div>}
      </main>
      {/* 🛑 JarvisExperience temporarily removed from UI — restore when Jarvis returns */}
      {/* <JarvisExperience open={jarvisOpen} context={context} page={activePage} workspaceSettings={workspacePrefs} onOpen={() => setJarvisOpen(true)} onClose={() => setJarvisOpen(false)} onEvidence={(evidence) => { setSelectedRecommendation(null); setJarvisEvidence(evidence ?? null); setEvidenceOpen(true) }} onToast={showToast} onPreferenceChange={setJarvisPreference} onNavigate={(page) => navigate(page as SectionId)} /> */}
      {/* 🛑 Passive recommendation card temporarily removed — restore when Jarvis returns */}
      {/* {passiveRecommendation && <PassiveRecommendationCard recommendation={passiveRecommendation} onReview={reviewPassiveRecommendation} onDismiss={dismissPassiveRecommendation} onSnooze={snoozePassiveRecommendation} />} */}
      {notificationsOpen && <NotificationDrawer recommendations={data.recommendations} unreadIds={unreadNotificationIds} onOpenRecommendation={(id) => { setReadNotificationIds((current) => new Set([...current, id])); persistReadNotifications([...readNotificationIds, id]); setNotificationsOpen(false); navigate('recommendations') }} onMarkAllRead={() => { const all = data.recommendations.filter((item) => item.status === 'PENDING').map((item) => item.id); setReadNotificationIds(new Set([...readNotificationIds, ...all])); persistReadNotifications([...readNotificationIds, ...all]) }} onClose={() => setNotificationsOpen(false)} />}
      {commandOpen && <CommandPalette devWorkspace={isDeveloperWorkspace(context)} onClose={() => setCommandOpen(false)} onNavigate={navigate} />}
      {/* PR #46: the global drawer only ever shows an explicitly selected
          recommendation (passive Jarvis review) or Jarvis page evidence — the
          old `?? data.recommendations[0]` fallback showed the wrong record. */}
      {evidenceOpen && <EvidenceDrawer recommendation={selectedRecommendation} jarvisEvidence={jarvisEvidence} onClose={() => { setEvidenceOpen(false); setJarvisEvidence(null); setSelectedRecommendation(null) }} />}
      {showConnect && onboardingOpen && <OnboardingModal onClose={() => setOnboardingOpen(false)} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      {profileOpen && <ProfileMenu lightMode={lightMode} onTheme={() => setLightMode((value) => !value)} onClose={() => setProfileOpen(false)} onSettings={() => { setProfileOpen(false); navigate('settings') }} />}
      {context.storeId && <CoachWidget storeId={context.storeId} onToast={showToast} />}
    </div>
  )
}

function Sidebar({ activePage, collapsed, mobileOpen, context, syncHealth, onNavigate, onCollapse, onClose, onOpenCommand, onOnboarding }: { activePage: SectionId; collapsed: boolean; mobileOpen: boolean; context: WorkspaceContext; syncHealth: import('./api.js').SyncStatus | null; onNavigate: (page: SectionId) => void; onCollapse: () => void; onClose: () => void; onOpenCommand: () => void; onOnboarding: () => void }) {
  const devWorkspace = isDeveloperWorkspace(context)
  return <>
    {mobileOpen && <Button className="mobile-backdrop" aria-label="Close navigation" onClick={onClose} />}
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="brand-row"><Button className="brand-lockup" onClick={() => onNavigate('dashboard')} aria-label="Go to dashboard"><span className="brand-mark"><span /></span>{!collapsed && <span className="brand-name">Profit<span>Pilot</span></span>}</Button><Button className="sidebar-collapse" onClick={onCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</Button><Button className="mobile-close" onClick={onClose} aria-label="Close navigation"><X size={18} /></Button></div>
      {!collapsed ? <Button className="workspace-switcher" onClick={context.storeId ? () => onNavigate('settings') : onOnboarding}><span className={`workspace-avatar ${context.storeId ? 'connected' : ''}`}>{context.storeId ? 'ON' : '—'}</span><span className="workspace-copy"><strong>{context.shop ?? 'No Shopify store'}</strong><small>{context.storeId ? 'Shopify connected' : 'Connect a store to begin'}</small></span><ChevronDown size={15} /></Button> : <Button className="workspace-switcher compact" onClick={context.storeId ? () => onNavigate('settings') : onOnboarding} aria-label="Open store context"><span className="workspace-avatar">{context.storeId ? 'ON' : '—'}</span></Button>}
      {!collapsed && <Button className="command-trigger search-workspace" onClick={onOpenCommand}><Search size={15} /><span>Search workspace</span><kbd>⌘ K</kbd></Button>}
      <nav className="side-nav" aria-label="Primary navigation">{visibleNavGroups(devWorkspace).map((group) => <div className="nav-group" key={group.label}>{!collapsed && <div className="nav-group-label">{group.label}</div>}{group.items.map((item) => { const Icon = item.icon; const showBillingDevDot = item.id === 'billing' && devWorkspace; return <Button key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => onNavigate(item.id)} title={collapsed ? item.label : undefined}><Icon size={17} strokeWidth={activePage === item.id ? 2.25 : 1.8} />{!collapsed && <span>{item.label}</span>}{!collapsed && showBillingDevDot && <span className="nav-dev-dot" role="img" aria-label="Real Shopify Checkout pending (Phase 2)" title="Real Shopify Checkout pending (Phase 2)" />}</Button> })}</div>)}</nav>
      <div className="sidebar-footer">{!collapsed && (context.storeId ? (() => {
        // QA (2026-08-20): the status line used to claim "Synced · All systems
        // active" for any connected store, even one that had never synced.
        // Derive it from the real /sync/status connection health instead.
        const health = syncHealth
        const circuitOpen = health?.circuit?.open === true
        const tokenOk = health?.hasAccessToken === true
        const statusText = health === null
          ? 'Checking sync status…'
          : circuitOpen
            ? 'Sync paused — reconnecting automatically'
            : tokenOk
              ? 'Synced · All systems active'
              : 'Connected · First sync pending'
        return (
          <div className={`connection-card ${circuitOpen ? 'paused' : ''}`} role="status">
            <div className="connection-card-head"><span className={`live-dot ${circuitOpen ? 'paused' : ''}`} /><strong>Shopify Connected</strong></div>
            <span className="connection-card-domain" title={context.shop ?? undefined}>{context.shop ?? 'Your Shopify store'}</span>
            <small className="connection-card-status">{statusText}</small>
          </div>
        )
      })() : <div className="connection-card idle"><div className="connection-card-head"><span className="live-dot idle" /><strong>Shopify Not Connected</strong></div><span className="connection-card-domain">No store linked yet</span><small className="connection-card-status">Connect your store to get started</small><Button onClick={onOnboarding}>Connect Shopify <ArrowUpRight size={13} /></Button></div>)}<Button className="help-link" onClick={() => onNavigate('support')} title={collapsed ? 'Help center' : undefined}><CircleHelp size={17} />{!collapsed && <span>Help center</span>}</Button>{!collapsed && <nav className="legal-links" aria-label="Legal and compliance"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a><a href="/legal/security">Security</a><a href="/legal/cookies">Cookies</a><a href="/legal/dpa">DPA</a></nav>}<div className="sidebar-user"><span className="user-avatar">AA</span>{!collapsed && <span className="sidebar-user-copy"><strong>ProfitPilot team</strong><small>Connected workspace</small></span>}{!collapsed && <MoreHorizontal size={16} />}</div></div>
    </aside>
  </>
}

function TopBar({ active, unreadCount, onMenu, onCommand, onNotifications, onProfile, profileOpen, lightMode, onTheme, onShortcuts }: { active: Readonly<{ title: string; icon: SectionIcon }>; unreadCount: number; onMenu: () => void; onCommand: () => void; onNotifications: () => void; onProfile: () => void; profileOpen: boolean; lightMode: boolean; onTheme: () => void; onShortcuts: () => void }) {
  const ActiveIcon = active.icon
  return <header className="topbar"><div className="topbar-left"><Button className="mobile-menu-button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></Button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong><ActiveIcon size={14} />{active.title}</strong></div></div><div className="topbar-actions"><Button className="top-search" onClick={onCommand}><Search size={16} /><span>Search</span><kbd>⌘ K</kbd></Button><Button className="icon-button" onClick={onShortcuts} aria-label="Keyboard shortcuts"><Keyboard size={17} /></Button><div className="topbar-divider" /><Button className="icon-button notification-button" onClick={onNotifications} aria-label={unreadCount > 0 ? `Open notifications (${unreadCount} new)` : 'Open notifications'}><Bell size={18} />{unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}</Button><Button className="icon-button" onClick={onTheme} aria-label="Toggle theme">{lightMode ? <Moon size={18} /> : <Sun size={18} />}</Button><Button className="profile-button" onClick={onProfile} aria-expanded={profileOpen}><span className="profile-avatar">PP</span><span className="profile-name">Workspace</span><ChevronDown size={14} /></Button></div></header>
}

function PageRouter({
  active,
  context,
  data,
  showConnect,
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
  onOpenJarvis,
  workspaceSettings,
}: {
  active: SectionId
  context: WorkspaceContext
  data: WorkspaceData
  showConnect: boolean
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
  onOpenJarvis: () => void
  workspaceSettings: ReturnType<typeof readWorkspaceSettings>
}) {
  if (active === 'dashboard')
    return (
      <DashboardPage
        context={context}
        data={data}
        showConnect={showConnect}
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
  if (active === 'ai-growth-command' || active === 'store-coach') return <StoreCoachWorkspace context={context} onToast={onToast} onNavigateBilling={() => onNavigate('billing')} />
  if (active === 'ai-executive') return <GrowthIqPage context={context} onToast={onToast} onNavigateBilling={() => onNavigate('billing')} onSync={onSync} />
  if (active === 'recommendations') return <PageLayout eyebrow="AI team" title="Recommendations" description="Your AI team has been watching your store 🎯 Here are opportunities to grow your business — review and take action."><RecommendationsWorkspace context={context} onToast={onToast} onNavigateBilling={() => onNavigate('billing')} onNavigateSection={onNavigate} /></PageLayout>
  if (active === 'patternai') return <PatternAiWorkspace context={context} catalog={data.catalog} onToast={onToast} onNavigateBilling={() => onNavigate('billing')} />
  if (active === 'automation') return <AutomationWorkspace context={context} onToast={onToast} onNavigateBilling={() => onNavigate('billing')} />
  if (active === 'campaigns' || active === 'copilot' || active === 'ai-command') return <AiCommandPage context={context} onToast={onToast} onNavigateBilling={() => onNavigate('billing')} />
  /* 🛑 Jarvis page route temporarily removed — restore when Jarvis returns */
  // if (active === 'jarvis') return <PageLayout eyebrow="Spoken assistant" title="Jarvis" description="Page-aware store voice. Chat stays in AI Command."><JarvisWorkspace context={context} onListen={onOpenJarvis} onToast={onToast} workspaceSettings={workspaceSettings} /></PageLayout>
  if (active === 'reports') return <ReportsWorkspace context={context} onNavigateBilling={() => onNavigate('billing')} onToast={onToast} />
  if (active === 'admin-ops') {
    // Operator console is developer/app-owner only — regular merchants never
    // see the nav item, and a direct navigation lands on a restricted notice.
    // (Server-side, every /admin/* route additionally requires the ADMIN_KEY step-up.)
    if (!isDeveloperWorkspace(context)) return <PageLayout eyebrow="Workspace" title="Page not available" description="This area is reserved for the ProfitPilot operations team."><EmptyState icon={LockKeyhole} title="Restricted section" description="Your workspace does not have access to operator controls." action="Back to dashboard" onAction={() => onNavigate('dashboard')} /></PageLayout>
    return <PageLayout eyebrow="Operator controls" title="Admin Ops" description="Final controls for maintenance, merchant flags, queues, and operational recovery."><AdminOpsWorkspace context={context} /></PageLayout>
  }
  if (active === 'billing') return <BillingPage context={context} onPhaseGate={onPhaseGate} onToast={onToast} />
  if (active === 'qa-board') {
    if (!isDeveloperWorkspace(context)) return <PageLayout eyebrow="Workspace" title="Page not available" description="This area is reserved for the ProfitPilot operations team."><EmptyState icon={LockKeyhole} title="Restricted section" description="Your workspace does not have access to operator controls." action="Back to dashboard" onAction={() => onNavigate('dashboard')} /></PageLayout>
    return <PageLayout eyebrow="QA workspace" title="QA Chart Board" description="End-to-end QA results — every area tested, every bug found, every fix applied — as a live board."><QaChartBoard context={context} /></PageLayout>
  }
  if (active === 'settings') return <SettingsPage context={context} lightMode={lightMode} onTheme={onTheme} onToast={onToast} onNavigateBilling={() => onNavigate('billing')} />
  if (active === 'support') return <HelpSupportPage context={context} onToast={onToast} onNavigate={onNavigate} onNavigateBilling={() => onNavigate('billing')} />
  if (active === 'exports') return <ExportsPage context={context} onToast={onToast} onNavigateBilling={() => onNavigate('billing')} />
  return <EmptyDataPage page={active} context={context} onSync={onSync} />
}

function DashboardPage({
  context,
  data,
  showConnect,
  onNavigate,
  onSync,
  onSyncAll,
  syncProgress,
  syncAllRunning,
  syncDismissing,
}: {
  context: WorkspaceContext
  data: WorkspaceData
  showConnect: boolean
  onNavigate: (page: SectionId) => void
  onSync: (module: string) => Promise<void>
  onSyncAll: () => Promise<void>
  syncProgress: readonly SyncModuleProgress[]
  syncAllRunning: boolean
  syncDismissing?: boolean
}) {
  const displayName = formatStoreDisplayName(context.shop)
  const greeting = greetingForHour(new Date().getHours())
  // HOTFIX 2: the "Connect your Shopify store" title is reserved for the rare
  // genuinely-uninstalled state. An installed store whose context is still
  // loading keeps the normal greeting instead of a misleading connect title.
  const greetingTitle = context.storeId
    ? (displayName ? `${greeting}, ${displayName}` : greeting)
    : showConnect
      ? 'Connect your Shopify store'
      : displayName
        ? `${greeting}, ${displayName}`
        : greeting
  const greetingDescription = context.storeId
    ? (displayName
        ? 'Welcome back — your workspace is ready for real Shopify data.'
        : 'Your workspace is ready for real Shopify data. Start a sync to build the first analytics snapshot.')
    : showConnect
      ? 'ProfitPilot never invents store numbers. Connect Shopify to unlock the live data plane.'
      : 'Looking for your Shopify store — your workspace will appear here in a moment.'

  return (
    <PageLayout
      eyebrow="Store intelligence"
      title={greetingTitle}
      description={greetingDescription}
      actions={
        <>
          <Button className="button secondary" onClick={() => onNavigate('analytics')}>
            <LineChart size={15} /> Open analytics
          </Button>
          <Button className="button primary" disabled={syncAllRunning} onClick={() => void onSyncAll()}>
            <RotateCcw size={15} className={syncAllRunning ? 'spin' : ''} /> {syncAllRunning ? 'Syncing all…' : 'Sync all'}
          </Button>
        </>
      }
    >
      <div className="sync-banner">
        <span className="sync-pulse">
          <span />
        </span>
        <span>
          <strong>{context.storeId ? 'Shopify data plane ready' : 'Waiting for store context…'}</strong> · {latestSyncLabel(data.analytics)}
        </span>
        {context.storeId && <Button onClick={() => void onSync('orders')}>Sync orders <ArrowUpRight size={13} /></Button>}
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
  return <PageLayout eyebrow="Catalog intelligence" title="Products" description="A real Shopify product workspace with variant-level stock, prices, images, and sales performance." actions={<><Button className="button secondary" onClick={() => void onSync('orders')}><ShoppingBag size={15} /> Sync orders</Button><Button className="button primary" onClick={() => void onSync('products')}><RefreshCw size={15} /> Sync products</Button></>}>
    <ProductsWorkspace context={context} catalog={catalog} analytics={analytics} onSync={onSync} />
  </PageLayout>
}

function EmptyDataPage({ page, context, onSync }: { page: SectionId; context: WorkspaceContext; onSync: (module: string) => Promise<void> }) { const meta = pageMeta[page]; const Icon = meta.icon; return <PageLayout eyebrow="Store data" title={meta.title} description={meta.description}><EmptyState icon={Icon} title={`No ${meta.title.toLowerCase()} data yet`} description={context.storeId ? 'This section is wired to the foundation and will render once its source module has real rows.' : 'Connect Shopify first. ProfitPilot does not ship demo records.'} action={context.storeId ? `Sync ${meta.title}` : 'Connect Shopify'} onAction={() => void onSync(page)} /></PageLayout> }

function CommandCenterPage({ context, onToast, onNavigate }: { context: WorkspaceContext; onToast: (message: string, kind?: ToastKind) => void; onNavigate: (page: string) => void }) {
  return <PageLayout eyebrow="AI employee" title="AI Command Center" description="Your AI workforce, always working for you. Every insight backed by real data — never invented.">
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
  return <PageLayout eyebrow="AI employee" title="Recommendations" description="Real deterministic signals with immutable evidence packs. AI language is optional and never supplies the numbers." actions={<><Button className="button secondary" onClick={onEvidence}><Eye size={15} /> Evidence drawer</Button><Button className="button primary" onClick={onRefresh}><RefreshCw size={15} /> Refresh decisions</Button></>}>
    <div className="recommendation-summary"><div><strong>{recommendations.length}</strong><span>recommendations returned</span></div><div className="summary-divider" /><div className="summary-stat"><span className="confidence-dot purple" /><strong>{pending.length}</strong><small>pending approval</small></div><div className="summary-stat"><span className="confidence-dot high" /><strong>{formatMoney(modeledImpact)}</strong><small>deterministic impact</small></div><div className="summary-spacer" /><span className="data-contract"><ShieldCheck size={14} /> Tenant-scoped API</span></div>
    {recommendations.length === 0 ? <EmptyState icon={Sparkles} title="No recommendations yet" description="Evidence is generated from your synced Shopify snapshot. After products and orders sync, click Generate recommendations. ProfitPilot will not invent a recommendation without store rows." action="How evidence works" onAction={onEvidence} /> : <div className="recommendation-list">{recommendations.map((item) => <RecommendationCard key={item.id} recommendation={item} onEvidence={onEvidence} onDecide={onDecide} />)}</div>}
  </PageLayout>
}

function RecommendationCard({ recommendation, onEvidence, onDecide }: { recommendation: Recommendation; onEvidence: () => void; onDecide: (id: string, decision: 'approve' | 'reject', expectedVersion: number) => Promise<void> }) {
  return <article className="recommendation-card"><div className="recommendation-card-main"><div className="recommendation-card-top"><span className="agent-pill"><span />{recommendation.agent}</span><span className={`confidence-pill ${recommendation.confidenceLevel.toLowerCase()}`}><span />{recommendation.confidenceLevel}</span><span className="recommendation-time">{recommendation.status}</span></div><h3>{recommendation.title}</h3><p>{recommendation.reason}</p><div className="evidence-snippets"><span><Database size={13} /> Rule {recommendation.ruleId} · v1.0.0</span><span><ShieldCheck size={13} /> {recommendation.explanationStatus}</span>{recommendation.explanation && <span><MessageSquare size={13} /> {recommendation.explanation}</span>}</div></div><div className="recommendation-card-side"><span className="impact-label">{recommendation.impactLabel}</span><strong>{formatMoney(recommendation.impactValue, recommendation.currency)}</strong><Button className="text-button" onClick={onEvidence}><Eye size={14} /> Evidence</Button>{recommendation.status === 'PENDING' ? <div className="recommendation-actions"><Button className="button reject" onClick={() => void onDecide(recommendation.id, 'reject', recommendation.version)}>Reject</Button><Button className="button approve" onClick={() => void onDecide(recommendation.id, 'approve', recommendation.version)}><Check size={14} /> Approve</Button></div> : <span className="resolved-label"><CheckCircle2 size={14} />{recommendation.status}</span>}</div></article>
}

function CampaignsComingSoon({ onNavigate, onNavigateAutomation }: { onNavigate: () => void; onNavigateAutomation: () => void }) {
  const previewFeatures = ['AI-drafted subject lines', 'Advanced segmentation', 'A/B testing', 'Revenue attribution', 'Full analytics'] as const
  return (
    <PageLayout eyebrow="Marketing center" title="Campaigns" description="A professional email marketing experience is on its way.">
      <div className="campaigns-coming-soon">
        <span className="campaigns-coming-soon-icon"><Mail size={26} /><Clock3 size={13} className="campaigns-coming-soon-clock" /></span>
        <div className="section-kicker"><span className="kicker-dot purple" />MARKETING CENTER</div>
        <h2>Campaigns are Coming Soon</h2>
        <p>We’re building a professional email marketing experience with full legal compliance. Currently, you can use automated workflows in the Automation module for transactional emails.</p>
        <div className="campaigns-coming-soon-features">
          {previewFeatures.map((feature) => <span key={feature}><Check size={14} />{feature}</span>)}
        </div>
        <div className="campaigns-coming-soon-actions">
          <Button className="button primary" onClick={onNavigate}><GraduationCap size={15} /> Try AI Growth Command Instead</Button>
          <Button className="button secondary" onClick={onNavigateAutomation}><Workflow size={15} /> Open Automation for transactional emails</Button>
        </div>
        <p className="campaigns-coming-soon-note">Your existing campaign templates are safe — nothing has been deleted, and they will be available again when Campaigns launches.</p>
      </div>
    </PageLayout>
  )
}

function CopilotPage({ onPhaseGate }: { onPhaseGate: (phase: string, capability: string) => void }) { const [query, setQuery] = useState(''); return <PageLayout eyebrow="Advanced query" title="Copilot" description="A closed-intent grammar will answer from evidence packs once F8 is implemented." actions={<Button className="button secondary"><Clock3 size={15} /> Thread history</Button>}><div className="copilot-layout"><section className="copilot-main"><div className="copilot-welcome"><span className="copilot-orb"><Sparkles size={22} /></span><div><div className="section-kicker">10 SUPPORTED INTENTS · F8</div><h2>Ask a grounded question.</h2><p>There are no generated answers in this phase.</p></div></div><div className="copilot-empty"><Database size={24} /><strong>Copilot is not answering yet</strong><span>F8 will connect closed grammar intents to real evidence tables.</span><Button className="button secondary" onClick={() => onPhaseGate('F8', 'Copilot answer generation')}><LockKeyhole size={14} /> View gate</Button></div><div className="copilot-composer"><div className="composer-label"><span><Command size={13} /> Try a future intent</span><span>Numbers will come from F2 tables</span></div><div className="composer-input"><textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Why did sales change this week?" rows={2} /><Button className="send-button" disabled={!query.trim()} onClick={() => onPhaseGate('F8', 'Copilot answer generation')}><ArrowUpRight size={16} /></Button></div><div className="suggested-prompts"><Button onClick={() => setQuery('Which products are at stockout risk?')}>Stockout risk</Button><Button onClick={() => setQuery('What changed in revenue?')}>Revenue change</Button></div></div></section><aside className="card copilot-sidebar"><CardHeading kicker="Thread history" dot="blue" title="No questions yet" /><EmptySmall icon={MessageSquare} text="F8 threads are not created yet." /></aside></div></PageLayout> }

function ReportsPage({ onPhaseGate }: { onPhaseGate: (phase: string, capability: string) => void }) { return <PageLayout eyebrow="Reporting shell" title="Reports" description="Report vault and scheduling will only render closed-period PDFs from F8." actions={<Button className="button primary" onClick={() => onPhaseGate('F8', 'PDF report generation')}><Plus size={15} /> Generate report</Button>}><div className="report-banner"><span className="report-banner-icon"><FileBarChart size={22} /></span><div><div className="section-kicker">DETERMINISTIC PDF VAULT</div><h2>Reporting is not enabled yet.</h2><p>F8 will add closed periods, R2 storage, and idempotent delivery.</p></div><span className="phase-tag">AI</span></div><EmptyState icon={FileText} title="No reports generated" description="There are no placeholder PDFs in this vault. Generate reports after the F8 reporting package is implemented." action="View F8 boundary" onAction={() => onPhaseGate('F8', 'PDF report generation')} /></PageLayout> }

function ExportsPage({ context, onToast, onNavigateBilling }: { context: WorkspaceContext; onToast: (message: string, kind?: ToastKind) => void; onNavigateBilling: () => void }) {
  return <PageLayout
    eyebrow={<><Download size={13} /> Data exports</>}
    title="Data Exports"
    description="Download your real store data anytime. Your data belongs to you — export orders, products, revenue, and activity logs in CSV, XLSX, or PDF format."
  >
    <ExportsWorkspace context={context} onToast={onToast} onNavigateBilling={onNavigateBilling} />
  </PageLayout>
}

const BILLING_FEATURE_MATRIX: readonly Readonly<{
  id: string
  label: string
  trial: string | boolean
  start: string | boolean
  growth: string | boolean
  commander: string | boolean
}>[] = [
  { id: 'stores', label: 'Shopify stores', trial: '1', start: '1', growth: '3', commander: 'Unlimited' },
  { id: 'orders_sync', label: 'Orders synced / month', trial: '250', start: '1,000', growth: '5,000', commander: 'Unlimited' },
  { id: 'products_sync', label: 'Products synced', trial: '250', start: '1,500', growth: '5,000', commander: 'Unlimited' },
  { id: 'customers_sync', label: 'Customers synced', trial: '250', start: '2,500', growth: '10,000', commander: 'Unlimited' },
  { id: 'ai_commands', label: 'AI Commands / day', trial: '10', start: '100', growth: '300', commander: 'Unlimited' },
  { id: 'automations', label: 'Automation workflows', trial: '2', start: '5', growth: '20', commander: 'Unlimited' },
  { id: 'recs', label: 'AI recommendations / mo', trial: '10', start: '150', growth: '300', commander: 'Unlimited' },
  { id: 'auto_execution', label: 'AI auto-execution', trial: false, start: false, growth: false, commander: true },
  { id: 'pricing_agent', label: 'Pricing Agent', trial: false, start: false, growth: true, commander: true },
  { id: 'product_exec', label: 'Product + Executive', trial: false, start: false, growth: false, commander: true },
]

const BILLING_AGENT_MATRIX: readonly Readonly<{ id: string; label: string; blurb: string; trial: boolean; start: boolean; growth: boolean; commander: boolean }>[] = [
  { id: 'REVENUE_AGENT', label: 'Revenue Agent', blurb: 'Sales momentum & drop alerts', trial: true, start: true, growth: true, commander: true },
  { id: 'INVENTORY_AGENT', label: 'Inventory Agent', blurb: 'Stockout & dead stock risks', trial: true, start: true, growth: true, commander: true },
  { id: 'CUSTOMER_AGENT', label: 'Customer Agent', blurb: 'Churn, win-back, recovery/welcome', trial: false, start: true, growth: true, commander: true },
  { id: 'PRICING_AGENT', label: 'Pricing Agent', blurb: 'Margin-safe price tests', trial: false, start: false, growth: true, commander: true },
  { id: 'PRODUCT_AGENT', label: 'Product Agent', blurb: 'Cross-sell pairings', trial: false, start: false, growth: false, commander: true },
  { id: 'EXECUTIVE_AGENT', label: 'Executive Agent', blurb: 'Weekly plain-language health digest', trial: false, start: false, growth: false, commander: true },
]

const BILLING_FAQ: readonly Readonly<{ q: string; a: string }>[] = [
  { q: 'How does the 14-day free trial work?', a: 'Every new store starts on a 14-day Free Trial with Revenue and Inventory agents unlocked. No credit card is required. When the trial ends, basic analytics stay available until you choose Start, Growth, or Commander.' },
  { q: 'What does “1 store” / “3 stores” mean?', a: 'Store limit is how many of your Shopify stores you can connect under one subscription. Each merchant gets their own install. Start includes 1 store, Growth up to 3, and Commander is unlimited.' },
  { q: 'What does "Unlimited" mean on Commander?', a: `Commander is marketed as unlimited on stores, sync volume, AI commands, automations, and reports so the biggest merchants do not have to count quotas. Behind the scenes we apply a Fair Usage Policy per store so we can warn (and, in extreme cases, throttle) abusive workloads before they impact other merchants: more than ${FAIR_USE_ORDERS_30D.toLocaleString('en-US')} orders in any rolling 30 days, more than ${FAIR_USE_PRODUCTS_ACTIVE.toLocaleString('en-US')} active products, or more than ${FAIR_USE_CUSTOMERS.toLocaleString('en-US')} customers. Normal high-volume stores never hit these — the soft cap exists only to flag truly unusual usage, not to bill you extra. You will see a "High volume — fair use applies" note on the affected meter if you approach the limit.` },
  { q: 'Can I cancel or change plan anytime?', a: 'Yes. You can upgrade, downgrade, or cancel at any time. Changes take effect at the end of the current billing period. Suspended stores keep read-only access to billing and support.' },
  { q: 'How do gift/promo codes work?', a: 'A promo code grants temporary Commander-level access (typically 3 days). Each store can redeem one code. Redemption replaces the free trial for that store.' },
  { q: 'Are payments secure?', a: 'Yes. Paid subscriptions are billed securely through Shopify. ProfitPilot never stores your card details — Shopify handles checkout, invoices, and PCI compliance.' },
  { q: 'What do I get when I upgrade from Trial → Start/Growth/Commander?', a: 'Start unlocks Customer Agent, 100 AI Commands/day, and 5 automations. Growth adds Pricing Agent, 3 stores, 300 commands/day, and 20 automations. Commander unlocks all 6 agents, unlimited stores and commands, and auto-execution so AI can take store actions for you. Recovery and welcome run under Customer Agent.' },
]

const USAGE_FEATURE_LABELS: Readonly<Record<string, string>> = {
  orders_sync_month: 'Orders synced / month',
  products_sync: 'Products synced',
  customers_sync: 'Customers synced',
  ai_recommendations_month: 'AI recommendations / month',
  active_agents: 'AI agents available',
  jarvis_messages_month: 'Jarvis messages / month',
  automation_workflows: 'Automation workflows',
  email_sends_month: 'Email sends / month',
  team_members: 'Team members',
  reports: 'Reports',
  exports: 'Data exports',
  forecasting: 'Forecasting',
  attribution: 'Attribution',
  ai_command_daily: 'AI Command / day',
}

/** Per-meter fair-use threshold (Commander only). Returns `true` if the
 *  current count is past the soft cap and we should surface the
 *  "High volume — fair use applies" hint. Kept in lock-step with the
 *  FAIR_USE_* constants in `@profitpilot/types`; if you add a new key here,
 *  add a constant there. */
const FAIR_USE_THRESHOLDS: Readonly<Record<string, { softCap: number; window: 'instant' | 'rolling-30d' | 'month' }>> = {
  orders_sync_month: { softCap: FAIR_USE_ORDERS_30D, window: 'rolling-30d' },
  products_sync: { softCap: FAIR_USE_PRODUCTS_ACTIVE, window: 'instant' },
  customers_sync: { softCap: FAIR_USE_CUSTOMERS, window: 'instant' },
}

function humanizeBillingStatus(account: import('./model.js').BillingAccount | null): Readonly<{ label: string; tone: 'green' | 'amber' | 'purple' | 'neutral'; planName: string }> {
  const sub = account?.subscription
  if (sub) {
    const planName = sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1)
    if (sub.state === 'GIFT_ACCESS_UNLIMITED') return { label: 'Gift Access', tone: 'purple', planName: 'Commander' }
    if (sub.state.startsWith('ACTIVE')) return { label: 'Active', tone: 'green', planName }
    if (sub.state === 'TRIAL_LIMITED') return { label: 'Free Trial', tone: 'amber', planName: 'Trial' }
    if (sub.state === 'SUSPENDED' || sub.state === 'PAST_DUE') return { label: 'Attention needed', tone: 'amber', planName }
    if (sub.state === 'CANCELLED') return { label: 'Cancelled', tone: 'neutral', planName }
    return { label: sub.state.replaceAll('_', ' '), tone: 'neutral', planName }
  }
  if (account?.trial?.state === 'ACTIVE') return { label: 'Free Trial', tone: 'amber', planName: 'Trial' }
  if (account?.trial?.state === 'EXPIRED') return { label: 'Trial ended', tone: 'neutral', planName: 'Trial' }
  if (account?.gift) return { label: 'Gift Access', tone: 'purple', planName: 'Commander' }
  return { label: 'No plan', tone: 'neutral', planName: 'None' }
}

function usageTone(percent: number): 'green' | 'yellow' | 'red' {
  if (percent >= 80) return 'red'
  if (percent >= 60) return 'yellow'
  return 'green'
}

/**
 * Renders a single entitlement meter. Pulled out of the BillingPage so the
 * three cases (limited cap, unlimited, capacity-style "X of Y") each have
 * one honest rendering and never fall back to `0 / 0` or `Infinity`.
 *
 * - `limit === null` → unlimited. Show `used · Unlimited` and a neutral
 *   thin bar (never a red bar, even at 1000+).
 * - `feature === 'active_agents'` → capacity chip ("3 of 3 agents available"),
 *   no progress bar, "Included" badge when `used === limit`.
 * - Otherwise limited cap with green/amber/red bar.
 */
export function UsageMeterRow({ meter, plan }: { meter: import('./model.js').UsageMeter; plan: 'trial' | 'start' | 'growth' | 'commander' | null }) {
  const label = USAGE_FEATURE_LABELS[meter.feature] ?? meter.feature.replaceAll('_', ' ')
  const isCapacity = meter.feature === 'active_agents'
  const isUnlimited = meter.limit === null
  const safeUsed = Number.isFinite(meter.used) ? Math.max(0, meter.used) : 0
  // Fair-use flag (Commander only — never alarms on trial/start/growth).
  const fairUse = isUnlimited && plan === 'commander' ? FAIR_USE_THRESHOLDS[meter.feature] : undefined
  const fairUseTriggered = fairUse !== undefined && safeUsed > fairUse.softCap

  if (isCapacity) {
    const limit = meter.limit ?? safeUsed
    const included = limit > 0 && safeUsed >= limit
    return (
      <div className="billing-usage-meter tone-green">
        <div className="billing-usage-meter-top">
          <span>{label}</span>
          <strong>{limit > 0 ? `${safeUsed} of ${limit} included` : `${safeUsed} included`}</strong>
        </div>
        {included && <span className="billing-usage-chip">Included</span>}
        {!included && limit > 0 && <span className="billing-usage-chip subtle">Included with {labelForPlan(plan)}</span>}
      </div>
    )
  }

  // Progress bar width — never NaN/Infinity. Unlimited gets a thin neutral
  // pulse proportional to usage (capped at 12%) so it never feels empty.
  const percent = !isUnlimited && meter.limit && meter.limit > 0 ? Math.min(100, Math.max(0, (safeUsed / meter.limit) * 100)) : 0
  const tone = isUnlimited ? 'green' : usageTone(percent)
  const limitText = isUnlimited ? `${safeUsed} · Unlimited` : `${safeUsed} / ${meter.limit}`
  const barWidth = isUnlimited ? Math.min(12, safeUsed > 0 ? Math.min(12, Math.log10(Math.max(1, safeUsed)) * 4) : 0) : percent
  return (
    <div className={`billing-usage-meter tone-${tone}`}>
      <div className="billing-usage-meter-top">
        <span>{label}</span>
        <strong>{limitText}</strong>
      </div>
      <div className="billing-usage-bar" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={isUnlimited ? undefined : 100} aria-valuetext={limitText}>
        <span style={{ width: `${Number.isFinite(barWidth) ? barWidth : 0}%` }} />
      </div>
      {fairUseTriggered && (
        <small className="billing-usage-fair-use">
          <Info size={11} aria-hidden /> High volume — fair use applies
        </small>
      )}
      {!isUnlimited && percent >= 100 && (
        <Button type="button" className="billing-upgrade-link" onClick={() => document.querySelector('.billing-plans-section')?.scrollIntoView({ behavior: 'smooth' })}>Upgrade for higher limits</Button>
      )}
    </div>
  )
}

/** Plan name used in the "Included with Start" chip on the agents meter. */
function labelForPlan(plan: 'trial' | 'start' | 'growth' | 'commander' | null): string {
  if (plan === 'commander') return 'Commander'
  if (plan === 'growth') return 'Growth'
  if (plan === 'start') return 'Start'
  return 'your plan'
}

/** Filter a list of usage meters down to the ones the Billing UI should
 *  actually render — drops dead/unproductized features (SMS, campaigns,
 *  Jarvis) so we never show a fake `0 / 0` row. */
export function visibleMeters(meters: readonly import('./model.js').UsageMeter[]): readonly import('./model.js').UsageMeter[] {
  return meters.filter((meter) => !HIDDEN_METER_KEYS.has(meter.feature))
}

function BillingPage({ context, onPhaseGate: _onPhaseGate, onToast }: { context: WorkspaceContext; onPhaseGate: (phase: string, capability: string) => void; onToast: (message: string, kind?: ToastKind) => void }) {
  const [plans, setPlans] = useState<readonly import('./model.js').BillingPlan[]>([])
  const [account, setAccount] = useState<import('./model.js').BillingAccount | null>(null)
  const [usage, setUsage] = useState<readonly import('./model.js').UsageMeter[]>([])
  const [roi, setRoi] = useState<import('./model.js').RoiMetrics | null>(null)
  const [giftCode, setGiftCode] = useState('')
  const [giftLoading, setGiftLoading] = useState(false)
  const [upgradeLoading, setUpgradeLoading] = useState<string | null>(null)
  const [billingInterval, setBillingInterval] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY')
  const [roiPeriod, setRoiPeriod] = useState<'this_month' | 'last_month' | 'all_time'>('this_month')
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [loading, setLoading] = useState(false)
  // Phase 2 developer reminder — never rendered for regular merchants.
  const devWorkspace = isDeveloperWorkspace(context)
  const [devNoteDismissed, setDevNoteDismissed] = useState(() => { try { return window.localStorage.getItem('pp-billing-phase2-note-dismissed') === '1' } catch { return false } })
  const dismissDevNote = () => { setDevNoteDismissed(true); try { window.localStorage.setItem('pp-billing-phase2-note-dismissed', '1') } catch { /* storage unavailable — dismiss for this session only */ } }

  const reload = async () => {
    if (!context.storeId) return
    setLoading(true)
    try {
      const [billing, meter, returnOnAi] = await Promise.allSettled([fetchBilling(context.storeId), fetchBillingUsage(context.storeId), fetchBillingRoi(context.storeId)])
      if (billing.status === 'fulfilled') setAccount(billing.value)
      if (meter.status === 'fulfilled') setUsage(meter.value)
      if (returnOnAi.status === 'fulfilled') setRoi(returnOnAi.value)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchBillingPlans().then(setPlans).catch(() => setPlans([]))
    void reload()
    const onBillingUpdated = () => { void reload() }
    window.addEventListener('profitpilot:billing-updated', onBillingUpdated)
    return () => window.removeEventListener('profitpilot:billing-updated', onBillingUpdated)
  }, [context.storeId])

  const status = humanizeBillingStatus(account)
  const trialDaysTotal = account?.trialDays ?? 14
  const trialDaysLeft = account?.trial?.expiresAt
    ? Math.max(0, Math.ceil((account.trial.expiresAt - Date.now()) / 86_400_000))
    : null
  const trialProgress = trialDaysLeft !== null
    ? Math.min(100, Math.max(0, ((trialDaysTotal - trialDaysLeft) / trialDaysTotal) * 100))
    : 0
  const activeTier: 'trial' | 'start' | 'growth' | 'commander' | null = (() => {
    const subPlan = account?.subscription?.plan?.toLowerCase()
    if (subPlan === 'start' || subPlan === 'growth' || subPlan === 'commander') return subPlan
    if (account?.trial?.state === 'ACTIVE') return 'trial'
    return null
  })()
  const isGift = account?.subscription?.state === 'GIFT_ACCESS_UNLIMITED' || Boolean(account?.gift)

  const startCharge = async (plan: 'START' | 'GROWTH' | 'COMMANDER') => {
    if (!context.storeId) { onToast('Connect Shopify before choosing a plan.', 'info'); return }
    if (activeTier === plan.toLowerCase() && !isGift) return
    setUpgradeLoading(plan)
    try {
      const charge = await createBillingCharge(context.storeId, plan, billingInterval, `${window.location.origin}/billing`)
      if (charge.confirmationUrl) {
        window.location.assign(charge.confirmationUrl)
        return
      }
      onToast(charge.message ?? `Upgraded to ${plan.charAt(0) + plan.slice(1).toLowerCase()}. Billed securely through Shopify when you upgrade.`, 'success')
      await reload()
      const tier = plan.toLowerCase() as Exclude<PlanTier, 'trial'>
      setUsage((current) => {
        const meters = current.length > 0 ? current : Object.keys(USAGE_FEATURE_LABELS).filter((feature) => !HIDDEN_METER_KEYS.has(feature)).map((feature) => ({ feature, used: 0, limit: null as number | null }))
        return meters.map((meter) => {
          const key = meter.feature as EntitlementKey
          const nextLimit = key in PLAN_ENTITLEMENT_LIMITS[tier] ? PLAN_ENTITLEMENT_LIMITS[tier][key] : meter.limit
          return { ...meter, limit: nextLimit }
        })
      })
    } catch (error: unknown) {
      onToast(errorMessage(error), 'error')
    } finally {
      setUpgradeLoading(null)
    }
  }

  const redeem = async () => {
    if (!context.storeId || !giftCode.trim()) return
    setGiftLoading(true)
    try {
      await redeemGiftCode(context.storeId, giftCode)
      onToast('Gift access redeemed — Commander unlocked for a limited time.', 'success')
      setGiftCode('')
      await reload()
    } catch (error: unknown) {
      const raw = errorMessage(error)
      const friendly = /already redeemed/i.test(raw)
        ? 'This store has already redeemed a promo code.'
        : /expired|exhausted|invalid/i.test(raw)
          ? 'That promo code is invalid or no longer available.'
          : /disabled/i.test(raw)
            ? 'Promo codes are temporarily unavailable.'
            : 'We could not redeem that code. Please try again.'
      onToast(friendly, 'error')
    } finally {
      setGiftLoading(false)
    }
  }

  const displayPlans = plans.length > 0 ? plans : ([
    { code: 'START' as const, tier: 'start' as const, monthlyPrice: 79, annualPrice: 790, annualMonthsFree: 2, headline: 'AI clarity for your Shopify store', features: ['1 Shopify store connected', '3 AI agents: Revenue, Inventory, Customer', '100 AI Commands / day', '1,000 orders synced / month', '1,500 products synced', '2,500 customers synced', 'Customer insights, churn and win-back signals', 'Cart recovery and welcome flows via Customer Agent', '5 automation workflows', '150 AI recommendations / month', 'Closed-period reports and basic exports', 'Email support'], limits: {} },
    { code: 'GROWTH' as const, tier: 'growth' as const, monthlyPrice: 199, annualPrice: 1990, annualMonthsFree: 2, recommended: true, headline: 'Scale decisions across products, pricing & automations', features: ['Up to 3 Shopify stores', '4 AI agents — includes Pricing Agent', '300 AI Commands / day', '5,000 orders synced / month', '5,000 products synced', '10,000 customers synced', '20 automation workflows', 'Advanced analytics plus forecasting and ROI attribution', '300 AI recommendations / month', 'Margin-safe pricing opportunities (Pricing Agent)', 'Priority support with a 12-hour target'], limits: {} },
    { code: 'COMMANDER' as const, tier: 'commander' as const, monthlyPrice: 399, annualPrice: 3990, annualMonthsFree: 2, headline: 'Full AI employee — insights plus actions', features: ['Unlimited Shopify stores', 'All 6 AI agents (Product + Executive unlocked)', 'Unlimited AI Commands', 'Auto-execution: AI can take store actions for you', 'Unlimited automation workflows', 'Unlimited orders, products, and customers synced*', 'Product Agent cross-sell + Executive weekly digest', 'Unlimited AI recommendations', 'Advanced forecasting, attribution, and exports', 'VIP priority support with a 4-hour target', '*Fair use applies — see FAQ'], limits: {} },
  ])

  return (
    <PageLayout
      eyebrow="Plans and usage"
      title="Billing"
      description="Manage your plan, monitor usage, and track AI-attributed return — all grounded in real subscription data."
      actions={
        <Button className="button secondary" disabled={loading} onClick={() => context.storeId ? void reload() : onToast('Connect Shopify from Settings.', 'info')}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> {context.storeId ? (loading ? 'Refreshing…' : 'Refresh billing') : 'Connect Shopify'}
        </Button>
      }
    >
      {devWorkspace && !devNoteDismissed && (
        <div className="billing-dev-note" role="note">
          <AlertTriangle size={14} aria-hidden />
          <span><strong>DEV NOTE:</strong> Billing is currently in mock mode. Phase 2 (Real Shopify Checkout) is pending.</span>
          <Button type="button" onClick={dismissDevNote} aria-label="Dismiss developer note"><X size={13} /></Button>
        </div>
      )}
      {!context.storeId ? (
        <EmptyState icon={WalletCards} title="Connect Shopify to view billing" description="Billing never assumes a plan. Complete the signed install flow to load a real subscription." action="Connect from Settings" onAction={() => onToast('Open the Shopify install flow from the workspace context.', 'info')} />
      ) : (
        <div className="billing-v2">
          {/* ── 3.1 Hero ─────────────────────────────────────────────── */}
          <section className="billing-hero card">
            <div className="billing-hero-main">
              <div className="billing-hero-icon"><WalletCards size={22} /></div>
              <div className="billing-hero-copy">
                <div className="section-kicker">CURRENT PLAN</div>
                <div className="billing-hero-title-row">
                  <h2>{status.planName}</h2>
                  <span className={`billing-status-badge ${status.tone}`}>{status.label}</span>
                </div>
                <p>
                  {account?.subscription?.currentPeriodEnd
                    ? `Current period ends ${new Date(account.subscription.currentPeriodEnd).toLocaleDateString()}.`
                    : account?.trial?.expiresAt
                      ? `Trial ends ${new Date(account.trial.expiresAt).toLocaleDateString()}. Basic analytics stay available until you choose a plan.`
                      : account?.gift
                        ? `Gift access expires ${new Date(account.gift.expiresAt).toLocaleDateString()}.`
                        : 'Start a plan or redeem a gift code when you are ready.'}
                </p>
                {account?.trial?.state === 'ACTIVE' && trialDaysLeft !== null && (
                  <div className="billing-trial-progress">
                    <div className="billing-trial-progress-meta">
                      <span>Free trial progress</span>
                      <strong>{trialDaysLeft} of {trialDaysTotal} days remaining</strong>
                    </div>
                    <div className="billing-trial-track" role="progressbar" aria-valuenow={trialDaysLeft} aria-valuemin={0} aria-valuemax={trialDaysTotal}>
                      <span style={{ width: `${100 - trialProgress}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="billing-interval-toggle" role="group" aria-label="Billing interval">
              <Button type="button" className={billingInterval === 'MONTHLY' ? 'active' : ''} onClick={() => setBillingInterval('MONTHLY')}>Monthly</Button>
              <Button type="button" className={billingInterval === 'ANNUAL' ? 'active' : ''} onClick={() => setBillingInterval('ANNUAL')}>
                Annual <span className="billing-save-badge">2 Months Free</span>
              </Button>
            </div>
          </section>

          {/* ── 3.2 Plan cards ───────────────────────────────────────── */}
          <section className="billing-plans-section">
            <div className="billing-section-head">
              <div className="section-kicker"><span className="kicker-dot purple" /> AVAILABLE PLANS</div>
              <h2>Choose the level of autonomy you need.</h2>
              <p>Upgrade anytime. Billed securely through Shopify when you upgrade.</p>
              <p className="billing-store-helper">Store limit = how many of your Shopify stores you can connect under one subscription. Each merchant gets their own install.</p>
            </div>
            <div className="billing-plan-grid">
              {displayPlans.map((plan) => {
                const isCurrent = activeTier === plan.tier && !isGift
                const price = billingInterval === 'ANNUAL' ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice
                const annualSave = plan.monthlyPrice * 12 - plan.annualPrice
                const features = (plan.features ?? []).filter((feature) => !feature.toLowerCase().includes('jarvis') && !feature.toLowerCase().includes('campaign'))
                return (
                  <article key={plan.code} className={`billing-plan-card ${plan.recommended ? 'recommended' : ''} ${isCurrent ? 'current' : ''}`}>
                    {plan.recommended && <span className="billing-plan-ribbon">Recommended</span>}
                    {isCurrent && <span className="billing-plan-current-tag">Current plan</span>}
                    <header className={`billing-plan-card-head tone-${plan.tier}`}>
                      <h3>{plan.code.charAt(0) + plan.code.slice(1).toLowerCase()}</h3>
                      <p>{plan.headline}</p>
                    </header>
                    <div className="billing-plan-price">
                      <strong>${price}</strong>
                      <span>/mo{billingInterval === 'ANNUAL' ? ' billed annually' : ''}</span>
                    </div>
                    {billingInterval === 'ANNUAL' && (
                      <div className="billing-plan-annual-note">${plan.annualPrice.toLocaleString('en-US')}/year · save ${annualSave.toLocaleString('en-US')}/yr</div>
                    )}
                    <ul className="billing-plan-features">
                      {features.map((feature) => (
                        <li key={feature}><Check size={14} strokeWidth={2.5} />{feature}</li>
                      ))}
                    </ul>
                    <Button
                      className={`button ${isCurrent ? 'secondary' : 'primary'} billing-plan-cta`}
                      disabled={isCurrent || upgradeLoading === plan.code}
                      onClick={() => void startCharge(plan.code)}
                    >
                      {isCurrent ? 'Current plan' : upgradeLoading === plan.code ? 'Updating…' : 'Choose plan'}
                      {!isCurrent && <ArrowUpRight size={14} />}
                    </Button>
                    <p className="billing-trust-line">Prices in USD. Applicable taxes appear on your Shopify bill.</p>
                  </article>
                )
              })}
            </div>
          </section>

          {/* ── 3.3 AI Agents Matrix ─────────────────────────────────── */}
          <section className="card billing-matrix">
            <div className="billing-section-head inline">
              <div>
                <div className="section-kicker"><span className="kicker-dot blue" /> FEATURES & AGENTS</div>
                <h3>What each plan unlocks</h3>
                <p>Trial includes 2 agents, Start 3, Growth 4, Commander 6. Recovery and welcome run under Customer Agent.</p>
              </div>
            </div>
            <div className="billing-matrix-table-wrap">
              <table className="billing-matrix-table">
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    <th scope="col">Trial</th>
                    <th scope="col">Start</th>
                    <th scope="col">Growth</th>
                    <th scope="col">Commander</th>
                  </tr>
                </thead>
                <tbody>
                  {BILLING_FEATURE_MATRIX.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">{row.label}</th>
                      <td><BillingCell value={row.trial} /></td>
                      <td><BillingCell value={row.start} /></td>
                      <td><BillingCell value={row.growth} /></td>
                      <td><BillingCell value={row.commander} /></td>
                    </tr>
                  ))}
                  {BILLING_AGENT_MATRIX.map((agent) => (
                    <tr key={agent.id}>
                      <th scope="row">
                        <span className="billing-agent-name">{agent.label}</span>
                        <small className="billing-agent-blurb">{agent.blurb}</small>
                      </th>
                      <td><BillingCheck ok={agent.trial} /></td>
                      <td><BillingCheck ok={agent.start} /></td>
                      <td><BillingCheck ok={agent.growth} /></td>
                      <td><BillingCheck ok={agent.commander} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 3.4 + 3.5 Usage + ROI ────────────────────────────────── */}
          <div className="billing-split">
            <section className="card billing-usage">
              <div className="billing-section-head inline">
                <div>
                  <div className="section-kicker"><span className="kicker-dot blue" /> USAGE</div>
                  <h3>Entitlement meters</h3>
                  <p>Every metered feature for your current period — even at zero.</p>
                </div>
              </div>
              <div className="billing-usage-grid">
                {visibleMeters(usage.length ? usage : Object.keys(USAGE_FEATURE_LABELS).map((feature) => ({ feature, used: 0, limit: null as number | null }))).map((meter) => (
                  <UsageMeterRow key={meter.feature} meter={meter} plan={activeTier} />
                ))}
              </div>
            </section>

            <section className="card billing-roi">
              <div className="billing-section-head inline">
                <div>
                  <div className="section-kicker"><span className="kicker-dot gold" /> RETURN ON AI</div>
                  <h3>Verified attribution</h3>
                </div>
                <label className="billing-roi-period">
                  <span className="sr-only">Period</span>
                  <select value={roiPeriod} onChange={(event) => setRoiPeriod(event.target.value as typeof roiPeriod)}>
                    <option value="this_month">This Month</option>
                    <option value="last_month">Last Month</option>
                    <option value="all_time">All Time</option>
                  </select>
                </label>
              </div>
              <p className="billing-roi-help">
                Revenue tied to an approved ProfitPilot action. $0 means no attributed outcomes yet — not a billing error.
                <Button type="button" className="billing-tooltip-trigger" title="Attribution credits revenue only when a merchant-approved recommendation can be linked to a later order or recovery. Unapproved insights never inflate ROI.">
                  <Info size={13} /> How attribution works
                </Button>
              </p>
              {roi ? (
                <div className="billing-roi-live">
                  <strong>{formatMoney(roi.attributedRevenue)}</strong>
                  <span>AI-attributed revenue · {roiPeriod === 'this_month' ? 'This month' : roiPeriod === 'last_month' ? 'Last month' : 'All time'}</span>
                  <div className="billing-roi-breakdown">
                    <MetricLine label="AI operational cost" value={formatMoney(roi.aiCostDollars)} />
                    <MetricLine label="Net return" value={formatMoney(roi.netReturn)} />
                    <MetricLine label="Multiple" value={roi.multiple === null ? '—' : `${roi.multiple.toFixed(1)}×`} />
                  </div>
                </div>
              ) : (
                <EmptySmall icon={Sparkles} text="No attributed outcomes yet." />
              )}
            </section>
          </div>

          {/* ── 3.6 Gift Access ──────────────────────────────────────── */}
          <section className="card billing-gift">
            <div className="billing-gift-icon"><Gift size={22} /></div>
            <div className="billing-gift-copy">
              <div className="section-kicker">GIFT ACCESS</div>
              <h3>Have a gift code?</h3>
              <p>Redeem once per store for temporary Commander access. Replaces the free trial.</p>
            </div>
            <div className="billing-gift-form">
              <input
                value={giftCode}
                onChange={(event) => setGiftCode(event.target.value.toUpperCase())}
                placeholder="e.g. VIP2026"
                aria-label="Gift code"
                disabled={giftLoading}
              />
              <Button className="button primary billing-gift-redeem" onClick={() => void redeem()} disabled={!giftCode.trim() || giftLoading}>
                {giftLoading ? <RefreshCw size={14} className="spin" /> : <Gift size={14} />}
                {giftLoading ? 'Redeeming…' : 'Redeem'}
              </Button>
            </div>
          </section>

          {/* ── 3.7 FAQ ──────────────────────────────────────────────── */}
          <section className="card billing-faq">
            <div className="billing-section-head">
              <div className="section-kicker"><span className="kicker-dot purple" /> FAQ</div>
              <h3>Common questions</h3>
            </div>
            <div className="billing-faq-list">
              {BILLING_FAQ.map((item, index) => {
                const open = openFaq === index
                return (
                  <div key={item.q} className={`billing-faq-item ${open ? 'open' : ''}`}>
                    <Button type="button" className="billing-faq-q" aria-expanded={open} onClick={() => setOpenFaq(open ? null : index)}>
                      <span>{item.q}</span>
                      <ChevronDown size={16} />
                    </Button>
                    {open && <div className="billing-faq-a"><p>{item.a}</p></div>}
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}
    </PageLayout>
  )
}

function BillingCheck({ ok }: { ok: boolean }) {
  return ok
    ? <span className="billing-check ok" aria-label="Included"><Check size={15} strokeWidth={2.75} /></span>
    : <span className="billing-check no" aria-label="Not included"><X size={14} strokeWidth={2.5} /></span>
}

function BillingCell({ value }: { value: string | boolean }) {
  if (typeof value === 'boolean') return <BillingCheck ok={value} />
  return <span className="billing-matrix-text">{value}</span>
}

function PageLayout({ eyebrow, title, description, actions, children }: { eyebrow: ReactNode; title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Page title={title} subtitle={description}>
      <AppTitleBar title={title} />
      {actions ? <div className="page-actions">{actions}</div> : null}
      {children}
    </Page>
  )
}

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
  return <div className="revenue-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Revenue trend"><defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="rgb(59, 130, 246)" stopOpacity=".3" /><stop offset="100%" stopColor="rgb(59, 130, 246)" stopOpacity="0" /></linearGradient></defs>{[16, 40, 64, 88].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} className="chart-grid-line" />)}<polygon points={`0,100 ${line} 100,100`} fill="url(#areaFill)" /><polyline points={line} fill="none" stroke="rgb(89, 148, 255)" strokeWidth="1.7" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />{coords.map((coord, index) => <circle key={coord.point.day} cx={coord.x} cy={coord.y} r={hover === index ? 1.8 : 1.1} fill="rgb(147, 197, 253)" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} />)}</svg><div className="chart-y-labels"><span>{formatMoney(max)}</span><span>{formatMoney((max + min) / 2)}</span><span>{formatMoney(min)}</span></div><div className="chart-x-labels"><span>{points[0]?.day ?? ''}</span><span>{points[points.length - 1]?.day ?? ''}</span></div>{active && <div className="chart-tooltip" style={{ left: `${Math.min(86, Math.max(8, active.x))}%` }}><strong>{formatMoney(active.point.value)}</strong><span>{active.point.day}</span></div>}</div>
}
function EmptyChart({ onSync }: { onSync: () => void }) { return <div className="empty-chart"><LineChart size={24} /><strong>No closed-period analytics yet</strong><span>Run a real sync to draw this chart.</span><Button className="text-button" onClick={onSync}><RefreshCw size={14} /> Sync data</Button></div> }
function EmptyState({ icon: _Icon, title, description, action, onAction }: { icon: SectionIcon; title: string; description: string; action: string; onAction: () => void }) {
  return <PolarisEmpty heading={title} description={description} action={action} onAction={onAction} />
}
function EmptySmall({ icon: Icon, text }: { icon: LucideIcon; text: string }) { return <div className="empty-small"><Icon size={18} /><span>{text}</span></div> }
function InsightItem({ icon: Icon, title, detail, tone }: { icon: LucideIcon; title: string; detail: string; tone: string }) { return <div className="insight-item"><span className={`insight-icon ${tone}`}><Icon size={16} /></span><span><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={15} /></div> }
function MetricLine({ label, value }: { label: string; value: string }) { return <div className="metric-line"><span>{label}</span><strong>{value}</strong></div> }
function Quota({ label, value, percent }: { label: string; value: string; percent: number }) { return <div className="quota"><div><span>{label}</span><strong>{value}</strong></div><div className="usage-track"><span style={{ width: `${percent}%` }} /></div></div> }
function ProfileMenu({ lightMode, onTheme, onClose, onSettings }: { lightMode: boolean; onTheme: () => void; onClose: () => void; onSettings: () => void }) { return <div className="profile-menu"><div className="profile-menu-head"><span className="profile-avatar large">PP</span><span><strong>ProfitPilot</strong><small>Foundation workspace</small></span></div><Button onClick={onSettings}><Settings size={15} /> Settings</Button><Button onClick={onTheme}>{lightMode ? <Sun size={15} /> : <Moon size={15} />} {lightMode ? 'Dark mode' : 'Light mode'}</Button><Button onClick={onClose}><LockKeyhole size={15} /> Security boundary</Button></div> }
function OfflineBanner({ error, partial = false, onRetry }: { error: string | null; partial?: boolean; onRetry: () => void }) { return <div className="offline-banner"><CloudOff size={16} /><span><strong>{partial ? 'Partial data load' : 'API unavailable'}</strong>{error ? ` · ${error}` : ' · Showing empty states, never demo data.'}</span><Button onClick={onRetry}><RotateCcw size={14} /> Retry</Button></div> }
function ContextBanner({ onConnect }: { onConnect: () => void }) { return <div className="context-banner"><span className="context-banner-icon"><Server size={16} /></span><span><strong>ProfitPilot is not connected to a Shopify store yet.</strong> Install it from the Shopify App Store or connect a store to start syncing real data.</span><Button onClick={onConnect}>Connect a store <ArrowUpRight size={13} /></Button></div> }

/**
 * HOTFIX 2: the single session-expired surface. Rendered as one Polaris
 * critical banner (never stacked toasts) when the Shopify admin can no longer
 * mint a session token or the API answers 401.
 */
function SessionExpiredBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <Banner tone="critical" title="Session expired" onDismiss={onDismiss}>
      <p>{message}</p>
      <Button onClick={() => window.location.reload()}>Reload the app</Button>
    </Banner>
  )
}

/** Installed merchant (shop known) whose tenant row hasn't resolved yet. */
function ContextPendingBanner({ shop }: { shop: string }) {
  return <div className="context-banner"><span className="context-banner-icon"><Server size={16} /></span><span><strong>Restoring your store context…</strong> {shop} is installed — reloading the app restores it.</span><Button onClick={() => window.location.reload()}>Reload the app <RotateCcw size={13} /></Button></div>
}

/** Bootstrap fetch failed transiently: retry, never "install from scratch". */
function ContextLoadErrorBanner({ onRetry }: { onRetry: () => void }) {
  return <div className="context-banner"><span className="context-banner-icon"><CloudOff size={16} /></span><span><strong>Could not load your store context.</strong> Your data is safe — retry once your connection is back.</span><Button onClick={onRetry}><RotateCcw size={14} /> Retry</Button></div>
}
function EvidenceDrawer({ recommendation, jarvisEvidence, onClose }: { recommendation: Recommendation | null; jarvisEvidence: JarvisEvidence | null; onClose: () => void }) {
  const hash = recommendation && typeof recommendation.evidencePack.sha256 === 'string' ? recommendation.evidencePack.sha256 : null
  const evidence = jarvisEvidence
  return <><Button className="drawer-backdrop" onClick={onClose} aria-label="Close evidence drawer" /><aside className="evidence-drawer"><div className="drawer-header"><div><span className="drawer-kicker"><Database size={13} /> {evidence ? 'JARVIS GROUNDED EVIDENCE' : 'IMMUTABLE EVIDENCE PACK'}</span><h2>{evidence ? 'Review before action' : recommendation ? recommendation.title : 'No evidence yet'}</h2></div><Button className="icon-button" onClick={onClose}><X size={18} /></Button></div><div className="drawer-scroll">{evidence ? <><div className="drawer-hero"><span>{evidence.page} · {evidence.confidenceLevel} confidence</span><strong>{evidence.suggestedAction?.label ?? 'Evidence only'}</strong><small>Generated from real tenant data · {evidence.generatedAt}</small></div><div className="drawer-section"><div className="drawer-section-title"><ShieldCheck size={15} /> Facts and sources</div><div className="evidence-stack">{evidence.facts.map((fact, index) => <div className="evidence-line" key={fact.key}><span>{String(index + 1).padStart(2, '0')}</span><strong>{fact.label}: {String(fact.value ?? '—')}</strong><small>{fact.source}</small><CheckCircle2 size={15} /></div>)}</div></div><div className="drawer-section"><div className="drawer-section-title"><LockKeyhole size={15} /> Action safety</div><div className="safety-list"><span><Check size={14} /> AI sees language-safe evidence only</span><span><Check size={14} /> Risky actions require explicit confirmation</span><span><Check size={14} /> Merchant-owned draft/sender checks remain enforced</span></div></div></> : recommendation ? <><div className="drawer-hero"><span>{recommendation.impactLabel}</span><strong>{formatMoney(recommendation.impactValue, recommendation.currency)}</strong><small>Deterministic rule output · {recommendation.ruleId}</small></div><div className="drawer-section"><div className="drawer-section-title"><ShieldCheck size={15} /> Proof and status</div><div className="evidence-stack"><div className="evidence-line"><span>01</span><strong>{recommendation.reason}</strong><CheckCircle2 size={15} /></div><div className="evidence-line"><span>02</span><strong>Confidence: {recommendation.confidenceLevel}</strong><CheckCircle2 size={15} /></div><div className="evidence-line"><span>03</span><strong className="mono">SHA-256: {hash ?? 'unavailable'}</strong><CheckCircle2 size={15} /></div></div></div><div className="drawer-section"><div className="drawer-section-title"><LockKeyhole size={15} /> Action safety</div><div className="safety-list"><span><Check size={14} /> {recommendation.actionRisk.replaceAll('_', ' ')} policy</span><span><Check size={14} /> CAS approval version {recommendation.version}</span><span><Check size={14} /> AI language: {recommendation.explanationStatus}</span></div></div></> : <div className="gated-panel"><LockKeyhole size={22} /><strong>No persisted evidence packs</strong><p>Run analysis after the store snapshot is available. The UI will never fabricate evidence.</p></div>}</div><div className="drawer-footer"><Button className="button secondary" onClick={onClose}>Close</Button></div></aside></>
}

function PassiveRecommendationCard({ recommendation, onReview, onDismiss, onSnooze }: { recommendation: Recommendation; onReview: () => void; onDismiss: () => void; onSnooze: () => void }) {
  return <aside className="passive-recommendation-card" aria-live="polite"><div className="passive-card-heading"><span className="passive-card-icon"><Sparkles size={15} /></span><span><small>JARVIS RECOMMENDATION</small><strong>{recommendation.title}</strong></span><Button onClick={onDismiss} aria-label="Dismiss recommendation"><X size={14} /></Button></div><p>{recommendation.reason}</p><div className="passive-card-meta"><span className={`status-badge ${recommendation.confidenceLevel === 'HIGH' ? 'green' : 'amber'}`}>{recommendation.confidenceLevel} confidence</span><span>Already in your recommendations</span></div><div className="passive-card-actions"><Button className="button primary" onClick={onReview}><Eye size={13} /> Review evidence</Button><Button className="button secondary" onClick={onSnooze}><Clock3 size={13} /> Snooze 1 hour</Button></div></aside>
}

/**
 * PR #46: the bell now shows real pending recommendations. "New" means a
 * PENDING recommendation whose id has not been marked read on this device;
 * opening the drawer and clicking a row (or "Mark all read") clears it.
 */
function NotificationDrawer({ recommendations, unreadIds, onOpenRecommendation, onMarkAllRead, onClose }: { recommendations: readonly Recommendation[]; unreadIds: ReadonlySet<string>; onOpenRecommendation: (id: string) => void; onMarkAllRead: () => void; onClose: () => void }) {
  const pending = recommendations.filter((item) => item.status === 'PENDING').slice(0, 10)
  const unreadCount = pending.filter((item) => unreadIds.has(item.id)).length
  return <><Button className="drawer-backdrop" onClick={onClose} aria-label="Close notifications" /><aside className="notification-drawer"><div className="drawer-header"><div><span className="drawer-kicker"><Bell size={13} /> NOTIFICATIONS</span><h2>{unreadCount > 0 ? `${unreadCount} new recommendation${unreadCount === 1 ? '' : 's'}` : pending.length > 0 ? 'Pending recommendations' : 'No new notifications'}</h2></div><Button className="icon-button" onClick={onClose}><X size={18} /></Button></div>{pending.length === 0 ? <div className="notification-empty"><Bell size={22} /><strong>Quiet by default</strong><span>New AI recommendations appear here the moment they are generated from your real store data.</span></div> : <div className="notification-list">{pending.map((item) => <Button key={item.id} className={`notification-row ${unreadIds.has(item.id) ? 'unread' : ''}`} onClick={() => onOpenRecommendation(item.id)}><span className="notification-row-icon"><Sparkles size={14} /></span><span className="notification-row-copy"><strong>{item.title}</strong><small>{formatMoney(item.impactValue, item.currency)} · pending your decision</small></span>{unreadIds.has(item.id) && <i className="notification-dot" />}</Button>)}{unreadCount > 0 && <Button className="text-button full" onClick={onMarkAllRead}>Mark all read <Check size={13} /></Button>}</div>}<Button className="text-button full" onClick={onClose}>Close drawer <X size={14} /></Button></aside></>
}
function CommandPalette({ devWorkspace, onClose, onNavigate }: { devWorkspace: boolean; onClose: () => void; onNavigate: (page: SectionId) => void }) { const [query, setQuery] = useState(''); const results = visibleNavGroups(devWorkspace).flatMap((group) => group.items).filter((item) => item.label.toLowerCase().includes(query.toLowerCase())).slice(0, 10); return <div className="command-overlay"><Button className="command-overlay-close" onClick={onClose} aria-label="Close command palette" /><div className="command-panel command-palette"><div className="command-input-wrap"><Search size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sections…" /><kbd>ESC</kbd></div><div className="command-results"><span className="command-section-label">Navigate</span>{results.map((item) => { const Icon = item.icon; return <Button key={item.id} className="command-result" onClick={() => onNavigate(item.id)}><span className="command-result-icon"><Icon size={16} /></span><span>{item.label}</span><ChevronRight size={15} /></Button> })}{results.length === 0 && <div className="command-empty"><Search size={20} /><strong>No matching section</strong><span>Try Dashboard, Analytics, or Settings.</span></div>}</div><div className="command-footer"><span><ArrowUpRight size={13} /> Open</span><span><ChevronDown size={13} /> Navigate</span><span><kbd>ESC</kbd> Close</span></div></div></div> }
function OnboardingModal({ onClose }: { onClose: () => void }) { const [shop, setShop] = useState(''); const [error, setError] = useState<string | null>(null); const connect = () => { const normalized = shop.trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) { setError('Enter a valid *.myshopify.com domain.'); return } window.location.assign(`/shopify/install?shop=${encodeURIComponent(normalized)}`) }; return <div className="modal-overlay"><div className="modal-card onboarding-modal"><div className="modal-icon"><ShoppingBag size={21} /></div><div className="section-kicker">SHOPIFY INSTALL</div><h2>Connect your real store</h2><p>ProfitPilot will start the signed OAuth flow. No demo workspace is created.</p><label>Shopify domain<input autoFocus value={shop} onChange={(event) => setShop(event.target.value)} placeholder="your-store.myshopify.com" /></label>{error && <div className="form-error"><AlertCircle size={14} />{error}</div>}<div className="modal-actions"><Button className="button secondary" onClick={onClose}>Cancel</Button><Button className="button primary" onClick={connect}>Continue to Shopify <ArrowUpRight size={14} /></Button></div></div></div> }
function ShortcutsModal({ onClose }: { onClose: () => void }) { return <div className="modal-overlay"><div className="modal-card shortcuts-modal"><div className="modal-card-top"><div><div className="section-kicker"><Keyboard size={13} /> KEYBOARD SHORTCUTS</div><h2>Move with intention.</h2></div><Button className="icon-button" onClick={onClose}><X size={18} /></Button></div><Shortcut keys="⌘ K" label="Open command palette" /><Shortcut keys="?" label="Open keyboard shortcuts" /><Shortcut keys="ESC" label="Close the active drawer or modal" /><Shortcut keys="⌘ /" label="Search the current section" /><Button className="button primary full-width" onClick={onClose}>Done</Button></div></div> }
function Shortcut({ keys, label }: { keys: string; label: string }) { return <div className="shortcut-row"><kbd>{keys}</kbd><span>{label}</span><Check size={14} /></div> }
function readStoredStringArray(key: string): readonly string[] { try { const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] } catch { return [] } }
function readStoredNumberRecord(key: string): Readonly<Record<string, number>> { try { const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}'); if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))) } catch { return {} } }
function storeStringArray(key: string, value: readonly string[]): void { try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* Storage may be disabled in a hardened embedded browser. */ } }
function storeNumberRecord(key: string, value: Readonly<Record<string, number>>): void { try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* Storage may be disabled in a hardened embedded browser. */ } }
/** True for the 503 the API returns while a store's Shopify circuit is open. */
function isCircuitOpen(error: unknown): boolean { return error instanceof ApiClientError && error.status === 503 && /circuit is open/i.test(error.message) }
function errorMessage(error: unknown): string { if (error instanceof ApiClientError) return error.message; if (error instanceof Error) return error.message; return 'The API could not be reached.' }
/** True when a pathname or hash points at GrowthIQ (new route or the
 * legacy "AI Executive" deep link kept for shared links and bookmarks). */
function isGrowthIqLocation(pathname: string, hash: string): boolean {
  return pathname.startsWith('/ai-growth-command/growthiq')
    || pathname.startsWith('/ai-growth-command/executive')
    || hash.startsWith('#/ai-growth-command/growthiq')
    || hash.startsWith('#/ai-growth-command/executive')
}

/** Resolves a deep-link hash to a workspace section id, or null. */
function hashSection(hash: string): 'recommendations' | 'ai-executive' | 'store-coach' | null {
  if (hash.startsWith('#/recommendations')) return 'recommendations'
  if (hash.startsWith('#/ai-growth-command/growthiq') || hash.startsWith('#/ai-growth-command/executive')) return 'ai-executive'
  if (hash.startsWith('#/ai-growth-command')) return 'store-coach'
  return null
}

function growthCommandPath(page: SectionId): string | null {
  if (page === 'patternai') return '/ai-growth-command/patternai'
  if (page === 'ai-executive') return '/ai-growth-command/growthiq'
  if (page === 'store-coach' || page === 'ai-growth-command') return '/ai-growth-command/coach'
  return null
}

const SECTION_PATHS: Readonly<Record<string, SectionId>> = {
  '/': 'dashboard',
  '/command': 'command-center',
  '/recommendations': 'recommendations',
  '/automation': 'automation',
  '/products': 'products',
  '/orders': 'orders',
  '/customers': 'customers',
  '/inventory': 'inventory',
  '/analytics': 'analytics',
  '/reports': 'reports',
  '/exports': 'exports',
  '/support': 'support',
  '/billing': 'billing',
  '/settings': 'settings',
  '/ai-command': 'ai-command',
}

function sectionFromPath(pathname: string): SectionId | null {
  const trimmed = pathname.replace(/\/+$/, '') || '/'
  if (SECTION_PATHS[trimmed]) return SECTION_PATHS[trimmed] ?? null
  if (trimmed.startsWith('/command')) return 'command-center'
  return null
}

function sectionPath(page: SectionId): string {
  const growth = growthCommandPath(page)
  if (growth) return growth
  const found = Object.entries(SECTION_PATHS).find(([, section]) => section === page)
  return found?.[0] ?? '/'
}

function isTypingTarget(target: EventTarget | null): boolean { return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement }
