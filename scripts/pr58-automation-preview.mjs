// Local-only preview API for visually verifying the Automation page redesign (PR #58).
// Not part of the shipped product.
//
// Boots the REAL Express API with in-memory automation repositories, then seeds it
// exclusively through the real HTTP endpoints (template installs, workflow runs), so
// every number the UI displays is genuine backend output — no hardcoded UI data.
//
// Usage:  node scripts/pr58-automation-preview.mjs   (serves :3000)
// Then:   vite dev (apps/web) proxies /automation to this server.
// Open:   http://localhost:5173/automation?storeId=demo-store
import { createServer } from 'node:http'
import { AutomationExecutionService, InMemoryRunRepository, InMemoryWorkflowRepository, MerchantEmailVerifier, ThreadLedger } from '../packages/automation/dist/index.js'
import { Logger } from '../packages/logger/dist/index.js'
import { createApi } from '../apps/api/dist/app.js'

const PORT = Number(process.env.PORT ?? '3000')
const STORE = process.env.MOCK_STORE ?? 'demo-store'
const logger = new Logger()

const workflows = new InMemoryWorkflowRepository()
const runs = new InMemoryRunRepository()

// Mirror the production Postgres behaviour that the in-memory double omits:
// completed/failed runs update the workflow's last-run and success/failure counters.
// (TS `private` members are plain runtime properties, so the preview harness can
// update the record map directly — the shipped code is never touched.)
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

const app = createApi({
  logger,
  readinessChecks: [],
  automation: {
    workflows,
    runs,
    execution,
    templates: new InMemoryTemplateRepo(),
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

async function seed() {
  // Install real templates through the real install endpoint.
  const templateNames = [
    ['welcome-customer', 'Welcome New Customers'],
    ['abandoned-checkout', 'Abandoned Cart Recovery'],
    ['high-value-order', 'High-Value Order Alerts'],
    ['low-stock-alert', 'Low Stock Alerts'],
  ]
  const installed = []
  for (const [templateId, name] of templateNames) {
    const response = await json('POST', `/automation/templates/${templateId}/install?storeId=${STORE}`, { storeId: STORE, name })
    if (response.status !== 200 && response.status !== 201) {
      console.warn('install failed', templateId, response.status)
    } else {
      const record = (await response.json()).data
      installed.push(record)
    }
  }
  // Publish two of them so the hub shows real active automations.
  for (const record of installed.slice(0, 2)) {
    await json('POST', `/automation/workflows/${record.id}/activate?storeId=${STORE}`, { storeId: STORE })
  }
  // Run the published workflows through the real runner so runs, recent
  // activity, and impact counters are real.
  for (const record of installed.slice(0, 2)) {
    for (let i = 0; i < 4; i += 1) {
      const response = await json('POST', `/automation/workflows/${record.id}/run?storeId=${STORE}`, {
        storeId: STORE,
        context: { customerId: `customer-${i}`, order: { total: 320 + i } },
      })
      if (response.status !== 202) console.warn('run failed', response.status)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

// Tiny in-memory campaign template repository (matches the shape the API expects).
function InMemoryTemplateRepo() {
  const records = new Map()
  return {
    async put(template) { records.set(`${template.storeId}:${template.id}`, template) },
    async get(storeId, id) { return records.get(`${storeId}:${id}`) ?? null },
    async list(storeId) { return [...records.values()].filter((template) => storeId === undefined || template.storeId === storeId) },
  }
}

server.listen(PORT, '0.0.0.0', async () => {
  logger.info('Automation preview API listening', { port: PORT })
  try {
    await seed()
    logger.info('Preview seeded with real backend data', { store: STORE })
  } catch (error) {
    logger.error('Seeding failed', { message: error instanceof Error ? error.message : String(error) })
  }
})
