import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppProvider } from '@shopify/polaris'
import enTranslations from '@shopify/polaris/locales/en.json' with { type: 'json' }
import { HowItWorksModal } from './automation-tutorial.js'
import {
  actionBarHeights,
  friendlyCron,
  friendlyNodeLabel,
  friendlyNodeSummary,
  friendlyStatus,
  friendlyTriggerSummary,
  isEmptyWorkflow,
  monthSparkPath,
  planBadgeClass,
  planBadgeLabel,
  templateToneClass,
  usageSegments,
} from './automation-helpers.js'
import type { AutomationSummary, WorkflowNode, WorkflowRecord, WorkflowTemplate } from './automation-model.js'
import { CreateAutomationModal } from './automation.js'
import { AutomationKpis } from './AutomationKpis.js'
import { TemplateGallery } from './TemplateGallery.js'
import { WorkflowCard } from './WorkflowCard.js'


/** main.tsx wraps every page in Polaris AppProvider (i18n); render the same
 *  way so Polaris components inside these cards render natively. */
function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(AppProvider, { i18n: enTranslations as never }, element))
}

const triggerNode = { id: 'trigger', type: 'trigger' as const, config: { trigger: 'manual' as const }, next: ['action'] }
const actionNode = { id: 'action', type: 'action' as const, config: { action: 'email' as const }, next: [] }

const workflow: WorkflowRecord = {
  id: '69e1bd58-9328-46d0-a32f-cbd6d6f226dd',
  storeId: 'store-1',
  name: 'High-value order alert',
  description: 'Notify the operations team.',
  category: 'Operations',
  tags: [],
  version: 1,
  nodes: [triggerNode, actionNode],
  status: 'ACTIVE',
  definitionHash: 'hash',
  activatedAt: '2026-08-17T00:00:00.000Z',
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
  createdBy: 'owner',
  updatedBy: 'owner',
  lastRunAt: null,
  successCount: 0,
  failureCount: 0,
  enabled: true,
  triggerSummary: 'When Shopify orders create',
  nodeCount: 2,
  nextRunAt: null,
  timezone: 'UTC',
  overlapPolicy: 'SKIP',
}

const template: WorkflowTemplate = {
  id: 'welcome-customer',
  name: 'Welcome New Customer',
  description: 'Welcome a new customer after a short, respectful delay.',
  category: 'Customer',
  impact: 'Supports a stronger first-purchase relationship.',
  complexity: 'Simple',
  minimumPlan: 'trial',
  nodes: 3,
  locked: false,
}

const lockedTemplate: WorkflowTemplate = {
  ...template,
  id: 'ai-segmentation',
  name: 'AI-Powered Customer Segmentation',
  minimumPlan: 'commander',
  locked: true,
}

describe('Automation merchant-friendly copy helpers', () => {
  it('detects empty never-run workflows', () => {
    expect(isEmptyWorkflow({ ...workflow, nodes: [], nodeCount: 0 })).toBe(true)
    expect(isEmptyWorkflow({ ...workflow, nodes: [triggerNode], nodeCount: 1 })).toBe(true)
    expect(isEmptyWorkflow({ ...workflow, nodes: [], nodeCount: 0, lastRunAt: '2026-08-18T00:00:00.000Z' })).toBe(false)
    expect(isEmptyWorkflow(workflow)).toBe(false)
  })

  it('translates trigger summaries into plain English', () => {
    expect(friendlyTriggerSummary('When Shopify orders create')).toBe('New order received')
    expect(friendlyTriggerSummary('When Shopify customers create')).toBe('New customer signed up')
    expect(friendlyTriggerSummary('When Shopify inventory levels update')).toBe('Stock level changed')
    expect(friendlyTriggerSummary('Scheduled · 0 9 * * 1 · UTC')).toBe('On a schedule')
    expect(friendlyTriggerSummary('Run on demand')).toBe('Run on demand')
  })

  it('labels nodes without technical jargon', () => {
    const manual: WorkflowNode = { id: 't', type: 'trigger', config: { trigger: 'manual' }, next: [] }
    const email: WorkflowNode = { id: 'a', type: 'action', config: { action: 'email' }, next: [] }
    const discount: WorkflowNode = { id: 'a', type: 'action', config: { action: 'create_discount', amount: 10 }, next: [] }
    const wait: WorkflowNode = { id: 'w', type: 'wait', config: { delayMs: 3_600_000 }, next: [] }
    expect(friendlyNodeLabel(manual)).toBe('Run on demand')
    expect(friendlyNodeLabel(email)).toBe('Send email')
    expect(friendlyNodeLabel(discount)).toBe('Create discount code')
    expect(friendlyNodeLabel(wait)).toBe('Wait for time')
    expect(friendlyNodeSummary(manual)).toContain('run it')
    expect(friendlyNodeSummary(email)).toContain('Sends an email')
    expect(friendlyNodeSummary(wait)).toContain('1 hour')
  })

  it('renders friendly statuses and cron phrases', () => {
    expect(friendlyStatus('ACTIVE')).toBe('Active')
    expect(friendlyStatus('PAUSED')).toBe('Paused')
    expect(friendlyCron('0 9 * * 1')).toContain('Monday')
    expect(friendlyCron('0 10 * * *')).toContain('every day')
  })

  it('labels plan requirements honestly', () => {
    expect(planBadgeLabel('trial')).toBe('All plans')
    expect(planBadgeLabel('start')).toBe('Start plan')
    expect(planBadgeLabel('growth')).toBe('Growth plan')
    expect(planBadgeLabel('commander')).toBe('Commander only')
  })
})

describe('Automation visualization helpers', () => {
  it('maps real categories and plans to visual classes', () => {
    expect(templateToneClass('Marketing')).toBe('sales-growth')
    expect(templateToneClass('Customer')).toBe('customer-experience')
    expect(templateToneClass('Inventory')).toBe('inventory-stock')
    expect(templateToneClass('Operations')).toBe('operations')
    expect(templateToneClass('Revenue')).toBe('revenue-retention')
    expect(planBadgeClass('trial')).toBe('all-plans')
    expect(planBadgeClass('start')).toBe('start')
    expect(planBadgeClass('growth')).toBe('growth')
    expect(planBadgeClass('commander')).toBe('commander')
  })

  it('builds usage segments from real limits without inventing a Commander cap', () => {
    expect(usageSegments(1, 2)).toEqual({ filled: 1, empty: 1, unlimited: false, total: 2 })
    expect(usageSegments(5, 5)).toEqual({ filled: 5, empty: 0, unlimited: false, total: 5 })
    expect(usageSegments(3, null)).toEqual({ filled: 3, empty: 0, unlimited: true, total: 3 })
  })

  it('keeps zero action bars at zero instead of decorative fake heights', () => {
    expect(actionBarHeights([0, 0, 0, 0])).toEqual([0, 0, 0, 0])
    expect(actionBarHeights([10, 0, 5, 0])[1]).toBe(0)
    expect(actionBarHeights([10, 0, 5, 0])[0]).toBe(100)
  })

  it('draws the run sparkline from last month vs this month only', () => {
    const empty = monthSparkPath(0, 0)
    expect(empty.line).toContain('M0,36.0')
    expect(empty.line).toContain('L100,36.0')
    const up = monthSparkPath(0, 10)
    expect(up.line).not.toEqual(empty.line)
  })
})

describe('Automation workflow card', () => {
  it('renders merchant language without leaking the workflow UUID', () => {
    const html = render(createElement(WorkflowCard, { workflow, onOpen: () => {}, onCommand: () => {} }))
    expect(html).toContain('High-value order alert')
    expect(html).toContain('a new order is received')
    expect(html).not.toContain(workflow.id)
  })

  it('shows real usage numbers from the record', () => {
    const html = render(createElement(WorkflowCard, { workflow: { ...workflow, successCount: 12, failureCount: 2 }, onOpen: () => {}, onCommand: () => {} }))
    expect(html).toContain('12')
    expect(html).toContain('successful run')
    expect(html).toContain('2')
    expect(html).toContain('success rate')
  })

  it('never offers SMS in the workflow surface', () => {
    const html = render(createElement(WorkflowCard, { workflow, onOpen: () => {}, onCommand: () => {} }))
    expect(html.toLowerCase()).not.toContain('sms')
  })

  it('keeps Edit, View Report and Pause actions', () => {
    const html = render(createElement(WorkflowCard, { workflow, onOpen: () => {}, onCommand: () => {} }))
    expect(html).toContain('Edit')
    expect(html).toContain('View Report')
    expect(html).toContain('Pause')
  })

  it('marks status and shows an educational empty hint when the workflow has never run', () => {
    const html = render(createElement(WorkflowCard, { workflow, onOpen: () => {}, onCommand: () => {} }))
    expect(html).toContain('status-active')
    expect(html).toContain('workflow-status-badge')
    expect(html).toContain('This automation has not run yet')
    expect(html).not.toContain('Upgrade to')
  })
})

describe('Automation template gallery', () => {
  it('renders template cards with real impact copy', () => {
    const html = render(
      createElement(TemplateGallery, {
        templates: [template, lockedTemplate],
        onInstall: async () => {},
        onUpgrade: () => {},
      }),
    )
    expect(html).toContain('Welcome New Customer')
    expect(html).toContain('Supports a stronger first-purchase relationship.')
    expect(html).toContain('Quick setup')
    expect(html).toContain('3 steps')
    expect(html).toContain('customer-experience')
    expect(html).toContain('template-plan-badge all-plans')
  })

  it('marks locked templates with an Upgrade Plan action (never a plan name)', () => {
    const html = render(
      createElement(TemplateGallery, {
        templates: [lockedTemplate],
        onInstall: async () => {},
        onUpgrade: () => {},
      }),
    )
    expect(html).toContain('Upgrade Plan')
    expect(html).toContain('Commander only')
    expect(html).not.toContain('Upgrade to Commander')
    expect(html).not.toContain('Upgrade to Growth')
  })
})

describe('Create automation modal', () => {
  it('forces a name, category, and starting point', () => {
    const html = render(
      createElement(CreateAutomationModal, {
        storeId: 'store-1',
        templates: [template],
        usage: { plan: 'trial', used: 1, limit: 2, remaining: 1, limitReached: false },
        initialMode: 'template',
        onClose: () => {},
        onCreated: () => {},
        onToast: () => {},
      }),
    )
    expect(html).toContain('Create New Automation')
    expect(html).toContain('What do you want to automate?')
    expect(html).toContain('e.g., Welcome new customers')
    expect(html).toContain('From Template')
    expect(html).toContain('From Scratch')
    expect(html).toContain('Continue')
    expect(html).toContain('1 of 2 automations used')
  })

  it('does not suggest plan names in the modal', () => {
    const html = render(
      createElement(CreateAutomationModal, {
        storeId: 'store-1',
        templates: [template],
        usage: { plan: 'trial', used: 1, limit: 2, remaining: 1, limitReached: false },
        initialMode: 'blank',
        onClose: () => {},
        onCreated: () => {},
        onToast: () => {},
      }),
    )
    expect(html).not.toContain('Upgrade to Growth')
    expect(html).not.toContain('Upgrade to Commander')
  })
})

const emptySummary: AutomationSummary = {
  workflows: { active: 0, draft: 0, paused: 0, archived: 0 },
  runs: { today: 0, thisMonth: 0, previousMonth: 0, completed: 0, failed: 0, waiting: 0, successRate: null },
  impact: { emailsSent: 0, customersTagged: 0, discountsCreated: 0, notificationsSent: 0 },
  approvalsPending: 0,
  recentActivity: [],
}

describe('Automation KPI visualizations', () => {
  it('renders five unique charts from real empty data with educational helpers', () => {
    const html = render(
      createElement(AutomationKpis, {
        summary: emptySummary,
        usage: { plan: 'trial', used: 2, limit: 2, remaining: 0, limitReached: true },
        onApprovals: () => {},
      }),
    )
    expect(html).toContain('Active automations')
    expect(html).toContain('Runs this month')
    expect(html).toContain('Success rate')
    expect(html).toContain('Actions completed')
    expect(html).toContain('Pending approvals')
    expect(html).toContain('segmented-bar')
    expect(html).toContain('stacked-mini-bars')
    expect(html).toContain('approval-dots')
    expect(html).toContain('Available after the first run')
    expect(html).toContain('Measured after successful actions')
    expect(html).toContain('All clear!')
    expect(html).toContain('2 of 2 automations used')
    expect(html).toContain('No change from last month')
    expect(html).not.toContain('Upgrade to')
  })

  it('surfaces real impact counts and success rate when the backend has them', () => {
    const html = render(
      createElement(AutomationKpis, {
        summary: {
          ...emptySummary,
          workflows: { ...emptySummary.workflows, active: 1 },
          runs: { ...emptySummary.runs, thisMonth: 4, previousMonth: 1, completed: 3, failed: 1, successRate: 75 },
          impact: { emailsSent: 3, customersTagged: 1, discountsCreated: 0, notificationsSent: 2 },
          approvalsPending: 2,
        },
        usage: { plan: 'start', used: 1, limit: 5, remaining: 4, limitReached: false },
        onApprovals: () => {},
      }),
    )
    expect(html).toContain('75%')
    expect(html).toContain('3 emails')
    expect(html).toContain('Needs review')
    expect(html).toContain('+3 vs last month')
    expect(html).toContain('1 of 5 automations used')
    expect(html).not.toContain('Upgrade to Start')
  })
})

describe('How-it-works tutorial modal', () => {
  it('teaches the four-step recipe without technical jargon', () => {
    const html = render(
      createElement(HowItWorksModal, { onClose: () => {}, onStartBuilding: () => {}, onBrowseTemplates: () => {} }),
    )
    expect(html).toContain('How automations work')
    expect(html).toContain('Choose a starting point')
    expect(html).toContain('Add checks (optional)')
    expect(html).toContain('Choose what happens')
    expect(html).toContain('Test &amp; activate')
    expect(html).toContain('Start Building')
  })
})
