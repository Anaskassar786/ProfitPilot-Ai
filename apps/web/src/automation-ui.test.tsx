import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HowItWorksModal } from './automation-tutorial.js'
import {
  friendlyCron,
  friendlyNodeLabel,
  friendlyNodeSummary,
  friendlyStatus,
  friendlyTriggerSummary,
  isEmptyWorkflow,
  planBadgeLabel,
} from './automation-helpers.js'
import type { WorkflowNode, WorkflowRecord, WorkflowTemplate } from './automation-model.js'
import { CreateAutomationModal } from './automation.js'
import { TemplateGallery } from './TemplateGallery.js'
import { WorkflowCard } from './WorkflowCard.js'

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

describe('Automation workflow card', () => {
  it('renders merchant language without leaking the workflow UUID', () => {
    const html = renderToStaticMarkup(createElement(WorkflowCard, { workflow, onOpen: () => {}, onCommand: () => {} }))
    expect(html).toContain('High-value order alert')
    expect(html).toContain('a new order is received')
    expect(html).not.toContain(workflow.id)
  })

  it('shows real usage numbers from the record', () => {
    const html = renderToStaticMarkup(createElement(WorkflowCard, { workflow: { ...workflow, successCount: 12, failureCount: 2 }, onOpen: () => {}, onCommand: () => {} }))
    expect(html).toContain('12')
    expect(html).toContain('successful run')
    expect(html).toContain('2')
    expect(html).toContain('success rate')
  })

  it('never offers SMS in the workflow surface', () => {
    const html = renderToStaticMarkup(createElement(WorkflowCard, { workflow, onOpen: () => {}, onCommand: () => {} }))
    expect(html.toLowerCase()).not.toContain('sms')
  })

  it('keeps Edit, View Report and Pause actions', () => {
    const html = renderToStaticMarkup(createElement(WorkflowCard, { workflow, onOpen: () => {}, onCommand: () => {} }))
    expect(html).toContain('Edit')
    expect(html).toContain('View Report')
    expect(html).toContain('Pause')
  })
})

describe('Automation template gallery', () => {
  it('renders template cards with real impact copy', () => {
    const html = renderToStaticMarkup(
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
  })

  it('marks locked templates with an Upgrade Plan action (never a plan name)', () => {
    const html = renderToStaticMarkup(
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
    const html = renderToStaticMarkup(
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
    const html = renderToStaticMarkup(
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

describe('How-it-works tutorial modal', () => {
  it('teaches the four-step recipe without technical jargon', () => {
    const html = renderToStaticMarkup(
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
