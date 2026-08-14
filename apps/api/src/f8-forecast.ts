import { forecastDemand, forecastRfm, forecastStockout, forecastWeeklySeasonality, RFM_METHOD } from '@profitpilot/forecasting'
import type { DemandForecast, RevenueSeasonalityForecast, RfmInput, StockoutForecast } from '@profitpilot/forecasting'
import type { AnalyticsRepository, CatalogProduct } from '@profitpilot/db'

export type ForecastBundle = Readonly<{ storeId: string; generatedAt: string; dataAvailable: boolean; revenue: RevenueSeasonalityForecast | null; demand: readonly Readonly<{ productId: string; title: string; forecast: DemandForecast }>[]; stockout: readonly Readonly<{ productId: string; title: string; forecast: StockoutForecast }>[]; churn: readonly Readonly<{ customerKey: string; segment: string; churnRisk: number }>[]; methods: readonly Readonly<{ method: string; version: string }>[] }>

export type ForecastDependencies = Readonly<{ analytics: Pick<AnalyticsRepository, 'read' | 'readCatalog'>; customers?: (storeId: string) => Promise<readonly RfmInput[]>; now?: () => number }>

export async function computeForecast(storeId: string, dependencies: ForecastDependencies): Promise<ForecastBundle> {
  const tenant = storeId as import('@profitpilot/types').StoreId
  const [analytics, catalog, customers] = await Promise.all([dependencies.analytics.read(tenant), dependencies.analytics.readCatalog(tenant), dependencies.customers?.(storeId) ?? Promise.resolve([])])
  const weekly = sequentialWeeks(analytics.revenue.map((row) => row.grossRevenue))
  const revenue = weekly.length >= 2 ? forecastWeeklySeasonality(weekly) : null
  const products = catalog.map(toProductForecast).filter((value): value is ProductForecast => value !== null)
  const demand = products.map((product) => ({ productId: product.productId, title: product.title, forecast: forecastDemand(product.units14d, product.units30d, 14) }))
  const stockout = products.map((product) => ({ productId: product.productId, title: product.title, forecast: forecastStockout(product.inventory, product.units14d, product.units30d) }))
  const churn = customers.map((customer) => { const result = forecastRfm(customer); return { customerKey: result.customerKey, segment: result.segment, churnRisk: result.churnRisk } })
  const methods = [revenue?.method, ...demand.map((item) => item.forecast.method), ...stockout.map((item) => item.forecast.method), ...(churn.length > 0 ? [forecastRfmMethod()] : [])].filter((method): method is Readonly<{ method: string; version: string }> => method !== undefined).filter((method, index, all) => all.findIndex((candidate) => candidate.method === method.method && candidate.version === method.version) === index)
  return { storeId, generatedAt: new Date(dependencies.now?.() ?? Date.now()).toISOString(), dataAvailable: revenue !== null || products.length > 0 || churn.length > 0, revenue, demand, stockout, churn, methods }
}

type ProductForecast = Readonly<{ productId: string; title: string; inventory: number; units14d: number; units30d: number }>
function toProductForecast(product: CatalogProduct): ProductForecast | null { const inventory = numeric(product.payload.inventory); const units14d = numeric(product.payload.units14d); const units30d = numeric(product.payload.units30d); if (inventory === null || units14d === null || units30d === null) return null; return { productId: product.productId, title: typeof product.payload.title === 'string' ? product.payload.title : product.productId, inventory, units14d, units30d } }
function numeric(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null }
function forecastRfmMethod(): Readonly<{ method: string; version: string }> { return RFM_METHOD }
function sequentialWeeks(values: readonly number[]): readonly number[] { const weeks: number[] = []; for (let index = 0; index < values.length; index += 7) { const slice = values.slice(index, index + 7); if (slice.length === 7) weeks.push(Math.round(slice.reduce((sum, value) => sum + value, 0) * 100) / 100) } return weeks }
