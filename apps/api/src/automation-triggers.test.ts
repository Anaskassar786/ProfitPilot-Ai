import { describe, expect, it } from 'vitest'
import { AutomationTriggerService } from './automation-triggers.js'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { AutomationExecutionService, WorkflowRecord, WorkflowRepository } from '@profitpilot/automation'
import type { WebhookEvent } from '@profitpilot/shopify'

/**
 * F6 (automation-triggers) — webhook trigger contract:
 *   • An ACTIVE workflow whose `enabled` flag is false (i.e. paused) must
 *     NOT fire on a matching Shopify webhook. Previously the trigger only
 *     checked `status: 'ACTIVE'` and would happily run a paused workflow
 *     when its topic arrived — a real bug fixed in this PR.
 *   • The cron schedule path (already correct) checks `enabled AND`; this
 *     test pins the same invariant for the webhook path.
 *   • Unrelated workflows (wrong topic, no definitionHash) must not match.
 */

const NOW = 1_700_000_000_000
const SHOP = '11111111-1111-1111-1111-111111111111'

type FakeWorkflow = WorkflowRecord

const makeWorkflow = (overrides: Partial<FakeWorkflow>): FakeWorkflow => ({
  id: 'wf-1',
  storeId: SHOP as unknown as FakeWorkflow['storeId'],
  name: 'Test',
  description: null,
  category: 'Operations',
  tags: [],
  version: 1,
  status: 'ACTIVE',
  enabled: true,
  definitionHash: 'hash-1',
  activatedAt: new Date(NOW).toISOString(),
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
  createdBy: 'tester',
  updatedBy: 'tester',
  lastRunAt: null,
  successCount: 0,
  failureCount: 0,
  triggerSummary: 'When Shopify orders create',
  nodeCount: 2,
  nextRunAt: null,
  timezone: 'UTC',
  overlapPolicy: 'SKIP',
  nodes: [
    { id: 'trigger', type: 'trigger', config: { trigger: 'shopify_webhook', topic: 'orders/create' }, next: ['action'] },
    { id: 'action', type: 'action', config: { action: 'internal_notification', message: 'hi' }, next: [] },
  ],
  ...overrides,
})

const makeRepo = (items: readonly FakeWorkflow[]): WorkflowRepository => {
  const repo: Partial<WorkflowRepository> = {
    async list() {
      return { items: items as readonly WorkflowRecord[], nextCursor: null, total: items.length }
    },
    async get(_storeId, id) {
      return (items.find((item) => item.id === id) ?? null) as WorkflowRecord | null
    },
  }
  return repo as WorkflowRepository
}

const noopDb: SqlExecutor = {
  async query<Row extends QueryResultRow>() { return { rows: [] as readonly Row[], rowCount: 0 } },
}

const makeExecution = (): { service: AutomationExecutionService; started: () => number; executed: () => number } => {
  let started = 0
  let executed = 0
  // We only implement the methods that the trigger service actually calls
  // (`start` and `execute`). Cast through `unknown` because the service
  // interface is large; the test only asserts on the counters.
  const fake = {
    async start(workflow: Parameters<AutomationExecutionService['start']>[0]) {
      started += 1
      return {
        id: `run-${started}`,
        workflowId: workflow.id,
        storeId: workflow.storeId as unknown as string,
        version: workflow.version,
        definitionHash: workflow.definitionHash ?? '',
        status: 'QUEUED',
        currentNodeId: null,
        resumeAt: null,
        triggerType: 'SHOPIFY_WEBHOOK',
        testMode: false,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        errorMessage: null,
        attempt: 1,
        maxAttempts: 1,
      } as Awaited<ReturnType<AutomationExecutionService['start']>>
    },
    async execute() {
      executed += 1
      return makeWorkflow({}) as unknown as Awaited<ReturnType<AutomationExecutionService['execute']>>
    },
  }
  return { service: fake as unknown as AutomationExecutionService, started: () => started, executed: () => executed }
}

describe('F6 automation triggers — handleWebhook', () => {
  const event: WebhookEvent = {
    storeId: SHOP as unknown as WebhookEvent['storeId'],
    topic: 'orders/create',
    webhookId: 'wh-1',
    rawBody: JSON.stringify({ id: 1, total_price: '99.00' }),
    signature: 'test',
  }

  it('does NOT fire a paused (enabled=false) workflow on a matching webhook (regression)', async () => {
    const workflow = makeWorkflow({ enabled: false, name: 'paused cart-recovery' })
    const repo = makeRepo([workflow])
    const execution = makeExecution()
    const service = new AutomationTriggerService(noopDb, repo, execution.service)
    const matched = await service.handleWebhook(event)
    expect(matched).toBe(0)
    expect(execution.started()).toBe(0)
    expect(execution.executed()).toBe(0)
  })

  it('fires an active+enabled workflow exactly once on a matching topic', async () => {
    const workflow = makeWorkflow({ enabled: true })
    const repo = makeRepo([workflow])
    const execution = makeExecution()
    const service = new AutomationTriggerService(noopDb, repo, execution.service)
    const matched = await service.handleWebhook(event)
    expect(matched).toBe(1)
    expect(execution.started()).toBe(1)
    expect(execution.executed()).toBe(1)
  })

  it('skips a workflow whose trigger topic does not match the webhook topic', async () => {
    const workflow = makeWorkflow({ name: 'wrong topic', nodes: [
      { id: 'trigger', type: 'trigger', config: { trigger: 'shopify_webhook', topic: 'customers/create' }, next: ['action'] },
      { id: 'action', type: 'action', config: { action: 'internal_notification', message: 'x' }, next: [] },
    ] })
    const repo = makeRepo([workflow])
    const execution = makeExecution()
    const service = new AutomationTriggerService(noopDb, repo, execution.service)
    const matched = await service.handleWebhook(event)
    expect(matched).toBe(0)
    expect(execution.started()).toBe(0)
  })

  it('skips a workflow with no definitionHash / activatedAt (unpublished draft)', async () => {
    const workflow = makeWorkflow({ definitionHash: null, activatedAt: null, name: 'unpublished' })
    const repo = makeRepo([workflow])
    const execution = makeExecution()
    const service = new AutomationTriggerService(noopDb, repo, execution.service)
    const matched = await service.handleWebhook(event)
    expect(matched).toBe(0)
  })

  it('parses a non-object webhook body without crashing (no context)', async () => {
    const workflow = makeWorkflow({})
    const repo = makeRepo([workflow])
    const execution = makeExecution()
    const service = new AutomationTriggerService(noopDb, repo, execution.service)
    const matched = await service.handleWebhook({ ...event, rawBody: '"not-an-object"' })
    expect(matched).toBe(1)
    expect(execution.started()).toBe(1)
  })
})
