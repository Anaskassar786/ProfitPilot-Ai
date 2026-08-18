import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { AutomationExecutionService, InMemoryMerchantEmailConfigRepository, InMemoryRunRepository, InMemoryTemplateRepository, InMemoryWorkflowRepository, MerchantEmailVerifier, ThreadLedger } from '@profitpilot/automation'
import { Logger } from '@profitpilot/logger'
import { createApi } from './app.js'

async function withServer<T>(handler: (base: string) => Promise<T>): Promise<T> {
  const workflows = new InMemoryWorkflowRepository()
  const runs = new InMemoryRunRepository()
  const execution = new AutomationExecutionService(runs, { async execute(_store, node, _context, _key, testMode) { return { action: String(node.config.action ?? node.type), testMode } } })
  const app = createApi({ logger: new Logger(), readinessChecks: [], automation: { workflows, runs, execution, templates: new InMemoryTemplateRepository(), emailVerifier: new MerchantEmailVerifier('secret'), tickets: new ThreadLedger() } })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address')
  try { return await handler(`http://127.0.0.1:${address.port}`) } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
}

const definition = { id: 'wf', storeId: 's', name: 'VIP customer tagging', description: 'Tags eligible customers.', category: 'Customer', tags: [], timezone: 'UTC', overlapPolicy: 'SKIP', version: 1, nodes: [{ id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: ['action'] }, { id: 'action', type: 'action', config: { action: 'tag_customer', tag: 'VIP' }, next: [] }] }

describe('F6 automation and marketing APIs', () => {
  it('creates and activates a named workflow with status that survives list refresh', async () => await withServer(async (base) => { const created = await fetch(`${base}/automation/workflows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(definition) }); expect(created.status).toBe(201); const activated = await fetch(`${base}/automation/workflows/wf/activate?storeId=s`, { method: 'POST' }); expect(activated.status).toBe(200); const listed = (await (await fetch(`${base}/automation/workflows?storeId=s`)).json()).data.items[0]; expect(listed).toMatchObject({ name: 'VIP customer tagging', status: 'ACTIVE' }); expect(listed.definitionHash).toHaveLength(64) }))
  it('lists workflow drafts by store', async () => await withServer(async (base) => { await fetch(`${base}/automation/workflows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(definition) }); expect((await (await fetch(`${base}/automation/workflows?storeId=s`)).json()).data.items).toHaveLength(1) }))
  it('enforces the two-workflow trial limit with upgrade context', async () => await withServer(async (base) => { for (const id of ['one','two']) expect((await fetch(`${base}/automation/workflows`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({...definition,id,name:`Workflow ${id}`}) })).status).toBe(201); const blocked=await fetch(`${base}/automation/workflows`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...definition,id:'three',name:'Workflow three'})}); expect(blocked.status).toBe(402); expect((await blocked.json()).error.details.reason).toBe('UPGRADE_REQUIRED') }))
  it('creates a durable manual run and exposes step history', async () => await withServer(async (base) => { await fetch(`${base}/automation/workflows`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(definition)});await fetch(`${base}/automation/workflows/wf/activate?storeId=s`,{method:'POST'});const started=await fetch(`${base}/automation/workflows/wf/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({storeId:'s',context:{customerId:'customer-1'}})});expect(started.status).toBe(202);const run=(await started.json()).data;await new Promise(resolve=>setTimeout(resolve,0));const detail=await (await fetch(`${base}/automation/runs/${run.id}?storeId=s`)).json();expect(detail.data.status).toBe('COMPLETED');expect(detail.data.steps).toHaveLength(2) }))
  it('compiles campaign templates and rejects invalid variables', async () => await withServer(async (base) => { const response = await fetch(`${base}/campaigns/templates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 't', storeId: 's', name: 'Welcome', kind: 'EMAIL', subject: 'Hi {{customer.first_name}}', body: 'Bye {{unsubscribe.url}}' }) }); expect(response.status).toBe(201); const invalid = await fetch(`${base}/campaigns/templates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'bad', storeId: 's', name: 'Bad', kind: 'EMAIL', subject: 'Hi {{bad}}', body: 'No {{unsubscribe.url}}' }) }); expect(invalid.status).toBe(400) }))
  it('exports real rows with the selected writer', async () => await withServer(async (base) => { const response = await fetch(`${base}/exports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format: 'CSV', rows: [{ id: 1, name: 'A' }] }) }); expect(response.status).toBe(200); expect((await response.json()).data.contentType).toContain('csv') }))
  it('creates tickets with plan priority', async () => await withServer(async (base) => { const response = await fetch(`${base}/support/tickets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopId: 's', subject: 'Help', plan: 'commander' }) }); expect(response.status).toBe(201); expect((await response.json()).data.priority).toBe('URGENT') }))
  it('verifies merchant email settings before campaign use', async () => await withServer(async (base) => { const saved = await fetch(`${base}/settings/merchant-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopId: 's', email: 'merchant@example.com', fromName: 'Store' }) }); const token = (await saved.json()).data.verificationToken as string; const verified = await fetch(`${base}/settings/merchant-email/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); expect(verified.status).toBe(200) }))
  it('loads saved merchant email and persists workspace preferences', async () => await withServer(async (base) => {
    await fetch(`${base}/settings/merchant-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopId: 's', email: 'merchant@example.com', fromName: 'Store' }) })
    const loaded = await fetch(`${base}/settings/merchant-email?shopId=s`)
    expect(loaded.status).toBe(200)
    expect((await loaded.json()).data.merchantEmail).toBe('merchant@example.com')
    const saved = await fetch(`${base}/settings/workspace`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: 's', reducedMotion: true, bubbleEnabled: false }) })
    expect(saved.status).toBe(200)
    const workspace = await (await fetch(`${base}/settings/workspace?storeId=s`)).json()
    expect(workspace.data.reducedMotion).toBe(true)
    expect(workspace.data.bubbleEnabled).toBe(false)
  }))
  it('hydrates durable merchant sender state when verification reaches a restarted process', async () => {
    const merchantEmails = new InMemoryMerchantEmailConfigRepository()
    const dependencies = (verifier: MerchantEmailVerifier) => ({ workflows: new InMemoryWorkflowRepository(), templates: new InMemoryTemplateRepository(), emailVerifier: verifier, merchantEmails, tickets: new ThreadLedger() })
    const first = createServer(createApi({ logger: new Logger(), readinessChecks: [], automation: dependencies(new MerchantEmailVerifier('secret')) }))
    await new Promise<void>((resolve) => first.listen(0, '127.0.0.1', resolve)); const firstAddress = first.address(); if (!firstAddress || typeof firstAddress === 'string') throw new Error('No address')
    const saved = await fetch(`http://127.0.0.1:${firstAddress.port}/settings/merchant-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopId: 's', email: 'merchant@example.com', fromName: 'Store' }) }); const token = (await saved.json()).data.verificationToken as string
    await new Promise<void>((resolve) => first.close(() => resolve()))
    const second = createServer(createApi({ logger: new Logger(), readinessChecks: [], automation: dependencies(new MerchantEmailVerifier('secret')) }))
    await new Promise<void>((resolve) => second.listen(0, '127.0.0.1', resolve)); const secondAddress = second.address(); if (!secondAddress || typeof secondAddress === 'string') throw new Error('No address')
    try { const verified = await fetch(`http://127.0.0.1:${secondAddress.port}/settings/merchant-email/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); expect(verified.status).toBe(200); expect((await merchantEmails.get('s'))?.verified).toBe(true) } finally { await new Promise<void>((resolve) => second.close(() => resolve())) }
  })
})
