import { randomUUID } from 'node:crypto'
import { collectNumbers } from '@profitpilot/ai'
import type { ActionExecutionResult, AiCommandActionRecord, AiCommandActionRuntime, AiCommandToolRuntime, ToolCall, ToolOutcome } from '@profitpilot/ai'
import type { StoreId } from '@profitpilot/types'
import { ShopifyClient } from '@profitpilot/shopify'
import type { TokenVault } from '@profitpilot/shopify'
import type { StoreDirectory } from '@profitpilot/db'
import type { CustomerRepository } from './customers.js'
import type { OrderRepository } from './orders.js'
import type { InventoryRepository } from './inventory.js'
import { inventoryHealth } from './inventory.js'
import type { AnalyticsSnapshot } from '@profitpilot/db'

export type AnalyticsReader = Readonly<{ read(storeId: StoreId): Promise<AnalyticsSnapshot>; readCatalog(storeId: StoreId): Promise<readonly Readonly<{ productId: string; payload: Record<string, unknown> }>[]> }>
export type RecommendationReader = Readonly<{ list(storeId: StoreId): Promise<readonly Readonly<Record<string, unknown>>[]> }>
export type RecommendationDecider = Readonly<{ decidePending(storeId: StoreId, id: string, status: 'APPROVED' | 'REJECTED', extras?: Readonly<Record<string, unknown>>): Promise<unknown> }>
export type EmailSender = Readonly<{ send(input: Readonly<{ to: string; subject: string; html: string; storeId: string }>): Promise<Readonly<{ messageId: string }>> }>
export type WorkflowTrigger = Readonly<{ trigger(storeId: string, workflowId: string): Promise<Readonly<{ runId: string; status: string }>> }>
export type WorkflowReader = Readonly<{ list(storeId: string, query?: Readonly<Record<string, unknown>>): Promise<Readonly<{ items: readonly Readonly<Record<string, unknown>>[]; total?: number }>> }>
export type WorkflowController = WorkflowTrigger & Readonly<{ setStatus(storeId: string, workflowId: string, status: 'PAUSED' | 'ACTIVE'): Promise<Readonly<Record<string, unknown>> | null> }>
export type ReportGenerator = Readonly<{ generate(storeId: string, reportType: string, dateRange: string): Promise<unknown> }>
export type NotificationWriter = Readonly<{ create(storeId: string, title: string, message: string, priority: string): Promise<Readonly<{ id: string }>> }>

export class ProductionCommandTools implements AiCommandToolRuntime {
  public constructor(private readonly deps: Readonly<{
    customers?: Pick<CustomerRepository, 'list'>
    orders?: Pick<OrderRepository, 'list'>
    inventory?: Pick<InventoryRepository, 'list'>
    analytics?: AnalyticsReader
    recommendations?: RecommendationReader
    workflows?: WorkflowReader
  }>) {}

  public async run(storeId: StoreId, call: ToolCall): Promise<ToolOutcome> {
    try {
      if (call.name === 'search_customers') return this.customers(storeId, call)
      if (call.name === 'search_products') return this.products(storeId, call)
      if (call.name === 'search_orders') return this.orders(storeId, call)
      if (call.name === 'get_analytics') return this.analytics(storeId, call)
      if (call.name === 'get_recommendations') return this.recommendations(storeId, call)
      if (call.name === 'get_inventory_status') return this.inventory(storeId, call)
      if (call.name === 'get_store_health') return this.health(storeId)
      if (call.name === 'list_workflows') return this.workflows(storeId, call)
      return { ok: false, name: call.name, error: 'This tool is not a read query.', source: call.name }
    } catch (error: unknown) {
      return { ok: false, name: call.name, error: error instanceof Error ? error.message : 'The data source failed.', source: call.name }
    }
  }

  private async workflows(storeId: StoreId, call: ToolCall): Promise<ToolOutcome> {
    if (!this.deps.workflows) return missing(call.name, 'Automations have not been set up yet.')
    const status = typeof call.params.status === 'string' && call.params.status.trim() ? call.params.status.toUpperCase() : ''
    const query = typeof call.params.query === 'string' && call.params.query.trim() ? call.params.query.trim() : ''
    const page = await this.deps.workflows.list(storeId, { ...(status ? { status } : {}), ...(query ? { search: query } : {}), limit: 20 })
    const items = (page.items ?? []).map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      status: workflow.status,
      category: workflow.category,
      nodeCount: workflow.nodeCount,
      lastRunAt: workflow.lastRunAt ?? null,
      successCount: workflow.successCount ?? 0,
      failureCount: workflow.failureCount ?? 0,
    }))
    return ok(call.name, { count: items.length, total: typeof page.total === 'number' ? page.total : items.length, items }, 'automation_workflows')
  }

  private async customers(storeId: StoreId, call: ToolCall): Promise<ToolOutcome> {
    if (!this.deps.customers) return missing(call.name, 'Customers have not been synced yet.')
    const dataset = await this.deps.customers.list(storeId)
    const query = String(call.params.query ?? '').toLowerCase()
    const limit = boundedLimit(call.params.limit)
    const matched = dataset.customers.filter((customer) => {
      if (!query) return true
      return [customer.displayName, customer.email, customer.id, customer.primarySegment, ...customer.tags].some((value) => value?.toLowerCase().includes(query.replace(/show|my|top|customers?/g, '').trim()) || query.includes('vip') && customer.primarySegment === 'vip' || query.includes('inactive') && customer.activity === 'inactive')
    }).slice(0, limit)
    const items = matched.map((customer) => ({
      id: customer.id,
      displayName: customer.displayName,
      email: customer.email,
      totalSpent: customer.totalSpent,
      lifetimeOrders: customer.lifetimeOrders,
      activity: customer.activity,
      tags: customer.tags,
      primarySegment: customer.primarySegment,
    }))
    const data = { count: items.length, total: dataset.customers.length, items, coverage: dataset.coverage.explanation }
    return ok(call.name, data, 'sync_records.customers')
  }

  private async products(storeId: StoreId, call: ToolCall): Promise<ToolOutcome> {
    if (!this.deps.analytics) return missing(call.name, 'The product catalog has not been synced yet.')
    const catalog = await this.deps.analytics.readCatalog(storeId)
    const query = String(call.params.query ?? '').toLowerCase()
    const limit = boundedLimit(call.params.limit)
    const items = catalog
      .map((product) => ({ id: product.productId, title: typeof product.payload.title === 'string' ? product.payload.title : product.productId, status: product.payload.status ?? null, vendor: product.payload.vendor ?? null }))
      .filter((product) => !query || product.title.toLowerCase().includes(query.replace(/show|my|products?|catalog/g, '').trim()) || query.includes('product'))
      .slice(0, limit)
    return ok(call.name, { count: items.length, items }, 'catalog_products')
  }

  private async orders(storeId: StoreId, call: ToolCall): Promise<ToolOutcome> {
    if (!this.deps.orders) return missing(call.name, 'Orders have not been synced yet.')
    const rows = await this.deps.orders.list(storeId)
    const query = String(call.params.query ?? '').toLowerCase()
    const limit = boundedLimit(call.params.limit)
    const items = rows
      .filter((order) => !query || [order.orderNumber, order.customer.name, order.status, order.id].some((value) => value?.toLowerCase().includes(query.replace(/show|recent|orders?/g, '').trim()) || query.includes('order')))
      .slice(0, limit)
      .map((order) => ({ id: order.id, orderNumber: order.orderNumber, totalPrice: order.totalPrice, currency: order.currency, status: order.status, createdAt: order.createdAt }))
    return ok(call.name, { count: items.length, items }, 'sync_records.orders')
  }

  private async analytics(storeId: StoreId, call: ToolCall): Promise<ToolOutcome> {
    if (!this.deps.analytics) return missing(call.name, 'Analytics have not been synced yet.')
    const snapshot = await this.deps.analytics.read(storeId)
    if (snapshot.revenue.length === 0 && snapshot.orders.length === 0) return missing(call.name, 'No closed-period analytics rows are available yet.')
    const days = rangeDays(String(call.params.date_range ?? '30d'))
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const previousCutoff = new Date(Date.now() - days * 2 * 86_400_000).toISOString().slice(0, 10)
    const current = snapshot.revenue.filter((row) => row.day >= cutoff)
    const previous = snapshot.revenue.filter((row) => row.day >= previousCutoff && row.day < cutoff)
    const orders = snapshot.orders.filter((row) => row.day >= cutoff)
    const revenue = current.reduce((sum, row) => sum + row.grossRevenue, 0)
    const previousRevenue = previous.reduce((sum, row) => sum + row.grossRevenue, 0)
    const orderCount = orders.reduce((sum, row) => sum + row.orderCount, 0)
    const data = {
      revenue,
      previousRevenue,
      orders: orderCount,
      aov: orderCount > 0 ? revenue / orderCount : null,
      days,
      sourceDays: current.map((row) => row.day),
    }
    return ok(call.name, data, 'analytics_revenue_daily')
  }

  private async recommendations(storeId: StoreId, call: ToolCall): Promise<ToolOutcome> {
    if (!this.deps.recommendations) return missing(call.name, 'Recommendations are not available yet.')
    const rows = await this.deps.recommendations.list(storeId)
    const status = typeof call.params.status === 'string' ? call.params.status : ''
    const limit = boundedLimit(call.params.limit)
    const items = rows
      .filter((row) => !status || String(row.status ?? '') === status)
      .slice(0, limit)
      .map((row) => ({ id: row.id, title: row.title, status: row.status, version: row.version, agent: row.agent, impactValue: row.impactValue }))
    return ok(call.name, { count: items.length, items }, 'ai_recommendations')
  }

  private async inventory(storeId: StoreId, call: ToolCall): Promise<ToolOutcome> {
    if (!this.deps.inventory) return missing(call.name, 'Inventory has not been synced yet.')
    const dataset = await this.deps.inventory.list(storeId)
    const filter = String(call.params.filter ?? 'all')
    const items = dataset.items
      .filter((item) => filter === 'low' ? item.status === 'low' || item.status === 'out' : true)
      .slice(0, boundedLimit(call.params.limit ?? 20))
      .map((item) => ({ variantId: item.variantId, title: item.title, quantity: item.quantity, status: item.status }))
    const data = {
      lowStockCount: dataset.items.filter((item) => item.status === 'low').length,
      outOfStockCount: dataset.items.filter((item) => item.status === 'out').length,
      items,
      coverage: dataset.coverage.explanation,
    }
    return ok(call.name, data, dataset.coverage.quantitySource)
  }

  private async health(storeId: StoreId): Promise<ToolOutcome> {
    const analytics = this.deps.analytics ? await this.deps.analytics.read(storeId) : null
    const inventory = this.deps.inventory ? await this.deps.inventory.list(storeId) : null
    const revenue = analytics?.revenue.reduce((sum, row) => sum + row.grossRevenue, 0) ?? 0
    const orders = analytics?.orders.reduce((sum, row) => sum + row.orderCount, 0) ?? 0
    const stock = inventory ? inventoryHealth(inventory.items) : null
    let score = 35
    if (revenue > 0) score += 25
    if (orders > 0) score += 20
    if ((analytics?.productSales.length ?? 0) > 0) score += 10
    if (stock?.score !== null && stock) score = Math.round((score + stock.score) / 2)
    score = Math.min(100, score)
    const label = score >= 75 ? 'Healthy' : score >= 50 ? 'Needs attention' : 'Critical'
    if (!analytics && !inventory) return missing('get_store_health', 'Store health cannot be scored until analytics or inventory rows exist.')
    return ok('get_store_health', { score, label, revenue, orders, inventoryScore: stock?.score ?? null }, 'analytics + inventory')
  }
}

export class ProductionCommandActions implements AiCommandActionRuntime {
  public constructor(private readonly deps: Readonly<{
    customers?: Pick<CustomerRepository, 'list' | 'get'>
    email?: EmailSender
    shopify?: Readonly<{ directory: StoreDirectory; tokens: TokenVault; apiVersion?: string }>
    recommendations?: RecommendationDecider
    workflows?: WorkflowController
    reports?: ReportGenerator
    notifications?: NotificationWriter
  }>) {}

  public async execute(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    if (action.actionType === 'SEND_EMAIL') return this.sendEmail(storeId, action)
    if (action.actionType === 'TAG_CUSTOMER') return this.tagCustomers(storeId, action)
    if (action.actionType === 'CREATE_DISCOUNT') return this.createDiscount(storeId, action)
    if (action.actionType === 'APPROVE_RECOMMENDATION') return this.approveRecommendation(storeId, action)
    if (action.actionType === 'TRIGGER_WORKFLOW') return this.triggerWorkflow(storeId, action)
    if (action.actionType === 'PAUSE_WORKFLOW') return this.pauseWorkflow(storeId, action)
    if (action.actionType === 'RESUME_WORKFLOW') return this.resumeWorkflow(storeId, action)
    if (action.actionType === 'SEND_NOTIFICATION') return this.notify(storeId, action)
    if (action.actionType === 'GENERATE_REPORT') return this.report(storeId, action)
    return { status: 'FAILED', result: { message: 'Unknown action type.' }, errorDetails: { reason: 'UNKNOWN_ACTION' }, rollbackAvailable: false }
  }

  public async rollback(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    if (action.actionType === 'TAG_CUSTOMER') {
      return this.tagCustomers(storeId, { ...action, actionParams: { ...action.actionParams, action: action.actionParams.action === 'remove' ? 'add' : 'remove' } })
    }
    if (action.actionType === 'CREATE_DISCOUNT') {
      const client = await this.shopify(storeId)
      if (!client.ok) return { status: 'FAILED', result: { message: client.error }, errorDetails: { reason: client.error }, rollbackAvailable: false }
      const id = isRecord(action.executionResult) ? action.executionResult.discountId : null
      if (typeof id !== 'string' || !id) return { status: 'FAILED', result: { message: 'No Shopify discount id is available to deactivate.' }, rollbackAvailable: false }
      const query = 'mutation discountCodeDeactivate($id: ID!) { discountCodeDeactivate(id: $id) { userErrors { message } } }'
      const result = await client.client.request<{ data: { discountCodeDeactivate: { userErrors: readonly { message: string }[] } } }>({ method: 'POST', path: '/graphql.json', body: JSON.stringify({ query, variables: { id } }) })
      const errors = result.data.data.discountCodeDeactivate.userErrors
      if (errors.length) return { status: 'FAILED', result: { message: errors[0]?.message }, rollbackAvailable: false }
      return { status: 'SUCCESS', result: { rolledBack: true, discountId: id }, rollbackAvailable: false }
    }
    return { status: 'FAILED', result: { message: 'This action cannot be undone.' }, rollbackAvailable: false }
  }

  private async sendEmail(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    if (!this.deps.email) return { status: 'FAILED', result: { sent: 0, failed: 0, message: 'Email could not be sent: SMTP is not configured.' }, errorDetails: { reason: 'SMTP_NOT_CONFIGURED' }, rollbackAvailable: false }
    const ids = stringArray(action.actionParams.recipient_ids)
    const subject = String(action.actionParams.subject ?? 'A note from your store')
    const body = String(action.actionParams.body ?? '')
    if (ids.length === 0) return { status: 'FAILED', result: { sent: 0, failed: 0, message: 'No recipients were selected.' }, rollbackAvailable: false }
    if (!this.deps.customers) return { status: 'FAILED', result: { sent: 0, failed: ids.length, message: 'Customer records are not available to resolve recipients.' }, rollbackAvailable: false }
    const dataset = await this.deps.customers.list(storeId)
    const reasons: string[] = []
    let sent = 0
    let failed = 0
    for (const id of ids) {
      const customer = dataset.customers.find((item) => item.id === id)
      if (!customer?.email) { failed += 1; reasons.push(`${id} has no email`); continue }
      if (!customer.canEmail) { failed += 1; reasons.push(`${customer.email} — ${customer.emailDisabledReason ?? 'consent missing'}`); continue }
      try {
        await this.deps.email.send({ to: customer.email, subject, html: body.replaceAll('{first_name}', customer.firstName ?? 'there'), storeId })
        sent += 1
      } catch (error: unknown) {
        failed += 1
        reasons.push(`${customer.email} — ${error instanceof Error ? error.message : 'send failed'}`)
      }
    }
    const status = failed === 0 ? 'SUCCESS' : sent === 0 ? 'FAILED' : 'PARTIAL_SUCCESS'
    return { status, result: { sent, failed, reasons, total: ids.length }, errorDetails: failed > 0 ? { reasons } : undefined, rollbackAvailable: false }
  }

  private async tagCustomers(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    const client = await this.shopify(storeId)
    if (!client.ok) return { status: 'FAILED', result: { updated: 0, failed: stringArray(action.actionParams.customer_ids).length, message: client.error }, errorDetails: { reason: client.error }, rollbackAvailable: false }
    const ids = stringArray(action.actionParams.customer_ids)
    const tags = stringArray(action.actionParams.tags)
    const mode = action.actionParams.action === 'remove' ? 'remove' : 'add'
    let updated = 0
    let failed = 0
    const reasons: string[] = []
    for (const id of ids) {
      try {
        const current = await client.client.request<{ customer: { id: number | string; tags: string } }>({ path: `/customers/${encodeURIComponent(id)}.json` })
        const next = new Set(current.data.customer.tags.split(',').map((tag) => tag.trim()).filter(Boolean))
        for (const tag of tags) {
          if (mode === 'remove') next.delete(tag)
          else next.add(tag)
        }
        await client.client.request({ method: 'PUT', path: `/customers/${encodeURIComponent(id)}.json`, body: JSON.stringify({ customer: { id, tags: [...next].join(', ') } }) })
        updated += 1
      } catch (error: unknown) {
        failed += 1
        reasons.push(`${id} — ${error instanceof Error ? error.message : 'Shopify tag update failed'}`)
      }
    }
    const status = failed === 0 ? 'SUCCESS' : updated === 0 ? 'FAILED' : 'PARTIAL_SUCCESS'
    return { status, result: { updated, failed, reasons }, errorDetails: failed > 0 ? { reasons } : undefined, rollbackAvailable: updated > 0 }
  }

  private async createDiscount(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    const client = await this.shopify(storeId)
    if (!client.ok) return { status: 'FAILED', result: { message: client.error }, errorDetails: { reason: client.error }, rollbackAvailable: false }
    const value = Number(action.actionParams.value)
    const usageLimit = Number(action.actionParams.usage_limit ?? action.actionParams.usageLimit)
    const title = String(action.actionParams.title ?? 'AI Command discount')
    const expiresAt = String(action.actionParams.expires_at ?? action.actionParams.expiresAt ?? '')
    const code = `PP-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`
    const query = 'mutation CreateDiscount($input: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message } } }'
    const variables = { input: { title, code, startsAt: new Date().toISOString(), endsAt: expiresAt, usageLimit, customerSelection: { all: true }, customerGets: { value: { percentage: value / 100 }, items: { all: true } } } }
    try {
      const result = await client.client.request<{ data: { discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: readonly { message: string }[] } } }>({ method: 'POST', path: '/graphql.json', body: JSON.stringify({ query, variables }) })
      const payload = result.data.data.discountCodeBasicCreate
      if (payload.userErrors.length || !payload.codeDiscountNode?.id) {
        return { status: 'FAILED', result: { message: payload.userErrors[0]?.message ?? 'Shopify did not return a discount code.' }, rollbackAvailable: false }
      }
      return { status: 'SUCCESS', result: { code, discountId: payload.codeDiscountNode.id, title }, rollbackAvailable: true }
    } catch (error: unknown) {
      return { status: 'FAILED', result: { message: error instanceof Error ? error.message : 'Shopify discount create failed.' }, rollbackAvailable: false }
    }
  }

  private async approveRecommendation(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    if (!this.deps.recommendations) return { status: 'FAILED', result: { message: 'Recommendation approval is not connected.' }, rollbackAvailable: false }
    const id = String(action.actionParams.recommendation_id ?? '')
    if (!id) return { status: 'FAILED', result: { message: 'A recommendation id is required.' }, rollbackAvailable: false }
    try {
      const result = await this.deps.recommendations.decidePending(storeId, id, 'APPROVED', { decidedBy: 'ai-command' })
      return { status: 'SUCCESS', result: { message: 'Recommendation approved.', recommendation: result }, rollbackAvailable: false }
    } catch (error: unknown) {
      return { status: 'FAILED', result: { message: error instanceof Error ? error.message : 'Approval failed.' }, rollbackAvailable: false }
    }
  }

  private async triggerWorkflow(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    if (!this.deps.workflows) return { status: 'FAILED', result: { message: 'Workflow trigger is not connected.' }, rollbackAvailable: false }
    const workflowId = String(action.actionParams.workflow_id ?? '')
    if (!workflowId) return { status: 'FAILED', result: { message: 'A workflow id is required.' }, rollbackAvailable: false }
    try {
      const result = await this.deps.workflows.trigger(storeId, workflowId)
      return { status: 'SUCCESS', result: { runId: result.runId, status: result.status }, rollbackAvailable: false }
    } catch (error: unknown) {
      return { status: 'FAILED', result: { message: error instanceof Error ? error.message : 'Workflow trigger failed.' }, rollbackAvailable: false }
    }
  }

  private async pauseWorkflow(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    return this.setWorkflowStatus(storeId, action, 'PAUSED')
  }

  private async resumeWorkflow(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    return this.setWorkflowStatus(storeId, action, 'ACTIVE')
  }

  private async setWorkflowStatus(storeId: StoreId, action: AiCommandActionRecord, status: 'PAUSED' | 'ACTIVE'): Promise<ActionExecutionResult> {
    if (!this.deps.workflows) return { status: 'FAILED', result: { message: 'Workflow control is not connected.' }, rollbackAvailable: false }
    const workflowId = String(action.actionParams.workflow_id ?? '')
    if (!workflowId) return { status: 'FAILED', result: { message: 'I could not tell which automation you mean. Try naming it, e.g. "Pause the welcome email automation".' }, rollbackAvailable: false }
    try {
      const updated = await this.deps.workflows.setStatus(storeId, workflowId, status)
      if (!updated) return { status: 'FAILED', result: { message: 'That automation was not found. Check the Automation page for its current name and status.' }, rollbackAvailable: false }
      return { status: 'SUCCESS', result: { workflowId, status, name: isRecord(updated) && typeof updated.name === 'string' ? updated.name : null }, rollbackAvailable: false }
    } catch (error: unknown) {
      return { status: 'FAILED', result: { message: error instanceof Error ? error.message : 'Workflow status could not be changed.' }, rollbackAvailable: false }
    }
  }

  private async notify(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    if (!this.deps.notifications) return { status: 'FAILED', result: { message: 'Notifications are not connected.' }, rollbackAvailable: false }
    try {
      const created = await this.deps.notifications.create(storeId, String(action.actionParams.title ?? 'AI Command'), String(action.actionParams.message ?? ''), String(action.actionParams.priority ?? 'NORMAL'))
      return { status: 'SUCCESS', result: { id: created.id, message: 'Notification created.' }, rollbackAvailable: true }
    } catch (error: unknown) {
      return { status: 'FAILED', result: { message: error instanceof Error ? error.message : 'Notification failed.' }, rollbackAvailable: false }
    }
  }

  private async report(storeId: StoreId, action: AiCommandActionRecord): Promise<ActionExecutionResult> {
    if (!this.deps.reports) return { status: 'FAILED', result: { message: 'Report generation is not connected.' }, rollbackAvailable: false }
    try {
      const generated = await this.deps.reports.generate(storeId, String(action.actionParams.report_type ?? 'WEEKLY'), String(action.actionParams.date_range ?? '7d'))
      return { status: 'SUCCESS', result: generated, rollbackAvailable: false }
    } catch (error: unknown) {
      return { status: 'FAILED', result: { message: error instanceof Error ? error.message : 'Report generation failed.' }, rollbackAvailable: false }
    }
  }

  private async shopify(storeId: StoreId): Promise<Readonly<{ ok: true; client: ShopifyClient }> | Readonly<{ ok: false; error: string }>> {
    if (!this.deps.shopify) return { ok: false, error: 'Shopify is not connected for this store.' }
    const connection = await this.deps.shopify.directory.get(storeId)
    if (!connection) return { ok: false, error: 'Shopify store is not connected.' }
    const token = await this.deps.shopify.tokens.get(connection.shopDomain)
    if (!token) return { ok: false, error: 'Shopify access token is missing.' }
    return { ok: true, client: new ShopifyClient(connection.shopDomain, token, fetch, this.deps.shopify.apiVersion ?? '2025-10') }
  }
}

function ok(name: ToolCall['name'], data: unknown, source: string): ToolOutcome {
  return { ok: true, name, data, source, numbers: [...collectNumbers(data)] }
}
function missing(name: ToolCall['name'], error: string): ToolOutcome {
  return { ok: false, name, error, source: name }
}
function boundedLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 20
  return Number.isFinite(parsed) ? Math.min(50, Math.max(1, Math.round(parsed))) : 20
}
function rangeDays(value: string): number {
  if (value === '1d') return 1
  if (value === '7d') return 7
  if (value === '365d') return 365
  return 30
}
function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
