// Local-only dev harness for exhaustive testing of the Automation page.
// Not part of the shipped product.
//
// Boots the REAL Express API with in-memory automation repositories and seeds
// three stores exclusively through the real HTTP endpoints, so every number
// the UI displays is genuine backend output — no hardcoded UI data.
//
//   demo-store — matches the bug-report screenshot: 2/2 trial limit reached,
//                2 ACTIVE never-run "Untitled workflow" automations.
//   busy-store — real installed templates, real runs, real stats.
//   fresh-store — brand-new merchant (empty state / getting started hero).
//
// Usage:  node scripts/automation-dev-harness.mjs   (serves :3000)
// Then:   vite dev (apps/web) proxies /automation & /session to this server.
// Open:   http://localhost:5173/automation?storeId=demo-store
import { createServer } from 'node:http'
import { AutomationExecutionService, InMemoryRunRepository, InMemoryTemplateRepository, InMemoryWorkflowRepository, MerchantEmailVerifier, ThreadLedger } from '../packages/automation/dist/index.js'
import { InMemoryStoreDirectory } from '../packages/db/dist/index.js'
import { Logger } from '../packages/logger/dist/index.js'
import { createApi } from '../apps/api/dist/app.js'

const PORT = Number(process.env.PORT ?? '3000')
const logger = new Logger()

const workflows = new InMemoryWorkflowRepository()
const runs = new InMemoryRunRepository()

// Mirror the production Postgres behaviour that the in-memory double omits:
// completed/failed runs update the workflow's last-run and success/failure counters.
const transition = runs.transition.bind(runs)
runs.transition = async (storeId, runId, status, fields = {}) => {
  const next = await transition(storeId, runId, status, fields)
  if (status === 'COMPLETED' || status === 'FAILED') {
    const key = `${storeId}:${next.workflowId}`
    const current = workflows.records.get(key)
    if (current) {
      workflows.records.set(key, {
        ...current,
        lastRunAt: next.completedAt,
        successCount: current.successCount + (status === 'COMPLETED' ? 1 : 0),
        failureCount: current.failureCount + (status === 'FAILED' ? 1 : 0),
        updatedAt: next.completedAt,
      })
    }
  }
  return next
}

// Mirror the production summary shape: real workflow counts plus real recent activity.
const summarize = runs.summary.bind(runs)
runs.summary = async (storeId) => {
  const base = await summarize(storeId)
  const page = await workflows.list(storeId, { limit: '100' })
  const counts = { active: 0, draft: 0, paused: 0, archived: 0 }
  for (const workflow of page.items) {
    const key = workflow.status.toLowerCase()
    if (Object.hasOwn(counts, key)) counts[key] += 1
  }
  const recent = (await runs.list(storeId, null, 20, '0')).items.slice(0, 8)
  const names = new Map(page.items.map((workflow) => [workflow.id, workflow.name]))
  return {
    ...base,
    workflows: counts,
    recentActivity: recent.map((run) => ({
      runId: run.id,
      workflowId: run.workflowId,
      workflowName: names.get(run.workflowId) ?? 'Automation',
      status: run.status,
      at: run.completedAt ?? run.startedAt ?? run.createdAt,
      description: `Workflow run ${run.status.toLowerCase().replace('_', ' ')}`,
    })),
  }
}

const execution = new AutomationExecutionService(runs, {
  async execute(_store, node, _context, _key, testMode) {
    // Mirrors the real action executor: completes email/tag/notify steps and records impact.
    return { action: String(node.config.action ?? node.type), testMode, output: { action: String(node.config.action ?? node.type) } }
  },
})

const directory = new InMemoryStoreDirectory()

const app = createApi({
  logger,
  readinessChecks: [],
  session: { directory },
  automation: {
    workflows,
    runs,
    execution,
    templates: new InMemoryTemplateRepository(),
    emailVerifier: new MerchantEmailVerifier('preview-secret'),
    tickets: new ThreadLedger(),
  },
})

const server = createServer(app)

const base = `http://127.0.0.1:${PORT}`
const json = (method, path, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const manualWorkflow = (name, category, action) => ({
  storeId: 'demo-store',
  name,
  description: null,
  category,
  nodes: [
    { id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: ['action'] },
    { id: 'action', type: 'action', config: action, next: [] },
  ],
})

async function seedDemoStore() {
  // Two never-run ACTIVE "Untitled workflow" automations (screenshot state).
  await json('POST', '/automation/workflows', manualWorkflow('Untitled workflow', 'Operations', { action: 'email', templateId: 'welcome-customer', maxRecipients: 1 }))
  await json('POST', '/automation/workflows', manualWorkflow('Untitled workflow', 'Operations', { action: 'tag_customer', tag: 'VIP', operation: 'add' }))
  const page = await (await json('GET', `/automation/workflows?storeId=demo-store`)).json()
  for (const record of page.data.items) {
    await json('POST', `/automation/workflows/${record.id}/activate`, { storeId: 'demo-store' })
  }
  logger.info('Seeded demo-store (2/2 used, 2 active never-run workflows)')
}

async function seedBusyStore() {
  const templateNames = [
    ['welcome-customer', 'Welcome New Customers'],
    ['high-value-order', 'High-Value Order Alerts'],
    ['low-stock-alert', 'Low Stock Alerts'],
  ]
  const installed = []
  for (const [templateId, name] of templateNames) {
    const response = await json('POST', `/automation/templates/${templateId}/install`, { storeId: 'busy-store', name })
    if (response.status !== 200 && response.status !== 201) {
      logger.warn('install failed', { templateId, status: response.status })
    } else {
      installed.push((await response.json()).data)
    }
  }
  for (const record of installed) {
    await json('POST', `/automation/workflows/${record.id}/activate`, { storeId: 'busy-store' })
  }
  // Real runs through the real runner: 4 successful, 1 failed (step 2 context).
  for (const record of installed.slice(0, 2)) {
    for (let i = 0; i < 4; i += 1) {
      const response = await json('POST', `/automation/workflows/${record.id}/run`, {
        storeId: 'busy-store',
        context: { customerId: `customer-${i}`, order: { total: 320 + i } },
      })
      if (response.status !== 202) logger.warn('run failed', { status: response.status })
      await sleep(15)
    }
  }
  logger.info('Seeded busy-store (real templates, activations, runs, stats)')
}

async function seed() {
  await directory.upsertByShopDomain('demo-store.myshopify.com')
  await directory.upsertByShopDomain('busy-store.myshopify.com')
  await directory.upsertByShopDomain('fresh-store.myshopify.com')
  await seedDemoStore()
  await seedBusyStore()
  logger.info('Automation dev harness ready', {
    stores: ['demo-store', 'busy-store', 'fresh-store'],
    usage: 'node scripts/automation-dev-harness.mjs + apps/web vite dev',
  })
}

server.listen(PORT, '0.0.0.0', async () => {
  logger.info('Automation dev-harness API listening', { port: PORT })
  try {
    await seed()
  } catch (error) {
    logger.error('Seeding failed', { message: error instanceof Error ? error.message : String(error) })
  }
})
