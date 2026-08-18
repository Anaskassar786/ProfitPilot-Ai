import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleGauge,
  FileText,
  Filter,
  Grid2X2,
  List,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  WandSparkles,
  Workflow,
  X,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { WorkspaceContext } from './model.js'
import { archiveWorkflow, createAutomationWorkflow, getAutomationTemplates, getAutomationUsage, getWorkflow, installAutomationTemplate, workflowCommand } from './automation-api.js'
import { useAutomationHub } from './automation-hooks.js'
import type { WorkflowCategory, WorkflowRecord, WorkflowStatus, WorkflowTemplate } from './automation-model.js'
import { CATEGORIES } from './automation-model.js'
import { friendlyCategory, friendlyStatus, isEmptyWorkflow, relativeTime, shortDate } from './automation-helpers.js'
import { HowItWorksModal } from './automation-tutorial.js'
import { ApprovalInbox } from './ApprovalInbox.js'
import { RunHistory } from './RunHistory.js'
import { TemplateGallery } from './TemplateGallery.js'
import { WorkflowCard } from './WorkflowCard.js'

const WorkflowEditor = lazy(() => import('./WorkflowEditor.js').then((module) => ({ default: module.WorkflowEditor })))

type ToastKind = 'success' | 'info' | 'warning' | 'error'
type Route = { view: 'hub' } | { view: 'templates' } | { view: 'approvals' } | { view: 'editor'; id: string } | { view: 'runs'; id: string } | { view: 'run'; id: string }

/** Featured templates are a curated order of the real backend templates — no invented data. */
const FEATURED_TEMPLATE_IDS: readonly string[] = [
  'abandoned-checkout',
  'welcome-customer',
  'low-stock-alert',
  'high-value-order',
  'back-in-stock',
  'review-request',
  'win-back',
  'vip-tagging',
]

export function AutomationWorkspace({
  context,
  onToast,
  onNavigateBilling,
}: {
  context: WorkspaceContext
  onToast: (message: string, kind?: ToastKind) => void
  onNavigateBilling: () => void
}): JSX.Element {
  const [route, setRoute] = useState<Route>(() => parseRoute())
  useEffect(() => {
    const listener = () => setRoute(parseRoute())
    window.addEventListener('popstate', listener)
    return () => window.removeEventListener('popstate', listener)
  }, [])
  const navigate = (next: Route): void => {
    const path =
      next.view === 'hub'
        ? '/automation'
        : next.view === 'templates'
          ? '/automation/templates'
          : next.view === 'approvals'
            ? '/automation/approvals'
            : next.view === 'editor'
              ? `/automation/workflows/${next.id}`
              : next.view === 'runs'
                ? `/automation/workflows/${next.id}/runs`
                : `/automation/runs/${next.id}`
    window.history.pushState({}, '', `${path}${window.location.search}`)
    setRoute(next)
  }
  if (!context.storeId) return <AutomationDisconnected />
  if (route.view === 'hub') return <AutomationHub storeId={context.storeId} onNavigate={navigate} onToast={onToast} onUpgrade={onNavigateBilling} />
  if (route.view === 'templates')
    return <TemplatesRoute storeId={context.storeId} onBack={() => navigate({ view: 'hub' })} onOpen={(id) => navigate({ view: 'editor', id })} onToast={onToast} onUpgrade={onNavigateBilling} />
  if (route.view === 'approvals')
    return <ApprovalInbox storeId={context.storeId} onBack={() => navigate({ view: 'hub' })} onToast={onToast} />
  if (route.view === 'run')
    return <RunHistory storeId={context.storeId} runId={route.id} onBack={() => window.history.back()} onOpenRun={(id) => navigate({ view: 'run', id })} onToast={onToast} />
  return (
    <WorkflowRoute
      storeId={context.storeId}
      id={route.id}
      mode={route.view}
      onBack={() => navigate({ view: 'hub' })}
      onTemplates={() => navigate({ view: 'templates' })}
      onRun={(id) => navigate({ view: 'run', id })}
      onRuns={() => navigate({ view: 'runs', id: route.id })}
      onToast={onToast}
    />
  )
}

function AutomationHub({
  storeId,
  onNavigate,
  onToast,
  onUpgrade,
}: {
  storeId: string
  onNavigate: (route: Route) => void
  onToast: (message: string, kind?: ToastKind) => void
  onUpgrade: () => void
}): JSX.Element {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'ALL' | WorkflowStatus>('ALL')
  const [category, setCategory] = useState<'ALL' | WorkflowCategory>('ALL')
  const [sort, setSort] = useState('lastRun')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [createOpen, setCreateOpen] = useState(false)
  const [createMode, setCreateMode] = useState<'template' | 'blank'>('template')
  const [howOpen, setHowOpen] = useState(false)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const draftsRef = useRef<HTMLDetailsElement | null>(null)
  const filters = useMemo(
    () => ({
      ...(search ? { search } : {}),
      ...(status !== 'ALL' ? { status } : {}),
      ...(category !== 'ALL' ? { category } : {}),
      sort,
      limit: '50',
    }),
    [search, status, category, sort],
  )
  const { workflows, summary, usage, templates, approvals, loading, error, refresh } = useAutomationHub(storeId, filters)

  const runAction = async (workflow: WorkflowRecord, command: 'run' | 'pause' | 'resume' | 'clone' | 'archive' | 'history'): Promise<void> => {
    if (command === 'history') {
      onNavigate({ view: 'runs', id: workflow.id })
      return
    }
    try {
      if (command === 'archive') {
        await archiveWorkflow(storeId, workflow.id)
      } else {
        const result = await workflowCommand(storeId, workflow.id, command, command === 'clone' ? { name: `${workflow.name} copy` } : {})
        if (command === 'run' && 'id' in result) {
          onToast('Automation run started.', 'success')
          onNavigate({ view: 'run', id: result.id })
        }
      }
      onToast(
        command === 'pause'
          ? 'Automation paused.'
          : command === 'resume'
            ? 'Automation resumed.'
            : command === 'clone'
              ? 'Automation duplicated.'
              : command === 'archive'
                ? 'Automation removed.'
                : 'Automation run started.',
        'success',
      )
      void refresh()
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : 'Automation action failed.', 'error')
    }
  }

  if (loading) return <AutomationLoading />
  if (error)
    return (
      <div className="automation-page">
        <div className="automation-error">
          <AlertTriangle size={28} />
          <h2>Automation could not be loaded</h2>
          <p>{error}</p>
          <button onClick={() => void refresh()}>
            <RefreshCw size={15} /> Retry
          </button>
        </div>
      </div>
    )

  const items = workflows?.items ?? []
  const emptyDrafts = items.filter(isEmptyWorkflow)
  const isNewMerchant = items.length === 0 || items.every(isEmptyWorkflow)
  const visible = applyFilters(items, { search, status, category, sort })
  const gridItems = visible.filter((workflow) => !isEmptyWorkflow(workflow) && (status === 'ALL' ? workflow.status !== 'ARCHIVED' : true))
  const draftItems = visible.filter(isEmptyWorkflow)
  const hasActiveFilters = Boolean(search || status !== 'ALL' || category !== 'ALL')
  const showKpis = Boolean(summary && (summary.workflows.active > 0 || summary.runs.thisMonth > 0))
  const totalLimit = usage?.limit
  const usagePercent = totalLimit ? (usage.used / totalLimit) * 100 : 0
  const featured = featuredTemplates(templates)
  const activeCount = gridItems.filter((workflow) => workflow.status === 'ACTIVE').length
  const pausedCount = gridItems.filter((workflow) => workflow.status === 'PAUSED').length
  const draftCount = gridItems.filter((workflow) => workflow.status === 'DRAFT').length

  const openDrafts = (): void => {
    setDraftsOpen(true)
    window.requestAnimationFrame(() => draftsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const openCreate = (mode: 'template' | 'blank'): void => {
    setCreateMode(mode)
    setCreateOpen(true)
  }

  return (
    <div className="automation-page">
      <header className="automation-header">
        <div>
          <span className="automation-eyebrow">SHOPIFY AUTOMATIONS</span>
          <h1>🤖 Automations</h1>
          <p>Save time and grow your business with automated workflows.</p>
        </div>
        <div className="automation-header-actions">
          <button className="automation-secondary" onClick={() => setHowOpen(true)}>
            <BookOpen size={16} /> How it works
          </button>
          <button className="automation-secondary" onClick={() => onNavigate({ view: 'templates' })}>
            <Sparkles size={16} /> Browse Templates
          </button>
          <button
            className="automation-primary"
            disabled={usage?.limitReached ?? false}
            title={usage?.limitReached ? 'Complete your drafts or upgrade for more space' : ''}
            onClick={() => openCreate('template')}
          >
            <Plus size={16} /> Create Automation
          </button>
        </div>
      </header>

      {planBanner(usage, usagePercent, emptyDrafts.length, openDrafts, onUpgrade)}

      {isNewMerchant && (
        <GettingStartedHero
          onTemplates={() => onNavigate({ view: 'templates' })}
          onHow={() => setHowOpen(true)}
          onScratch={() => openCreate('blank')}
          popular={featured.slice(0, 3)}
        />
      )}

      {templates.length > 0 && (
        <section className="automation-section featured-templates">
          <TemplateGallery
            featured
            templates={featured}
            onBrowseAll={() => onNavigate({ view: 'templates' })}
            onInstall={async (template, name) => {
              try {
                const workflow = await installAutomationTemplate(storeId, template.id, name)
                onToast('Template installed — review it, then activate.', 'success')
                onNavigate({ view: 'editor', id: workflow.id })
              } catch (reason: unknown) {
                onToast(reason instanceof Error ? reason.message : 'Template could not be installed.', 'error')
              }
            }}
            onUpgrade={onUpgrade}
          />
        </section>
      )}

      {(gridItems.length > 0 || hasActiveFilters) && (
        <section className="automation-section your-automations">
          <header className="automation-section-header">
            <div>
              <span className="automation-eyebrow">YOUR AUTOMATIONS</span>
              <h2>
                Your Automations <span className="count-badge">{gridItems.length}</span>
              </h2>
              <p>
                {gridItems.length > 0
                  ? `${activeCount} active · ${pausedCount} paused${draftCount > 0 ? ` · ${draftCount} draft` : ''}`
                  : 'Adjust filters to see your automations.'}
              </p>
            </div>
          </header>
          <div className="automation-toolbar">
            <label className="automation-search">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search automations" />
            </label>
            <div className="automation-status-tabs">
              {(['ALL', 'ACTIVE', 'PAUSED', 'DRAFT', 'ARCHIVED'] as const).map((value) => (
                <button key={value} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>
                  {value === 'ALL' ? 'All' : friendlyStatus(value)}
                  <span>
                    {value === 'ALL'
                      ? Object.values(summary?.workflows ?? {}).reduce((a, b) => a + b, 0)
                      : summary?.workflows[value.toLowerCase() as keyof NonNullable<typeof summary>['workflows']] ?? 0}
                  </span>
                </button>
              ))}
            </div>
            <label className="automation-select">
              <Filter size={15} />
              <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
                <option value="ALL">All categories</option>
                {CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {friendlyCategory(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="automation-select">
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="lastRun">Last run</option>
                <option value="name">Name</option>
                <option value="created">Created</option>
                <option value="successRate">Success rate</option>
              </select>
            </label>
            <div className="view-toggle">
              <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view">
                <Grid2X2 size={16} />
              </button>
              <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view">
                <List size={16} />
              </button>
            </div>
          </div>
          {gridItems.length === 0 ? (
            <div className="automation-empty">
              <Search size={30} />
              <h2>No automations match these filters</h2>
              <p>Try a broader status, category, or search term.</p>
              <button
                className="automation-secondary"
                onClick={() => {
                  setSearch('')
                  setStatus('ALL')
                  setCategory('ALL')
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className={`automation-workflow-grid ${view}`}>
              {gridItems.map((workflow) => (
                <WorkflowCard
                  key={workflow.id}
                  workflow={workflow}
                  onOpen={() => onNavigate({ view: 'editor', id: workflow.id })}
                  onCommand={(command) => void runAction(workflow, command)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {approvals.length > 0 && (
        <section className="pending-approval-banner">
          <ShieldCheck size={22} />
          <div>
            <strong>
              {approvals.length} {approvals.length === 1 ? 'action is' : 'actions are'} awaiting approval
            </strong>
            <span>Review the exact result before allowing customer communication or pricing changes.</span>
          </div>
          <button onClick={() => onNavigate({ view: 'approvals' })}>Review approvals</button>
        </section>
      )}

      {showKpis && <KpiMetrics summary={summary} usage={usage} onApprovals={() => onNavigate({ view: 'approvals' })} />}

      {summary && summary.recentActivity.length > 0 && <ActivityFeed summary={summary} onOpenRun={(id) => onNavigate({ view: 'run', id })} />}

      {draftItems.length > 0 && (
        <details className="auto-drafts" ref={draftsRef} open={draftsOpen} onToggle={(event) => setDraftsOpen((event.target as HTMLDetailsElement).open)}>
          <summary>
            <span>
              <FileText size={16} /> Drafts needing attention ({draftItems.length})
            </span>
            <ChevronDown size={16} />
          </summary>
          <p className="auto-drafts-note">
            These automations are empty and have never run. Continue setting one up, or remove it to free up space.
          </p>
          <div className="draft-list">
            {draftItems.map((workflow) => (
              <article className="draft-row" key={workflow.id}>
                <span className="draft-row-icon">
                  <FileText size={17} />
                </span>
                <div className="draft-row-info">
                  <strong>{workflow.name === 'Untitled workflow' ? 'Untitled automation' : workflow.name}</strong>
                  <span>
                    {workflow.nodeCount} step{workflow.nodeCount === 1 ? '' : 's'} · created {shortDate(workflow.createdAt)} · never run
                  </span>
                </div>
                <div className="draft-row-actions">
                  <button className="automation-secondary" onClick={() => onNavigate({ view: 'editor', id: workflow.id })}>
                    <Pencil size={14} /> Continue Setup
                  </button>
                  <button className="draft-delete" onClick={() => void runAction(workflow, 'archive')}>
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        </details>
      )}

      {createOpen && (
        <CreateAutomationModal
          storeId={storeId}
          templates={templates}
          usage={usage}
          initialMode={createMode}
          onClose={() => setCreateOpen(false)}
          onCreated={(workflow) => {
            setCreateOpen(false)
            onNavigate({ view: 'editor', id: workflow.id })
          }}
          onToast={onToast}
        />
      )}

      {howOpen && (
        <HowItWorksModal
          onClose={() => setHowOpen(false)}
          onStartBuilding={() => {
            setHowOpen(false)
            openCreate('template')
          }}
          onBrowseTemplates={() => {
            setHowOpen(false)
            onNavigate({ view: 'templates' })
          }}
        />
      )}
    </div>
  )
}

function planBanner(
  usage: ReturnType<typeof useAutomationHub>['usage'],
  usagePercent: number,
  drafts: number,
  onCompleteDrafts: () => void,
  onUpgrade: () => void,
): JSX.Element | null {
  if (!usage || usage.limit === null) return null
  if (usage.limitReached) {
    if (drafts > 0) {
      return (
        <div className="automation-plan-banner drafts">
          <CircleGauge size={20} />
          <div>
            <strong>Complete your drafts or upgrade for more space</strong>
            <span>
              {usage.used} of {usage.limit} automations in use · {drafts} draft{drafts === 1 ? '' : 's'} still need{drafts === 1 ? 's' : ''} finishing
            </span>
          </div>
          <button onClick={onCompleteDrafts}>Complete Drafts</button>
          <button onClick={onUpgrade}>Upgrade Plan</button>
        </div>
      )
    }
    return (
      <div className="automation-plan-banner reached">
        <CircleGauge size={20} />
        <div>
          <strong>You&rsquo;ve reached your limit</strong>
          <span>
            {usage.used} of {usage.limit} automations in use. Upgrade Plan to create more automations.
          </span>
        </div>
        <button onClick={onUpgrade}>Upgrade Plan</button>
      </div>
    )
  }
  if (usagePercent >= 80) {
    return (
      <div className="automation-plan-banner">
        <CircleGauge size={20} />
        <div>
          <strong>You&rsquo;re almost at your limit</strong>
          <span>
            {usage.used} of {usage.limit} automations in use.
          </span>
        </div>
        <button onClick={onUpgrade}>Upgrade Plan</button>
      </div>
    )
  }
  return null
}

function GettingStartedHero({
  onTemplates,
  onHow,
  onScratch,
  popular,
}: {
  onTemplates: () => void
  onHow: () => void
  onScratch: () => void
  popular: readonly WorkflowTemplate[]
}): JSX.Element {
  return (
    <section className="auto-getting-started">
      <div className="gs-main">
        <span className="gs-emoji">🎉</span>
        <h2>Welcome to Automations!</h2>
        <p>Automations do the repetitive work for you — so you can focus on growing your store.</p>
        <div className="gs-actions">
          <button className="automation-primary" onClick={onTemplates}>
            <Rocket size={16} /> Browse Templates
          </button>
          <button className="automation-secondary" onClick={onHow}>
            <BookOpen size={16} /> How it works
          </button>
        </div>
        <button className="gs-scratch" onClick={onScratch}>
          Or build from scratch <ArrowRight size={14} />
        </button>
      </div>
      <div className="gs-popular">
        <h3>💡 Popular automations</h3>
        {popular.map((template) => (
          <button key={template.id} className="gs-popular-item" onClick={onTemplates}>
            <span className="gs-popular-name">{template.name}</span>
            <span className="gs-popular-impact">{template.impact}</span>
          </button>
        ))}
        <button className="browse-all-link" onClick={onTemplates}>
          Browse all templates <ArrowRight size={15} />
        </button>
      </div>
    </section>
  )
}

function KpiMetrics({
  summary,
  usage,
  onApprovals,
}: {
  summary: ReturnType<typeof useAutomationHub>['summary']
  usage: ReturnType<typeof useAutomationHub>['usage']
  onApprovals: () => void
}): JSX.Element {
  const runTrend = summary ? summary.runs.thisMonth - summary.runs.previousMonth : 0
  const impacts = summary ? Object.entries(summary.impact).filter(([, value]) => value > 0) : []
  return (
    <section className="automation-kpis">
      <article>
        <span>
          <Workflow size={18} />
        </span>
        <small>Active automations</small>
        <strong>{summary?.workflows.active ?? 0}</strong>
        <p>
          {usage?.limit === null ? `${usage?.used ?? 0} automations · unlimited plan` : `${usage?.used ?? 0} of ${usage?.limit ?? 0} automations used`}
        </p>
      </article>
      <article>
        <span>
          <Activity size={18} />
        </span>
        <small>Runs this month</small>
        <strong>{summary?.runs.thisMonth ?? 0}</strong>
        <p>{runTrend === 0 ? 'No change from last month' : `${runTrend > 0 ? '+' : ''}${runTrend} vs last month`}</p>
      </article>
      <article>
        <span>
          <CheckCircle2 size={18} />
        </span>
        <small>Success rate</small>
        <strong>{summary?.runs.successRate === null || summary?.runs.successRate === undefined ? '—' : `${Math.round(summary.runs.successRate)}%`}</strong>
        <p>
          {summary?.runs.completed || summary?.runs.failed
            ? `${summary.runs.completed} completed · ${summary.runs.failed} with issues`
            : 'Available after the first run'}
        </p>
      </article>
      <article>
        <span>
          <BarChart3 size={18} />
        </span>
        <small>Actions completed</small>
        <strong>{impacts.reduce((total, [, value]) => total + value, 0)}</strong>
        <p>{impacts.length ? impacts.map(([key, value]) => `${value} ${impactLabel(key)}`).join(' · ') : 'Measured after successful actions'}</p>
      </article>
      <button className={summary?.approvalsPending ? 'attention' : ''} onClick={onApprovals}>
        <span>
          <Bell size={18} />
        </span>
        <small>Pending approvals</small>
        <strong>{summary?.approvalsPending ?? 0}</strong>
        <p>{summary?.approvalsPending ? 'Review required' : 'No actions waiting'}</p>
      </button>
    </section>
  )
}

function ActivityFeed({
  summary,
  onOpenRun,
}: {
  summary: NonNullable<ReturnType<typeof useAutomationHub>['summary']>
  onOpenRun: (id: string) => void
}): JSX.Element {
  return (
    <section className="automation-activity">
      <header>
        <div>
          <span className="automation-eyebrow">RECENT ACTIVITY</span>
          <h2>Recent activity</h2>
        </div>
      </header>
      <div className="activity-timeline">
        {summary.recentActivity.map((item) => (
          <button key={item.runId} onClick={() => onOpenRun(item.runId)}>
            <i className={item.status.toLowerCase()} />
            <span>
              <strong>{item.workflowName}</strong>
              <small>{item.description}</small>
            </span>
            <time>{relativeTime(item.at)}</time>
          </button>
        ))}
      </div>
    </section>
  )
}

export function CreateAutomationModal({
  storeId,
  templates,
  usage,
  initialMode,
  onClose,
  onCreated,
  onToast,
}: {
  storeId: string
  templates: readonly WorkflowTemplate[]
  usage: ReturnType<typeof useAutomationHub>['usage']
  initialMode: 'template' | 'blank'
  onClose: () => void
  onCreated: (workflow: WorkflowRecord) => void
  onToast: (message: string, kind?: ToastKind) => void
}): JSX.Element {
  const [mode, setMode] = useState<'template' | 'blank'>(initialMode)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<WorkflowCategory>('Marketing')
  const [templateId, setTemplateId] = useState('')
  const [busy, setBusy] = useState(false)
  const available = templates.filter((template) => !template.locked)
  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      onToast('Give your automation a name first.', 'info')
      return
    }
    setBusy(true)
    try {
      const workflow =
        mode === 'template' && templateId
          ? await installAutomationTemplate(storeId, templateId, name.trim())
          : await createAutomationWorkflow({ storeId, name: name.trim(), category })
      onCreated(workflow)
      onToast(mode === 'template' ? 'Template installed — review it, then activate.' : 'Automation draft created.', 'success')
    } catch (reason: unknown) {
      onToast(reason instanceof Error ? reason.message : 'Automation could not be created.', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="automation-modal-backdrop">
      <div className="automation-modal create-workflow-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <span className="automation-eyebrow">NEW AUTOMATION</span>
        <h2>Create New Automation</h2>
        <p>Give it a name and choose a starting point. You can change everything later.</p>

        <label>
          What do you want to automate?
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g., Welcome new customers" maxLength={120} />
        </label>

        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value as WorkflowCategory)}>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {friendlyCategory(value)}
              </option>
            ))}
          </select>
        </label>

        <span className="creation-label">How do you want to start?</span>
        <div className="creation-mode">
          <button className={mode === 'template' ? 'active' : ''} onClick={() => setMode('template')}>
            <Sparkles size={20} />
            <strong>From Template</strong>
            <span>Recommended — start with a proven, pre-built automation</span>
          </button>
          <button className={mode === 'blank' ? 'active' : ''} onClick={() => setMode('blank')}>
            <WandSparkles size={20} />
            <strong>From Scratch</strong>
            <span>Advanced — build your own step by step</span>
          </button>
        </div>

        {mode === 'template' ? (
          <label>
            Template
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              <option value="">Choose a template</option>
              {available.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {usage && usage.limit !== null && (
          <small className="create-usage-note">
            {usage.used} of {usage.limit} automations used{usage.limitReached ? ' — upgrade or finish a draft to add more.' : '.'}
          </small>
        )}

        <footer>
          <button className="automation-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="automation-primary"
            disabled={busy || !name.trim() || (mode === 'template' && !templateId)}
            onClick={() => void submit()}
          >
            {busy ? 'Setting up…' : 'Continue →'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function TemplatesRoute({
  storeId,
  onBack,
  onOpen,
  onToast,
  onUpgrade,
}: {
  storeId: string
  onBack: () => void
  onOpen: (id: string) => void
  onToast: (message: string, kind?: ToastKind) => void
  onUpgrade: () => void
}): JSX.Element {
  const [templates, setTemplates] = useState<readonly WorkflowTemplate[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    void getAutomationTemplates(storeId)
      .then(setTemplates)
      .catch((reason: unknown) => onToast(reason instanceof Error ? reason.message : 'Templates could not be loaded.', 'error'))
      .finally(() => setLoading(false))
  }, [storeId])
  if (loading) return <AutomationLoading />
  return (
    <div className="automation-page">
      <TemplateGallery
        full
        templates={templates}
        onBack={onBack}
        onInstall={async (template, name) => {
          const workflow = await installAutomationTemplate(storeId, template.id, name)
          onToast('Template installed — review it, then activate.', 'success')
          onOpen(workflow.id)
        }}
        onUpgrade={onUpgrade}
      />
    </div>
  )
}

function WorkflowRoute({
  storeId,
  id,
  mode,
  onBack,
  onTemplates,
  onRun,
  onRuns,
  onToast,
}: {
  storeId: string
  id: string
  mode: 'editor' | 'runs'
  onBack: () => void
  onTemplates: () => void
  onRun: (id: string) => void
  onRuns: () => void
  onToast: (message: string, kind?: ToastKind) => void
}): JSX.Element {
  const [workflow, setWorkflow] = useState<WorkflowRecord | null>(null)
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof getAutomationUsage>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void Promise.all([getWorkflow(storeId, id), getAutomationUsage(storeId)])
      .then(([record, meter]) => {
        setWorkflow(record)
        setUsage(meter)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Automation could not be loaded.'))
  }, [storeId, id])
  if (error)
    return (
      <div className="automation-error">
        <AlertTriangle size={25} />
        <h2>Automation unavailable</h2>
        <p>{error}</p>
        <button onClick={onBack}>Back to automations</button>
      </div>
    )
  if (!workflow || !usage) return <AutomationLoading />
  if (mode === 'runs') return <RunHistory storeId={storeId} workflow={workflow} onBack={onBack} onOpenRun={onRun} onToast={onToast} />
  return (
    <Suspense fallback={<AutomationLoading />}>
      <WorkflowEditor storeId={storeId} workflow={workflow} usage={usage} onBack={onBack} onTemplates={onTemplates} onSaved={setWorkflow} onRun={onRun} onToast={onToast} />
    </Suspense>
  )
}

function AutomationLoading(): JSX.Element {
  return (
    <div className="automation-page">
      <div className="automation-skeleton header" />
      <div className="automation-skeleton hero" />
      <div className="template-strip">
        {[1, 2, 3, 4].map((value) => (
          <div className="automation-skeleton template" key={value} />
        ))}
      </div>
      <div className="automation-skeleton toolbar" />
      <div className="automation-workflow-grid">
        {[1, 2].map((value) => (
          <div className="automation-skeleton card" key={value} />
        ))}
      </div>
    </div>
  )
}

function AutomationDisconnected(): JSX.Element {
  return (
    <div className="automation-page">
      <div className="automation-empty hero">
        <LockKeyhole size={34} />
        <h2>Connect Shopify to use automations</h2>
        <p>Automations are tied to your store and need an authenticated Shopify connection before they can be created or run.</p>
      </div>
    </div>
  )
}

function featuredTemplates(templates: readonly WorkflowTemplate[]): readonly WorkflowTemplate[] {
  const byId = new Map(templates.map((template) => [template.id, template]))
  const ordered = FEATURED_TEMPLATE_IDS.map((id) => byId.get(id)).filter((template): template is WorkflowTemplate => Boolean(template))
  const rest = templates.filter((template) => !FEATURED_TEMPLATE_IDS.includes(template.id))
  return [...ordered, ...rest].slice(0, 8)
}

function applyFilters(
  items: readonly WorkflowRecord[],
  filters: { search: string; status: 'ALL' | WorkflowStatus; category: 'ALL' | WorkflowCategory; sort: string },
): WorkflowRecord[] {
  let out = [...items]
  if (filters.search) {
    const query = filters.search.toLowerCase()
    out = out.filter((workflow) => `${workflow.name} ${workflow.description ?? ''}`.toLowerCase().includes(query))
  }
  if (filters.status !== 'ALL') out = out.filter((workflow) => workflow.status === filters.status)
  if (filters.category !== 'ALL') out = out.filter((workflow) => workflow.category === filters.category)
  if (filters.sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name))
  else if (filters.sort === 'created') out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  else if (filters.sort === 'successRate') out.sort((a, b) => successRate(b) - successRate(a))
  else out.sort((a, b) => (Date.parse(b.lastRunAt ?? '') || 0) - (Date.parse(a.lastRunAt ?? '') || 0))
  return out
}

function successRate(workflow: WorkflowRecord): number {
  const total = workflow.successCount + workflow.failureCount
  return total ? (workflow.successCount / total) * 100 : 0
}

function parseRoute(): Route {
  const path = window.location.pathname
  let match = path.match(/^\/automation\/workflows\/([^/]+)\/runs$/)
  if (match?.[1]) return { view: 'runs', id: decodeURIComponent(match[1]) }
  match = path.match(/^\/automation\/workflows\/([^/]+)$/)
  if (match?.[1]) return { view: 'editor', id: decodeURIComponent(match[1]) }
  match = path.match(/^\/automation\/runs\/([^/]+)$/)
  if (match?.[1]) return { view: 'run', id: decodeURIComponent(match[1]) }
  if (path === '/automation/templates') return { view: 'templates' }
  if (path === '/automation/approvals') return { view: 'approvals' }
  return { view: 'hub' }
}

function impactLabel(key: string): string {
  return key === 'emailsSent' ? 'emails' : key === 'customersTagged' ? 'tags' : key === 'discountsCreated' ? 'discounts' : 'notifications'
}
