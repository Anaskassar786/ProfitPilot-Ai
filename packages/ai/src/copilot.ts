import { randomUUID } from 'node:crypto'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { EvidenceField } from './evidence.js'
import type { JarvisPage } from './jarvis.js'

export const COPILOT_INTENTS = ['REVENUE_SUMMARY', 'REVENUE_CHANGE', 'TOP_PRODUCTS', 'STOCKOUT_RISK', 'DEAD_STOCK', 'CUSTOMER_CHURN', 'ORDER_SUMMARY', 'CAMPAIGN_PERFORMANCE', 'BILLING_USAGE', 'STORE_HEALTH'] as const
export type CopilotIntent = (typeof COPILOT_INTENTS)[number]
export type CopilotConfidence = 'HIGH' | 'MEDIUM' | 'LOW'
export type CopilotFact = EvidenceField
export type CopilotEvidence = Readonly<{ intent: CopilotIntent; page: JarvisPage; facts: readonly CopilotFact[]; generatedAt: string; confidence: number; confidenceLevel: CopilotConfidence }>
export type CopilotNumberSlot = Readonly<{ name: string; value: number; formatted: string; source: string }>
export type CopilotAnswer = Readonly<{ id: string; storeId: StoreId; threadId: string; query: string; intent: CopilotIntent | null; answer: string; clarification: string | null; evidence: CopilotEvidence | null; slots: readonly CopilotNumberSlot[]; createdAt: number }>
export type CopilotThread = Readonly<{ id: string; storeId: StoreId; title: string; createdAt: number; updatedAt: number }>

export interface CopilotEvidenceProvider {
  get(storeId: StoreId, intent: CopilotIntent, page: JarvisPage): Promise<CopilotEvidence>
}

export interface CopilotRepository {
  createThread(thread: CopilotThread): Promise<CopilotThread>
  getThread(storeId: StoreId, threadId: string): Promise<CopilotThread | null>
  listThreads(storeId: StoreId): Promise<readonly CopilotThread[]>
  appendAnswer(answer: CopilotAnswer): Promise<void>
  listAnswers(storeId: StoreId, threadId: string): Promise<readonly CopilotAnswer[]>
}

export class InMemoryCopilotRepository implements CopilotRepository {
  private readonly threads = new Map<string, CopilotThread>()
  private readonly answers = new Map<string, CopilotAnswer[]>()
  public async createThread(thread: CopilotThread): Promise<CopilotThread> { this.threads.set(thread.id, thread); return thread }
  public async getThread(storeId: StoreId, threadId: string): Promise<CopilotThread | null> { const thread = this.threads.get(threadId); return thread?.storeId === storeId ? thread : null }
  public async listThreads(storeId: StoreId): Promise<readonly CopilotThread[]> { return [...this.threads.values()].filter((thread) => thread.storeId === storeId).sort((a, b) => b.updatedAt - a.updatedAt) }
  public async appendAnswer(answer: CopilotAnswer): Promise<void> { const current = this.answers.get(answer.threadId) ?? []; current.push(answer); this.answers.set(answer.threadId, current); const thread = this.threads.get(answer.threadId); if (thread) this.threads.set(thread.id, { ...thread, updatedAt: answer.createdAt }) }
  public async listAnswers(storeId: StoreId, threadId: string): Promise<readonly CopilotAnswer[]> { const thread = await this.getThread(storeId, threadId); return thread ? [...(this.answers.get(threadId) ?? [])] : [] }
}

export class CopilotService {
  private readonly evidenceProvider: CopilotEvidenceProvider
  private readonly repository: CopilotRepository
  private readonly now: () => number

  public constructor(evidenceProvider: CopilotEvidenceProvider, repository: CopilotRepository, now: () => number = () => Date.now()) { this.evidenceProvider = evidenceProvider; this.repository = repository; this.now = now }

  public async listThreads(storeId: StoreId): Promise<readonly CopilotThread[]> { return this.repository.listThreads(storeId) }
  public async threadAnswers(storeId: StoreId, threadId: string): Promise<readonly CopilotAnswer[]> { return this.repository.listAnswers(storeId, threadId) }

  public async query(input: Readonly<{ storeId: StoreId; query: string; page: JarvisPage; threadId?: string }>): Promise<CopilotAnswer> {
    const query = input.query.trim().slice(0, 500)
    if (!query) throw new AppError('VALIDATION_ERROR', 'Copilot query cannot be empty', 400)
    const intent = parseCopilotIntent(query)
    const now = this.now()
    const thread = input.threadId ? await this.repository.getThread(input.storeId, input.threadId) : null
    if (input.threadId && !thread) throw new AppError('NOT_FOUND', 'Copilot thread not found', 404)
    const actualThread = thread ?? await this.repository.createThread({ id: randomUUID(), storeId: input.storeId, title: query.slice(0, 80), createdAt: now, updatedAt: now })
    if (!intent) {
      const answer: CopilotAnswer = { id: randomUUID(), storeId: input.storeId, threadId: actualThread.id, query, intent: null, answer: 'I can answer revenue, revenue change, top products, stockout risk, dead stock, customer churn, order summary, campaign performance, billing usage, or store health.', clarification: 'Which supported store question should I answer?', evidence: null, slots: [], createdAt: now }
      await this.repository.appendAnswer(answer)
      return answer
    }
    const evidence = await this.evidenceProvider.get(input.storeId, intent, input.page)
    const slots = evidence.facts.filter((fact): fact is EvidenceField & { value: number } => typeof fact.value === 'number' && Number.isFinite(fact.value)).map((fact, index) => ({ name: `N${index + 1}`, value: fact.value, formatted: formatNumber(fact.value), source: fact.source }))
    const answer: CopilotAnswer = { id: randomUUID(), storeId: input.storeId, threadId: actualThread.id, query, intent, answer: renderCopilotAnswer(intent, evidence, slots), clarification: null, evidence, slots, createdAt: now }
    await this.repository.appendAnswer(answer)
    return answer
  }

  public async createThread(storeId: StoreId, title: string): Promise<CopilotThread> { const now = this.now(); return this.repository.createThread({ id: randomUUID(), storeId, title: title.trim().slice(0, 80) || 'Copilot thread', createdAt: now, updatedAt: now }) }
}

export function parseCopilotIntent(query: string): CopilotIntent | null {
  const normalized = query.toLowerCase()
  if (/\b(revenue|sales)\b/.test(normalized) && (/\b(today|yesterday|summary|total|month|week)\b/.test(normalized) || /\b(what is|how much|show)\b/.test(normalized))) return 'REVENUE_SUMMARY'
  if (/\b(revenue|sales).*(change|drop|increase|decrease|trend|compare|versus|vs)/.test(normalized)) return 'REVENUE_CHANGE'
  if (/\b(top|best|selling|seller|products?)/.test(normalized) && !/stockout|dead/.test(normalized)) return 'TOP_PRODUCTS'
  if (/stockout|out of stock|low stock|days of cover/.test(normalized)) return 'STOCKOUT_RISK'
  if (/dead stock|not selling|slow moving|no sale/.test(normalized)) return 'DEAD_STOCK'
  if (/churn|inactive customers?|customer risk|lost customers?/.test(normalized)) return 'CUSTOMER_CHURN'
  if (/orders?|cancellations?|fulfil|fulfill/.test(normalized)) return 'ORDER_SUMMARY'
  if (/campaign|email|ab test|a\/b|marketing/.test(normalized)) return 'CAMPAIGN_PERFORMANCE'
  if (/billing|usage|limit|plan|upgrade/.test(normalized)) return 'BILLING_USAGE'
  if (/health|healthy|status|alerts?/.test(normalized)) return 'STORE_HEALTH'
  return null
}

export function renderCopilotAnswer(intent: CopilotIntent, evidence: CopilotEvidence, slots: readonly CopilotNumberSlot[]): string {
  const first = evidence.facts[0]
  const value = slots[0]?.formatted ?? (first?.value === null ? 'not available' : String(first?.value ?? 'not available'))
  const labels: Readonly<Record<CopilotIntent, string>> = { REVENUE_SUMMARY: `Revenue summary: ${value}.`, REVENUE_CHANGE: `Revenue change from the closed evidence: ${value}.`, TOP_PRODUCTS: `Top product evidence: ${value}.`, STOCKOUT_RISK: `Stockout evidence: ${value}.`, DEAD_STOCK: `Dead-stock evidence: ${value}.`, CUSTOMER_CHURN: `Customer churn evidence: ${value}.`, ORDER_SUMMARY: `Order evidence: ${value}.`, CAMPAIGN_PERFORMANCE: `Campaign evidence: ${value}.`, BILLING_USAGE: `Billing usage evidence: ${value}.`, STORE_HEALTH: `Store health evidence: ${value}.` }
  return `${labels[intent]} Numbers are rendered from evidence slots only. Confidence: ${Math.round(evidence.confidence * 100)}%.`
}

function formatNumber(value: number): string { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value) }
