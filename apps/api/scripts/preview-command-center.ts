/**
 * DEV-ONLY preview harness for the redesigned AI Command Center (PR45).
 *
 * Runs the real Express API with in-memory AI dependencies and a seeded
 * deterministic store snapshot, serving the built web app. This never ships
 * to production and never touches a database — it exists so reviewers can
 * click through the four plan variants of the Command Center.
 *
 *   corepack pnpm --filter @profitpilot/web build
 *   node --experimental-strip-types apps/api/scripts/preview-command-center.ts
 *
 * Plan variants are selected by storeId prefix:
 *   /?storeId=trial-demo      → Trial      (2 unlocked / 5 locked)
 *   /?storeId=start-demo      → Start      (3 unlocked / 4 locked)
 *   /?storeId=growth-demo     → Growth     (5 unlocked / 2 locked)
 *   /?storeId=commander-demo  → Commander  (7 unlocked)
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CalibrationLedger,
  CostMeter,
  DecisionEngine,
  InMemoryAgentSettingsRepository,
  InMemoryCalibrationStore,
  InMemoryRecommendationRepository,
  OpenRouterClient,
} from '@profitpilot/ai'
import type { StoreSnapshot } from '@profitpilot/ai'
import type { PlanTier, StoreId } from '@profitpilot/types'
import { storeId } from '@profitpilot/types'
import { Logger } from '@profitpilot/logger'
import express from 'express'
import { createApi } from '../dist/app.js'

const here = dirname(fileURLToPath(import.meta.url))
const webDistPath = join(here, '..', '..', 'web', 'dist')

const DAY = 86_400_000
const now = Date.now()
const day = (ago: number): string => new Date(now - ago * DAY).toISOString().slice(0, 10)
const iso = (ago: number): string => new Date(now - ago * DAY).toISOString()

function demoSnapshot(tenant: StoreId): StoreSnapshot {
  return {
    storeId: tenant,
    currency: 'USD',
    timezone: 'UTC',
    asOf: new Date(now).toISOString(),
    dataFreshAt: day(0),
    products: [
      { productId: 'p-espresso', title: 'Espresso Grinder Pro', inventoryUnits: 9, averageDailyUnits: 2.4, unitPrice: 189, unitCost: 71, unitsSold120d: 260, daysSinceLastSale: 0 },
      { productId: 'p-kettle', title: 'Gooseneck Kettle', inventoryUnits: 140, averageDailyUnits: 1.1, unitPrice: 74, unitCost: 30, unitsSold120d: 120, daysSinceLastSale: 2 },
      { productId: 'p-mug', title: 'Ceramic Mug Duo', inventoryUnits: 320, averageDailyUnits: 0, unitPrice: 32, unitCost: 9, unitsSold120d: 0, daysSinceLastSale: 140 },
    ],
    customers: [
      { customerKey: 'c-401', lifetimeValue: 640, orderCount: 5, daysSinceLastOrder: 82, firstOrderDay: day(400) },
      { customerKey: 'c-402', lifetimeValue: 210, orderCount: 3, daysSinceLastOrder: 51, firstOrderDay: day(300) },
      { customerKey: 'c-403', lifetimeValue: 96, orderCount: 1, daysSinceLastOrder: 3, firstOrderDay: day(3) },
    ],
    checkouts: [
      { checkoutKey: 'k-9001', total: 214, ageHours: 5, recovered: false },
      { checkoutKey: 'k-9002', total: 89, ageHours: 26, recovered: false },
    ],
    orders: [],
    productPairs: [
      { productId: 'p-espresso', relatedProductId: 'p-kettle', coPurchaseRate: .14, productPrice: 189, relatedProductPrice: 74 },
    ],
    last30dRevenue: 18_400,
    previous30dRevenue: 14_900,
    last30dOrders: 231,
    previous30dOrders: 204,
  }
}

function planFor(tenant: string): PlanTier {
  if (tenant.startsWith('start')) return 'start'
  if (tenant.startsWith('growth')) return 'growth'
  if (tenant.startsWith('commander')) return 'commander'
  return 'trial'
}

const recommendations = new InMemoryRecommendationRepository()
const calibration = new CalibrationLedger(new InMemoryCalibrationStore())
const costs = new CostMeter(5)
const settings = new InMemoryAgentSettingsRepository()
const engine = new DecisionEngine(new OpenRouterClient({ keys: [] }), costs, calibration, recommendations, { concurrency: 3 })

const ai = {
  engine,
  recommendations,
  costs,
  settings,
  calibration,
  snapshot: async (tenant: StoreId) => demoSnapshot(tenant),
  plan: async (tenant: StoreId) => planFor(String(tenant)),
}

const api = createApi({ logger: new Logger(), readinessChecks: [], ai, webDistPath })

// Landing convenience: default to the Trial demo store.
const app = express()
app.get('/', (request, response, next) => {
  if (request.query.storeId) { next(); return }
  response.redirect('/?storeId=trial-demo&shop=demo-roasters.myshopify.com')
})
app.use(api)

const demoStores = ['trial-demo', 'start-demo', 'growth-demo', 'commander-demo']
for (const store of demoStores) {
  const tenant = storeId(store)
  // Seed history so KPIs, cards, and the activity feed have honest rows.
  await engine.run(demoSnapshot(tenant))
  costs.record({ storeId: tenant, model: 'openai/gpt-oss-20b:free', agent: 'REVENUE_AGENT', promptTokens: 900, completionTokens: 260, inputRateMicroDollars: 220, outputRateMicroDollars: 850, at: now })
  costs.record({ storeId: tenant, model: 'openai/gpt-oss-20b:free', agent: 'INVENTORY_AGENT', promptTokens: 640, completionTokens: 190, inputRateMicroDollars: 220, outputRateMicroDollars: 850, at: now })
}
// Give the trial store a decided item so approval-rate stats render.
const seeded = await recommendations.list(storeId('trial-demo'))
const target = seeded.at(-1)
if (target) await recommendations.decide(storeId('trial-demo'), target.id, target.version, 'APPROVED')

const port = Number(process.env.PORT ?? 3000)
app.listen(port, '0.0.0.0', () => {
  console.log(`AI Command Center preview on http://0.0.0.0:${port}`)
  console.log('Open /?storeId=trial-demo | start-demo | growth-demo | commander-demo (add &shop=demo-roasters.myshopify.com)')
  console.log(`Seeded ${iso(0).slice(0, 10)} demo evidence for ${demoStores.length} plan variants.`)
})
