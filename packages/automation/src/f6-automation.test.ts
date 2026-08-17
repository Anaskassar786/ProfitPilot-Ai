import { describe, expect, it } from 'vitest'
import { storeId } from '@profitpilot/types'
import { DEFAULT_POLICY, WorkflowRunner, InMemoryStepLedger, activateWorkflow, assertPolicy, canAutoExecute, compileTemplate, chooseWinner, renderTemplate, SuppressionLedger, InMemorySendLedger, BatchSender, TrackingService, MerchantEmailVerifier, priorityForPlan, ThreadLedger } from './index.js'
import type { WorkflowDefinition, CampaignTemplate } from './index.js'

const base: WorkflowDefinition = { id: 'wf', storeId: storeId('s'), name: 'Test workflow', description: null, category: 'Operations', tags: [], timezone: 'UTC', overlapPolicy: 'SKIP', version: 1, nodes: [{ id: 'trigger', type: 'trigger', config: { trigger: 'manual' }, next: ['wait'] }, { id: 'wait', type: 'wait', config: { delayMs: 50 }, next: ['condition'] }, { id: 'condition', type: 'condition', config: {}, next: ['tag', 'email'] }, { id: 'tag', type: 'action', config: { action: 'tag_customer', tag: 'VIP' }, next: [] }, { id: 'email', type: 'action', config: { action: 'email' }, next: [] }] }

describe('F6 workflow runner and policy', () => {
  it('runs a wait node and resumes through a condition branch', async () => {
    let now = 100
    const ledger = new InMemoryStepLedger()
    const runner = new WorkflowRunner(ledger, () => now)
    const workflow = activateWorkflow(base, 'now')
    const waiting = await runner.run(workflow, 'run', {}, DEFAULT_POLICY, async () => ({}), true)
    expect(waiting.status).toBe('WAITING')
    now = 200
    const result = await runner.run(workflow, 'run', {}, { ...DEFAULT_POLICY, mode: 'SEMI_AUTOMATIC' }, async (node) => node.id === 'condition' ? { branch: 'NO' } : {}, true)
    expect(result.status).toBe('COMPLETED')
  })
  it('deduplicates completed steps', async () => { const ledger = new InMemoryStepLedger(); const runner = new WorkflowRunner(ledger, () => 100); const workflow = activateWorkflow({ ...base, nodes: [{ ...base.nodes[0]!, next: ['tag'] }, base.nodes[3]!] }, 'now'); let calls = 0; await runner.run(workflow, 'run', {}, { ...DEFAULT_POLICY, mode: 'SEMI_AUTOMATIC' }, async () => { calls += 1; return {} }, true); await runner.run(workflow, 'run', {}, { ...DEFAULT_POLICY, mode: 'SEMI_AUTOMATIC' }, async () => { calls += 1; return {} }, true); expect(calls).toBe(2) })
  it('keeps manual mode safe for high-risk actions', () => expect(canAutoExecute(DEFAULT_POLICY, 'EMAIL', false)).toBe(false))
  it('allows approved semi-automatic email', () => expect(canAutoExecute({ ...DEFAULT_POLICY, mode: 'SEMI_AUTOMATIC' }, 'EMAIL', true)).toBe(true))
  it('enforces automation caps', () => expect(() => assertPolicy(DEFAULT_POLICY, 'TAG_CUSTOMER', false, 10, 0)).toThrow('approval'))
})

describe('F6 closed campaign templates', () => {
  const template: Omit<CampaignTemplate, 'variables'> = { id: 't', storeId: 's', name: 'Welcome', kind: 'EMAIL', subject: 'Welcome {{customer.first_name}}', body: 'Thanks {{customer.first_name}} {{unsubscribe.url}}' }
  it('compiles the closed variable set', () => expect(compileTemplate(template).variables).toEqual(['customer.first_name', 'unsubscribe.url']))
  it('renders only provided variables', () => expect(renderTemplate(compileTemplate(template), { 'customer.first_name': 'Asha', 'unsubscribe.url': 'https://u' }).subject).toBe('Welcome Asha'))
  it('rejects unknown variables', () => expect(() => compileTemplate({ ...template, body: 'Hi {{secret.value}}' })).toThrow('Invalid'))
  it('requires unsubscribe on email', () => expect(() => compileTemplate({ ...template, body: 'No unsubscribe' })).toThrow('unsubscribe'))
  it('rejects missing values honestly', () => expect(() => renderTemplate(compileTemplate(template), { 'customer.first_name': 'Asha' })).toThrow('Missing'))
  it('selects a winner after minimum sends', () => expect(chooseWinner([{ id: 'a', name: 'A', sends: 50, opens: 20, clicks: 4, attributedRevenue: 10 }, { id: 'b', name: 'B', sends: 50, opens: 30, clicks: 2, attributedRevenue: 8 }], 'OPEN_RATE')?.id).toBe('b'))
  it('returns no winner before sample size', () => expect(chooseWinner([{ id: 'a', name: 'A', sends: 2, opens: 2, clicks: 1, attributedRevenue: 10 }], 'REVENUE')).toBeNull())
})

describe('F6 tracking and compliant batching', () => {
  it('creates and verifies HMAC open/click tokens', () => { const tracker = new TrackingService('secret'); const token = tracker.createToken({ storeId: 's', campaignId: 'c', messageId: 'm', kind: 'CLICK', target: '/offer', expiresAt: 2000 }); expect(tracker.verifyToken(token, 100).target).toBe('/offer'); expect(tracker.clickUrl(token)).toContain('/tracking/click'); expect(tracker.pixelUrl(token)).toContain('/tracking/open') })
  it('rejects tampered tracking tokens', () => { const tracker = new TrackingService('secret'); const token = tracker.createToken({ storeId: 's', campaignId: 'c', messageId: 'm', kind: 'OPEN', target: null, expiresAt: 2000 }); expect(() => tracker.verifyToken(`${token}x`, 100)).toThrow('Invalid') })
  it('suppresses, deduplicates, and batches at fifty', async () => { const suppression = new SuppressionLedger(); suppression.suppress({ shopId: 's', recipientKey: 'blocked', reason: 'UNSUBSCRIBED', createdAt: 1 }); const sent: string[] = []; const sender = new BatchSender({ send: async (message) => { sent.push(message.to); return { messageId: `sent-${sent.length}` } } }, suppression, new InMemorySendLedger(), 2); const rows = [{ shopId: 's', recipientKey: 'a', jobId: '1', messageId: 'm1', to: 'a@example.com', from: 'merchant@example.com', fromName: 'Store', subject: 'Hi', html: 'Hi' }, { shopId: 's', recipientKey: 'blocked', jobId: '2', messageId: 'm2', to: 'b@example.com', from: 'merchant@example.com', fromName: 'Store', subject: 'Hi', html: 'Hi' }, { shopId: 's', recipientKey: 'a', jobId: '1', messageId: 'm1', to: 'a@example.com', from: 'merchant@example.com', fromName: 'Store', subject: 'Hi', html: 'Hi' }]; const result = await sender.send(rows); expect(result.sent).toBe(1); expect(result.suppressed).toBe(1); expect(result.deduped).toBe(1); expect(sent).toEqual(['a@example.com']) })
})

describe('F6 merchant email and support ledger', () => {
  it('verifies merchant email before campaign send', () => { const verifier = new MerchantEmailVerifier('secret'); verifier.save('s', 'merchant@example.com', 'Store'); const token = verifier.token('s', 'merchant@example.com', 2000); expect(verifier.verify(token, 100).verified).toBe(true) })
  it('prioritizes support by plan', () => { expect(priorityForPlan('commander')).toBe('URGENT'); expect(priorityForPlan('growth')).toBe('HIGH'); expect(priorityForPlan('start')).toBe('NORMAL') })
  it('keeps support threads auditable and CAS-safe', () => { const ledger = new ThreadLedger(); ledger.create({ id: 't', shopId: 's', subject: 'Help', priority: 'HIGH', status: 'OPEN', createdAt: 1, updatedAt: 1, version: 0 }); ledger.addMessage({ id: 'm', ticketId: 't', author: 'MERCHANT', body: 'Help', createdAt: 2 }); expect(ledger.messagesFor('t')).toHaveLength(1); expect(ledger.setStatus('t', 'IN_PROGRESS', 1).status).toBe('IN_PROGRESS') })
})
