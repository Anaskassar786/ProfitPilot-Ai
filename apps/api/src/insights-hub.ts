/**
 * Insights Hub — API service layer (PR #50).
 *
 * Orchestrates the deterministic engine in @profitpilot/ai with tenant-scoped
 * persistence (migration 0021), plan gating, monthly usage metering, per-
 * store rate limiting, Commander-scoped API keys, and a language-only AI
 * narration layer on the dedicated INSIGHTS_HUB_API_KEY (Nemotron models).
 *
 * NO FAKE DATA: generation functions stay silent when the store's real data
 * cannot support an insight; the trial experience uses clearly-labeled
 * samples (Part 8.3) and nothing else is ever fabricated.
 */

import { randomBytes } from 'node:crypto'
import { AppError } from '@profitpilot/types'
import type { PlanTier, StoreId } from '@profitpilot/types'
import type { AnalyticsRepository, AnalyticsSnapshot, SqlExecutor, QueryResultRow } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import {
  INSIGHTS_HUB_CACHE_TTL_MS,
  INSIGHTS_PLAN_LIMITS,
  INSIGHTS_USAGE_FEATURES,
  autoDiscoveryDue,
  buildPersonas,
  defaultInsightsPreferences,
  detectPatterns,
  detectTrends,
  forecastOrders,
  forecastRevenue,
  generateDiscoveries,
  generateLesson,
  generateLessonLibrary,
  insightsDataReadiness,
  insightsFeatureAccess,
  insightsHubEnvConfig,
  insightsLimitError,
  insightsUpgradeError,
  investigate,
  predictStockouts,
  round2,
  runComparison,
  searchKnowledge,
  suggestKnowledgeTags,
  summarizeUsage,
  timelineFromEntities,
  trialSampleDiscoveries,
  validateLanguageResponse as firewallCheck,
  INSIGHTS_HUB_SYSTEM_PROMPT,
  discoveryExplanationPrompt,
} from '@profitpilot/ai'
import type {
  ComparisonType,
  DiscoveryCategory,
  DiscoveryStatus,
  InsightComparison,
  InsightDiscovery,
  InsightInvestigation,
  InsightKnowledgeEntry,
  InsightLesson,
  InsightPattern,
  InsightPersona,
  InsightPrediction,
  InsightTimelineEvent,
  InsightTrend,
  InsightsDataset,
  InsightsDataReadiness,
  InsightsPreferences,
  InsightsHubEnvConfig,
  KnowledgeEntryType,
  PredictionHorizon,
  StoreSnapshot,
  TrendDirection,
} from '@profitpilot/ai'
import { OpenRouterClient } from '@profitpilot/ai'
import type { InsightsFeature } from '@profitpilot/ai'
import type { BillingState } from '@profitpilot/billing'
import type { OrderRepository, OrderView } from './orders.js'

/* ── Repository contract ───────────────────────────────────────────────── */

export type DiscoveryListQuery = Readonly<{ status?: DiscoveryStatus | undefined; category?: DiscoveryCategory | undefined; limit: number; cursor: number }>
export type KnowledgeListQuery = Readonly<{ entryType?: KnowledgeEntryType | undefined; tag?: string | undefined; limit: number }>

export type InsightsPreferencesPatch = {
  autoDiscoveryEnabled?: boolean
  discoveryFrequency?: 'REALTIME' | 'DAILY' | 'WEEKLY'
  discoveryCategories?: readonly DiscoveryCategory[]
  notificationPreferences?: Partial<InsightsPreferences['notificationPreferences']>
  trendMonitoringEnabled?: boolean
  personaUpdatesEnabled?: boolean
  language?: 'en' | 'hi'
}

export interface InsightsHubRepository {
  listDiscoveries(storeId: StoreId, query: DiscoveryListQuery): Promise<readonly InsightDiscovery[]>
  getDiscovery(storeId: StoreId, id: string): Promise<InsightDiscovery | null>
  upsertDiscoveries(storeId: StoreId, discoveries: readonly InsightDiscovery[]): Promise<readonly InsightDiscovery[]>
  setDiscoveryStatus(storeId: StoreId, id: string, status: DiscoveryStatus, at: string): Promise<InsightDiscovery | null>
  markDiscoveryViewed(storeId: StoreId, id: string, at: string): Promise<void>
  countDiscoveriesThisMonth(storeId: StoreId, monthStart: string): Promise<number>

  listLessons(storeId: StoreId, category: DiscoveryCategory | null): Promise<readonly InsightLesson[]>
  getLesson(storeId: StoreId, id: string): Promise<InsightLesson | null>
  upsertLessons(storeId: StoreId, lessons: readonly InsightLesson[]): Promise<readonly InsightLesson[]>
  markLessonRead(storeId: StoreId, id: string, at: string): Promise<InsightLesson | null>
  rateLesson(storeId: StoreId, id: string, rating: number): Promise<InsightLesson | null>
  bookmarkLesson(storeId: StoreId, id: string, bookmarked: boolean): Promise<InsightLesson | null>
  countLessonsThisMonth(storeId: StoreId, monthStart: string): Promise<number>

  listPatterns(storeId: StoreId, type: string | null): Promise<readonly InsightPattern[]>
  getPattern(storeId: StoreId, id: string): Promise<InsightPattern | null>
  upsertPatterns(storeId: StoreId, patterns: readonly InsightPattern[]): Promise<readonly InsightPattern[]>
  setPatternAlerts(storeId: StoreId, id: string, enabled: boolean): Promise<InsightPattern | null>
  invalidatePattern(storeId: StoreId, id: string): Promise<boolean>

  listPersonas(storeId: StoreId): Promise<readonly InsightPersona[]>
  getPersona(storeId: StoreId, id: string): Promise<InsightPersona | null>
  replacePersonas(storeId: StoreId, personas: readonly InsightPersona[]): Promise<readonly InsightPersona[]>

  createInvestigation(investigation: InsightInvestigation): Promise<InsightInvestigation>
  listInvestigations(storeId: StoreId, limit: number): Promise<readonly InsightInvestigation[]>
  getInvestigation(storeId: StoreId, id: string): Promise<InsightInvestigation | null>
  rateInvestigation(storeId: StoreId, id: string, rating: number): Promise<InsightInvestigation | null>
  countInvestigationsThisMonth(storeId: StoreId, monthStart: string): Promise<number>

  listTrends(storeId: StoreId, type: string | null): Promise<readonly InsightTrend[]>
  upsertTrends(storeId: StoreId, trends: readonly InsightTrend[]): Promise<readonly InsightTrend[]>
  setTrendAlerts(storeId: StoreId, id: string, enabled: boolean): Promise<InsightTrend | null>

  createComparison(comparison: InsightComparison): Promise<InsightComparison>
  listComparisons(storeId: StoreId, type: string | null, limit: number): Promise<readonly InsightComparison[]>
  getComparison(storeId: StoreId, id: string): Promise<InsightComparison | null>
  deleteComparison(storeId: StoreId, id: string): Promise<boolean>
  countComparisonsThisMonth(storeId: StoreId, monthStart: string): Promise<number>

  listKnowledge(storeId: StoreId, query: KnowledgeListQuery): Promise<readonly InsightKnowledgeEntry[]>
  getKnowledge(storeId: StoreId, id: string): Promise<InsightKnowledgeEntry | null>
  createKnowledge(entry: InsightKnowledgeEntry): Promise<InsightKnowledgeEntry>
  updateKnowledge(storeId: StoreId, id: string, patch: Readonly<{ title?: string; contentMarkdown?: string; tags?: readonly string[] }>, at: string): Promise<InsightKnowledgeEntry | null>
  deleteKnowledge(storeId: StoreId, id: string): Promise<boolean>
  countKnowledge(storeId: StoreId): Promise<number>

  listTimeline(storeId: StoreId, sinceDay: string, types: readonly string[] | null): Promise<readonly InsightTimelineEvent[]>
  addTimelineEvents(events: readonly InsightTimelineEvent[]): Promise<void>

  listPredictions(storeId: StoreId, horizon: PredictionHorizon | null): Promise<readonly InsightPrediction[]>
  getPrediction(storeId: StoreId, id: string): Promise<InsightPrediction | null>
  upsertPredictions(storeId: StoreId, predictions: readonly InsightPrediction[]): Promise<readonly InsightPrediction[]>
  validatePrediction(storeId: StoreId, id: string, actualValue: number, accuracyScore: number, at: string): Promise<InsightPrediction | null>

  getPreferences(storeId: StoreId): Promise<InsightsPreferences | null>
  putPreferences(preferences: InsightsPreferences, apiKey: string | null): Promise<void>
  setLastDiscoveryRun(storeId: StoreId, at: string): Promise<void>
  getLastDiscoveryRun(storeId: StoreId): Promise<string | null>
  updateApiKey(storeId: StoreId, apiKey: string | null, masked: string | null, andEnable: boolean): Promise<void>
  findStoreByApiKey(apiKey: string): Promise<StoreId | null>

  recordApiUsage(storeId: StoreId, endpoint: string, responseSize: number, rateLimitRemaining: number | null): Promise<void>
  countApiUsageSince(storeId: StoreId, sinceIso: string): Promise<number>
  recentApiUsage(storeId: StoreId, limit: number): Promise<readonly Readonly<{ endpoint: string; calledAt: string; rateLimitRemaining: number | null }>[]>
}

/* ── In-memory repository (tests + local dev without Postgres) ─────────── */

export class InMemoryInsightsHubRepository implements InsightsHubRepository {
  private readonly discoveries = new Map<string, InsightDiscovery>()
  private readonly lessons = new Map<string, InsightLesson>()
  private readonly patterns = new Map<string, InsightPattern>()
  private personas = new Map<string, InsightPersona>()
  private readonly investigations = new Map<string, InsightInvestigation & { rating?: number | null }>()
  private readonly trends = new Map<string, InsightTrend>()
  private readonly comparisons = new Map<string, InsightComparison>()
  private readonly knowledge = new Map<string, InsightKnowledgeEntry>()
  private readonly timeline: InsightTimelineEvent[] = []
  private readonly predictions = new Map<string, InsightPrediction>()
  private readonly preferences = new Map<string, InsightsPreferences>()
  private readonly apiKeys = new Map<string, string | null>()
  private readonly lastRun = new Map<string, string>()
  private readonly apiUsage = new Map<string, Array<{ endpoint: string; calledAt: string; rateLimitRemaining: number | null }>>()

  private byStore<Value extends { storeId: string }>(map: ReadonlyMap<string, Value>, storeId: StoreId): Value[] {
    return [...map.values()].filter((row) => row.storeId === storeId)
  }

  public async listDiscoveries(storeId: StoreId, query: DiscoveryListQuery): Promise<readonly InsightDiscovery[]> {
    let rows = this.byStore(this.discoveries, storeId)
    if (query.status) rows = rows.filter((row) => row.status === query.status)
    if (query.category) rows = rows.filter((row) => row.category === query.category)
    rows = rows.sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt))
    return rows.slice(query.cursor, query.cursor + query.limit)
  }
  public async getDiscovery(storeId: StoreId, id: string): Promise<InsightDiscovery | null> {
    const row = this.discoveries.get(id)
    return row && row.storeId === storeId ? row : null
  }
  public async upsertDiscoveries(storeId: StoreId, discoveries: readonly InsightDiscovery[]): Promise<readonly InsightDiscovery[]> {
    for (const discovery of discoveries) this.discoveries.set(discovery.id, discovery)
    return discoveries
  }
  public async setDiscoveryStatus(storeId: StoreId, id: string, status: DiscoveryStatus, at: string): Promise<InsightDiscovery | null> {
    const row = await this.getDiscovery(storeId, id)
    if (!row) return null
    const next: InsightDiscovery = { ...row, status, actionTakenAt: status === 'ACTED_ON' ? at : row.actionTakenAt }
    this.discoveries.set(id, next)
    return next
  }
  public async markDiscoveryViewed(storeId: StoreId, id: string, at: string): Promise<void> {
    const row = await this.getDiscovery(storeId, id)
    if (row && !row.viewedAt) this.discoveries.set(id, { ...row, viewedAt: at })
  }
  public async countDiscoveriesThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return this.byStore(this.discoveries, storeId).filter((row) => !row.sample && row.discoveredAt >= monthStart).length
  }

  public async listLessons(storeId: StoreId, category: DiscoveryCategory | null): Promise<readonly InsightLesson[]> {
    let rows = this.byStore(this.lessons, storeId)
    if (category) rows = rows.filter((row) => row.category === category)
    return rows.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
  }
  public async getLesson(storeId: StoreId, id: string): Promise<InsightLesson | null> {
    const row = this.lessons.get(id)
    return row && row.storeId === storeId ? row : null
  }
  public async upsertLessons(storeId: StoreId, lessons: readonly InsightLesson[]): Promise<readonly InsightLesson[]> {
    for (const lesson of lessons) this.lessons.set(lesson.id, lesson)
    return lessons
  }
  public async markLessonRead(storeId: StoreId, id: string, at: string): Promise<InsightLesson | null> {
    const row = await this.getLesson(storeId, id)
    if (!row) return null
    const next = { ...row, readAt: row.readAt ?? at }
    this.lessons.set(id, next)
    return next
  }
  public async rateLesson(storeId: StoreId, id: string, rating: number): Promise<InsightLesson | null> {
    const row = await this.getLesson(storeId, id)
    if (!row) return null
    const next = { ...row, rating }
    this.lessons.set(id, next)
    return next
  }
  public async bookmarkLesson(storeId: StoreId, id: string, bookmarked: boolean): Promise<InsightLesson | null> {
    const row = await this.getLesson(storeId, id)
    if (!row) return null
    const next = { ...row, bookmarked }
    this.lessons.set(id, next)
    return next
  }
  public async countLessonsThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return this.byStore(this.lessons, storeId).filter((row) => !row.sample && row.generatedAt >= monthStart).length
  }

  public async listPatterns(storeId: StoreId, type: string | null): Promise<readonly InsightPattern[]> {
    let rows = this.byStore(this.patterns, storeId)
    if (type) rows = rows.filter((row) => row.patternType === type)
    return rows.sort((a, b) => b.confidenceScore - a.confidenceScore)
  }
  public async getPattern(storeId: StoreId, id: string): Promise<InsightPattern | null> {
    const row = this.patterns.get(id)
    return row && row.storeId === storeId ? row : null
  }
  public async upsertPatterns(storeId: StoreId, patterns: readonly InsightPattern[]): Promise<readonly InsightPattern[]> {
    const stored: InsightPattern[] = []
    for (const pattern of patterns) {
      const existing = [...this.patterns.values()].find((row) => row.storeId === storeId && row.patternType === pattern.patternType && row.title === pattern.title)
      if (existing) {
        const next: InsightPattern = { ...existing, occurrenceCount: existing.occurrenceCount + 1, lastConfirmed: pattern.lastConfirmed, confidenceScore: pattern.confidenceScore, patternData: pattern.patternData, status: 'ACTIVE' }
        this.patterns.set(existing.id, next)
        stored.push(next)
      } else {
        this.patterns.set(pattern.id, pattern)
        stored.push(pattern)
      }
    }
    return stored
  }
  public async setPatternAlerts(storeId: StoreId, id: string, enabled: boolean): Promise<InsightPattern | null> {
    const row = await this.getPattern(storeId, id)
    if (!row) return null
    const next = { ...row, alertsEnabled: enabled }
    this.patterns.set(id, next)
    return next
  }
  public async invalidatePattern(storeId: StoreId, id: string): Promise<boolean> {
    const row = await this.getPattern(storeId, id)
    if (!row) return false
    this.patterns.set(id, { ...row, status: 'INVALIDATED' })
    return true
  }

  public async listPersonas(storeId: StoreId): Promise<readonly InsightPersona[]> {
    return this.byStore(this.personas, storeId).sort((a, b) => b.estimatedRevenueImpact - a.estimatedRevenueImpact)
  }
  public async getPersona(storeId: StoreId, id: string): Promise<InsightPersona | null> {
    const row = this.personas.get(id)
    return row && row.storeId === storeId ? row : null
  }
  public async replacePersonas(storeId: StoreId, personas: readonly InsightPersona[]): Promise<readonly InsightPersona[]> {
    this.personas = new Map([...this.personas].filter(([, row]) => row.storeId !== storeId))
    for (const persona of personas) this.personas.set(persona.id, persona)
    return personas
  }

  public async createInvestigation(investigation: InsightInvestigation): Promise<InsightInvestigation> {
    this.investigations.set(investigation.id, investigation)
    return investigation
  }
  public async listInvestigations(storeId: StoreId, limit: number): Promise<readonly InsightInvestigation[]> {
    return this.byStore(this.investigations, storeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
  }
  public async getInvestigation(storeId: StoreId, id: string): Promise<InsightInvestigation | null> {
    const row = this.investigations.get(id)
    return row && row.storeId === storeId ? row : null
  }
  public async rateInvestigation(storeId: StoreId, id: string, rating: number): Promise<InsightInvestigation | null> {
    const row = await this.getInvestigation(storeId, id)
    if (!row) return null
    this.investigations.set(id, { ...row, rating })
    return row
  }
  public async countInvestigationsThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return this.byStore(this.investigations, storeId).filter((row) => row.createdAt >= monthStart).length
  }

  public async listTrends(storeId: StoreId, type: string | null): Promise<readonly InsightTrend[]> {
    let rows = this.byStore(this.trends, storeId)
    if (type && type !== 'all') rows = rows.filter((row) => row.trendType === type)
    return rows.sort((a, b) => b.confidenceScore - a.confidenceScore)
  }
  public async upsertTrends(storeId: StoreId, trends: readonly InsightTrend[]): Promise<readonly InsightTrend[]> {
    const stored: InsightTrend[] = []
    for (const trend of trends) {
      const existing = [...this.trends.values()].find((row) => row.storeId === storeId && row.title === trend.title)
      if (existing) {
        const next: InsightTrend = { ...existing, magnitude: trend.magnitude, direction: trend.direction, confidenceScore: trend.confidenceScore, detectedAt: trend.detectedAt, description: trend.description }
        this.trends.set(existing.id, next)
        stored.push(next)
      } else {
        this.trends.set(trend.id, trend)
        stored.push(trend)
      }
    }
    return stored
  }
  public async setTrendAlerts(storeId: StoreId, id: string, enabled: boolean): Promise<InsightTrend | null> {
    const row = this.trends.get(id)
    if (!row || row.storeId !== storeId) return null
    const next = { ...row, alertsEnabled: enabled }
    this.trends.set(id, next)
    return next
  }

  public async createComparison(comparison: InsightComparison): Promise<InsightComparison> {
    this.comparisons.set(comparison.id, comparison)
    return comparison
  }
  public async listComparisons(storeId: StoreId, type: string | null, limit: number): Promise<readonly InsightComparison[]> {
    let rows = this.byStore(this.comparisons, storeId)
    if (type) rows = rows.filter((row) => row.comparisonType === type)
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
  }
  public async getComparison(storeId: StoreId, id: string): Promise<InsightComparison | null> {
    const row = this.comparisons.get(id)
    return row && row.storeId === storeId ? row : null
  }
  public async deleteComparison(storeId: StoreId, id: string): Promise<boolean> {
    const row = await this.getComparison(storeId, id)
    if (!row) return false
    return this.comparisons.delete(id)
  }
  public async countComparisonsThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return this.byStore(this.comparisons, storeId).filter((row) => row.createdAt >= monthStart).length
  }

  public async listKnowledge(storeId: StoreId, query: KnowledgeListQuery): Promise<readonly InsightKnowledgeEntry[]> {
    let rows = this.byStore(this.knowledge, storeId)
    if (query.entryType) rows = rows.filter((row) => row.entryType === query.entryType)
    if (query.tag) rows = rows.filter((row) => row.tags.includes(query.tag as string))
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, query.limit)
  }
  public async getKnowledge(storeId: StoreId, id: string): Promise<InsightKnowledgeEntry | null> {
    const row = this.knowledge.get(id)
    return row && row.storeId === storeId ? row : null
  }
  public async createKnowledge(entry: InsightKnowledgeEntry): Promise<InsightKnowledgeEntry> {
    this.knowledge.set(entry.id, entry)
    return entry
  }
  public async updateKnowledge(storeId: StoreId, id: string, patch: Readonly<{ title?: string; contentMarkdown?: string; tags?: readonly string[] }>, at: string): Promise<InsightKnowledgeEntry | null> {
    const row = await this.getKnowledge(storeId, id)
    if (!row) return null
    const next: InsightKnowledgeEntry = { ...row, title: patch.title ?? row.title, contentMarkdown: patch.contentMarkdown ?? row.contentMarkdown, tags: patch.tags ?? row.tags, updatedAt: at, referenceCount: row.referenceCount + 1 }
    this.knowledge.set(id, next)
    return next
  }
  public async deleteKnowledge(storeId: StoreId, id: string): Promise<boolean> {
    const row = await this.getKnowledge(storeId, id)
    if (!row) return false
    return this.knowledge.delete(id)
  }
  public async countKnowledge(storeId: StoreId): Promise<number> {
    return this.byStore(this.knowledge, storeId).length
  }

  public async listTimeline(storeId: StoreId, sinceDay: string, types: readonly string[] | null): Promise<readonly InsightTimelineEvent[]> {
    let rows = this.timeline.filter((row) => row.storeId === storeId && row.eventAt >= sinceDay)
    if (types && types.length > 0) rows = rows.filter((row) => types.includes(row.entityType))
    return rows.sort((a, b) => b.eventAt.localeCompare(a.eventAt))
  }
  public async addTimelineEvents(events: readonly InsightTimelineEvent[]): Promise<void> {
    const existing = new Set(this.timeline.map((row) => row.id))
    for (const event of events) if (!existing.has(event.id)) this.timeline.push(event)
  }

  public async listPredictions(storeId: StoreId, horizon: PredictionHorizon | null): Promise<readonly InsightPrediction[]> {
    let rows = this.byStore(this.predictions, storeId)
    if (horizon) rows = rows.filter((row) => row.horizon === horizon)
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  public async getPrediction(storeId: StoreId, id: string): Promise<InsightPrediction | null> {
    const row = this.predictions.get(id)
    return row && row.storeId === storeId ? row : null
  }
  public async upsertPredictions(storeId: StoreId, predictions: readonly InsightPrediction[]): Promise<readonly InsightPrediction[]> {
    for (const prediction of predictions) this.predictions.set(prediction.id, prediction)
    return predictions
  }
  public async validatePrediction(storeId: StoreId, id: string, actualValue: number, accuracyScore: number, at: string): Promise<InsightPrediction | null> {
    const row = await this.getPrediction(storeId, id)
    if (!row) return null
    const next = { ...row, actualValue, accuracyScore }
    this.predictions.set(id, next)
    void at
    return next
  }

  public async getPreferences(storeId: StoreId): Promise<InsightsPreferences | null> {
    return this.preferences.get(storeId) ?? null
  }
  public async putPreferences(preferences: InsightsPreferences, apiKey: string | null): Promise<void> {
    this.preferences.set(preferences.storeId, preferences)
    if (apiKey !== undefined) this.apiKeys.set(preferences.storeId, apiKey)
  }
  public async setLastDiscoveryRun(storeId: StoreId, at: string): Promise<void> {
    this.lastRun.set(storeId, at)
  }
  public async getLastDiscoveryRun(storeId: StoreId): Promise<string | null> {
    return this.lastRun.get(storeId) ?? null
  }
  public async updateApiKey(storeId: StoreId, apiKey: string | null, masked: string | null, andEnable: boolean): Promise<void> {
    this.apiKeys.set(storeId, apiKey)
    const current = this.preferences.get(storeId) ?? defaultInsightsPreferences(storeId)
    this.preferences.set(storeId, { ...current, apiAccessEnabled: andEnable || current.apiAccessEnabled, apiKeyMasked: masked })
  }
  public async findStoreByApiKey(apiKey: string): Promise<StoreId | null> {
    for (const [store, key] of this.apiKeys) if (key && key === apiKey) return store as StoreId
    return null
  }

  public async recordApiUsage(storeId: StoreId, endpoint: string, responseSize: number, rateLimitRemaining: number | null): Promise<void> {
    const rows = this.apiUsage.get(storeId) ?? []
    rows.push({ endpoint, calledAt: new Date().toISOString(), rateLimitRemaining })
    this.apiUsage.set(storeId, rows)
    void responseSize
  }
  public async countApiUsageSince(storeId: StoreId, sinceIso: string): Promise<number> {
    return (this.apiUsage.get(storeId) ?? []).filter((row) => row.calledAt >= sinceIso).length
  }
  public async recentApiUsage(storeId: StoreId, limit: number): Promise<readonly Readonly<{ endpoint: string; calledAt: string; rateLimitRemaining: number | null }>[]> {
    return (this.apiUsage.get(storeId) ?? []).slice(-limit).reverse()
  }
}

/* ── Postgres repository ───────────────────────────────────────────────── */

type Row = QueryResultRow & Record<string, unknown>
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? 0) || 0)
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : new Date(0).toISOString())
const isoOrNull = (value: unknown): string | null => (value == null ? null : iso(value))
const jsonObj = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
const jsonArr = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])
const strArr = (value: unknown): readonly string[] => jsonArr(value).filter((item): item is string => typeof item === 'string')
const bool = (value: unknown): boolean => value === true || value === 't'

export class PostgresInsightsHubRepository implements InsightsHubRepository {
  public constructor(private readonly database: SqlExecutor) {}

  private query<Value>(storeId: StoreId, sql: string, values: readonly unknown[], map: (row: Row) => Value): Promise<readonly Value[]> {
    return withTenantContext(this.database, storeId, async (client) => {
      const result = await client.query<Row>(sql, values)
      return result.rows.map(map)
    })
  }
  private async one<Value>(storeId: StoreId, sql: string, values: readonly unknown[], map: (row: Row) => Value): Promise<Value | null> {
    return (await this.query(storeId, sql, values, map))[0] ?? null
  }

  public listDiscoveries(storeId: StoreId, query: DiscoveryListQuery): Promise<readonly InsightDiscovery[]> {
    const filters = ['store_id = $1']
    const values: unknown[] = [storeId]
    if (query.status) { values.push(query.status); filters.push(`status = $${values.length}`) }
    if (query.category) { values.push(query.category); filters.push(`category = $${values.length}`) }
    values.push(query.limit, query.cursor)
    return this.query(storeId, `SELECT * FROM insights_discoveries WHERE ${filters.join(' AND ')} ORDER BY discovered_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values, mapDiscovery)
  }
  public getDiscovery(storeId: StoreId, id: string): Promise<InsightDiscovery | null> {
    return this.one(storeId, 'SELECT * FROM insights_discoveries WHERE store_id = $1 AND id = $2', [storeId, id], mapDiscovery)
  }
  public async upsertDiscoveries(storeId: StoreId, discoveries: readonly InsightDiscovery[]): Promise<readonly InsightDiscovery[]> {
    return withTenantContext(this.database, storeId, async (client) => {
      for (const d of discoveries) {
        await client.query(
          `INSERT INTO insights_discoveries (id, store_id, discovery_type, category, title, description, explanation, confidence_score, impact_estimate, impact_currency, data_evidence, visualization_data, discovered_at, status, sample, viewed_at, action_taken_at, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, explanation = EXCLUDED.explanation, confidence_score = EXCLUDED.confidence_score, visualization_data = EXCLUDED.visualization_data`,
          [d.id, storeId, d.discoveryType, d.category, d.title, d.description, d.explanation, d.confidenceScore, d.impactEstimate, d.impactCurrency, JSON.stringify(d.dataEvidence), JSON.stringify(d.visualizationData), d.discoveredAt, d.status, d.sample, d.viewedAt, d.actionTakenAt, d.expiresAt],
        )
      }
      return discoveries
    })
  }
  public setDiscoveryStatus(storeId: StoreId, id: string, status: DiscoveryStatus, at: string): Promise<InsightDiscovery | null> {
    return this.one(storeId, `UPDATE insights_discoveries SET status = $3, action_taken_at = CASE WHEN $3 = 'ACTED_ON' THEN $4 ELSE action_taken_at END WHERE store_id = $1 AND id = $2 RETURNING *`, [storeId, id, status, at], mapDiscovery)
  }
  public async markDiscoveryViewed(storeId: StoreId, id: string, at: string): Promise<void> {
    await this.query(storeId, 'UPDATE insights_discoveries SET viewed_at = COALESCE(viewed_at, $3) WHERE store_id = $1 AND id = $2 RETURNING id', [storeId, id, at], (row) => row.id)
  }
  public async countDiscoveriesThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return num((await this.one(storeId, 'SELECT COUNT(*)::int AS n FROM insights_discoveries WHERE store_id = $1 AND sample = false AND discovered_at >= $2', [storeId, monthStart], (row) => row.n)) ?? 0)
  }

  public listLessons(storeId: StoreId, category: DiscoveryCategory | null): Promise<readonly InsightLesson[]> {
    const values: unknown[] = [storeId]
    const filter = category ? `AND category = $2` : ''
    if (category) values.push(category)
    return this.query(storeId, `SELECT * FROM insights_lessons WHERE store_id = $1 ${filter} ORDER BY generated_at DESC`, values, mapLesson)
  }
  public getLesson(storeId: StoreId, id: string): Promise<InsightLesson | null> {
    return this.one(storeId, 'SELECT * FROM insights_lessons WHERE store_id = $1 AND id = $2', [storeId, id], mapLesson)
  }
  public async upsertLessons(storeId: StoreId, lessons: readonly InsightLesson[]): Promise<readonly InsightLesson[]> {
    return withTenantContext(this.database, storeId, async (client) => {
      for (const l of lessons) {
        await client.query(
          `INSERT INTO insights_lessons (id, store_id, lesson_type, category, title, summary, content_markdown, reading_time_minutes, based_on_data, personalized, sample, generated_at, action_items)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (id) DO UPDATE SET summary = EXCLUDED.summary, content_markdown = EXCLUDED.content_markdown`,
          [l.id, storeId, l.lessonType, l.category, l.title, l.summary, l.contentMarkdown, l.readingTimeMinutes, JSON.stringify(l.basedOnData), l.personalized, l.sample, l.generatedAt, JSON.stringify(l.actionItems)],
        )
      }
      return lessons
    })
  }
  public markLessonRead(storeId: StoreId, id: string, at: string): Promise<InsightLesson | null> {
    return this.one(storeId, 'UPDATE insights_lessons SET read_at = COALESCE(read_at, $3) WHERE store_id = $1 AND id = $2 RETURNING *', [storeId, id, at], mapLesson)
  }
  public rateLesson(storeId: StoreId, id: string, rating: number): Promise<InsightLesson | null> {
    return this.one(storeId, 'UPDATE insights_lessons SET rating = $3 WHERE store_id = $1 AND id = $2 RETURNING *', [storeId, id, rating], mapLesson)
  }
  public bookmarkLesson(storeId: StoreId, id: string, bookmarked: boolean): Promise<InsightLesson | null> {
    return this.one(storeId, 'UPDATE insights_lessons SET bookmarked = $3 WHERE store_id = $1 AND id = $2 RETURNING *', [storeId, id, bookmarked], mapLesson)
  }
  public async countLessonsThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return num((await this.one(storeId, 'SELECT COUNT(*)::int AS n FROM insights_lessons WHERE store_id = $1 AND sample = false AND generated_at >= $2', [storeId, monthStart], (row) => row.n)) ?? 0)
  }

  public listPatterns(storeId: StoreId, type: string | null): Promise<readonly InsightPattern[]> {
    const values: unknown[] = [storeId]
    const filter = type ? `AND pattern_type = $2` : ''
    if (type) values.push(type)
    return this.query(storeId, `SELECT * FROM insights_patterns WHERE store_id = $1 ${filter} ORDER BY confidence_score DESC`, values, mapPattern)
  }
  public getPattern(storeId: StoreId, id: string): Promise<InsightPattern | null> {
    return this.one(storeId, 'SELECT * FROM insights_patterns WHERE store_id = $1 AND id = $2', [storeId, id], mapPattern)
  }
  public async upsertPatterns(storeId: StoreId, patterns: readonly InsightPattern[]): Promise<readonly InsightPattern[]> {
    return withTenantContext(this.database, storeId, async (client) => {
      const stored: InsightPattern[] = []
      for (const p of patterns) {
        const existing = await client.query<Row>('SELECT * FROM insights_patterns WHERE store_id = $1 AND pattern_type = $2 AND title = $3 LIMIT 1', [storeId, p.patternType, p.title])
        const row = existing.rows[0]
        if (row) {
          const updated = await client.query<Row>('UPDATE insights_patterns SET occurrence_count = occurrence_count + 1, last_confirmed = $3, confidence_score = $4, pattern_data = $5, status = $6 WHERE store_id = $1 AND id = $2 RETURNING *', [storeId, row.id, p.lastConfirmed, p.confidenceScore, JSON.stringify(p.patternData), 'ACTIVE'])
          const mapped = updated.rows[0] ? mapPattern(updated.rows[0]) : null
          if (mapped) stored.push(mapped)
        } else {
          const inserted = await client.query<Row>('INSERT INTO insights_patterns (id, store_id, pattern_type, title, description, pattern_data, occurrence_count, confidence_score, first_detected, last_confirmed, status, alerts_enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *', [p.id, storeId, p.patternType, p.title, p.description, JSON.stringify(p.patternData), p.occurrenceCount, p.confidenceScore, p.firstDetected, p.lastConfirmed, p.status, p.alertsEnabled])
          const mapped = inserted.rows[0] ? mapPattern(inserted.rows[0]) : null
          if (mapped) stored.push(mapped)
        }
      }
      return stored
    })
  }
  public setPatternAlerts(storeId: StoreId, id: string, enabled: boolean): Promise<InsightPattern | null> {
    return this.one(storeId, 'UPDATE insights_patterns SET alerts_enabled = $3 WHERE store_id = $1 AND id = $2 RETURNING *', [storeId, id, enabled], mapPattern)
  }
  public async invalidatePattern(storeId: StoreId, id: string): Promise<boolean> {
    const row = await this.one(storeId, `UPDATE insights_patterns SET status = 'INVALIDATED' WHERE store_id = $1 AND id = $2 RETURNING id`, [storeId, id], (r) => r.id)
    return row !== null
  }

  public listPersonas(storeId: StoreId): Promise<readonly InsightPersona[]> {
    return this.query(storeId, 'SELECT * FROM insights_personas WHERE store_id = $1 ORDER BY estimated_revenue_impact DESC', [storeId], mapPersona)
  }
  public getPersona(storeId: StoreId, id: string): Promise<InsightPersona | null> {
    return this.one(storeId, 'SELECT * FROM insights_personas WHERE store_id = $1 AND id = $2', [storeId, id], mapPersona)
  }
  public async replacePersonas(storeId: StoreId, personas: readonly InsightPersona[]): Promise<readonly InsightPersona[]> {
    return withTenantContext(this.database, storeId, async (client) => {
      await client.query('DELETE FROM insights_personas WHERE store_id = $1', [storeId])
      for (const p of personas) {
        await client.query(
          'INSERT INTO insights_personas (id, store_id, persona_name, persona_emoji, customer_segment_criteria, percentage_of_customers, behavior_patterns, motivations, how_to_reach, estimated_revenue_impact, revenue_currency, confidence_score, radar, generated_at, customer_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
          [p.id, storeId, p.personaName, p.personaEmoji, JSON.stringify(p.segmentCriteria), p.percentageOfCustomers, JSON.stringify(p.behaviorPatterns), JSON.stringify(p.motivations), JSON.stringify(p.howToReach), p.estimatedRevenueImpact, p.revenueCurrency, p.confidenceScore, JSON.stringify(p.radar), p.generatedAt, p.customerCount],
        )
      }
      return personas
    })
  }

  public async createInvestigation(investigation: InsightInvestigation): Promise<InsightInvestigation> {
    return withTenantContext(this.database, investigation.storeId as StoreId, async (client) => {
      await client.query(
        'INSERT INTO insights_investigations (id, store_id, question, investigation_status, steps, root_causes, data_sources_analyzed, confidence_score, what_to_do, prevention_tips, created_at, completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [investigation.id, investigation.storeId, investigation.question, investigation.status, JSON.stringify(investigation.steps), JSON.stringify(investigation.rootCauses), JSON.stringify(investigation.dataSourcesAnalyzed), investigation.confidenceScore, JSON.stringify(investigation.whatToDo), JSON.stringify(investigation.preventionTips), investigation.createdAt, investigation.completedAt],
      )
      return investigation
    })
  }
  public listInvestigations(storeId: StoreId, limit: number): Promise<readonly InsightInvestigation[]> {
    return this.query(storeId, 'SELECT * FROM insights_investigations WHERE store_id = $1 ORDER BY created_at DESC LIMIT $2', [storeId, limit], mapInvestigation)
  }
  public getInvestigation(storeId: StoreId, id: string): Promise<InsightInvestigation | null> {
    return this.one(storeId, 'SELECT * FROM insights_investigations WHERE store_id = $1 AND id = $2', [storeId, id], mapInvestigation)
  }
  public rateInvestigation(storeId: StoreId, id: string, rating: number): Promise<InsightInvestigation | null> {
    return this.one(storeId, 'UPDATE insights_investigations SET rating = $3 WHERE store_id = $1 AND id = $2 RETURNING *', [storeId, id, rating], mapInvestigation)
  }
  public async countInvestigationsThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return num((await this.one(storeId, 'SELECT COUNT(*)::int AS n FROM insights_investigations WHERE store_id = $1 AND created_at >= $2', [storeId, monthStart], (row) => row.n)) ?? 0)
  }

  public listTrends(storeId: StoreId, type: string | null): Promise<readonly InsightTrend[]> {
    const values: unknown[] = [storeId]
    const filter = type && type !== 'all' ? `AND trend_type = $2` : ''
    if (type && type !== 'all') values.push(type)
    return this.query(storeId, `SELECT * FROM insights_trends WHERE store_id = $1 ${filter} ORDER BY confidence_score DESC`, values, mapTrend)
  }
  public async upsertTrends(storeId: StoreId, trends: readonly InsightTrend[]): Promise<readonly InsightTrend[]> {
    return withTenantContext(this.database, storeId, async (client) => {
      const stored: InsightTrend[] = []
      for (const t of trends) {
        const existing = await client.query<Row>('SELECT id FROM insights_trends WHERE store_id = $1 AND title = $2 LIMIT 1', [storeId, t.title])
        const existingId = existing.rows[0]?.id
        if (typeof existingId === 'string') {
          const updated = await client.query<Row>('UPDATE insights_trends SET magnitude = $3, direction = $4, confidence_score = $5, detected_at = $6, description = $7, trend_type = $8 WHERE store_id = $1 AND id = $2 RETURNING *', [storeId, existingId, t.magnitude, t.direction, t.confidenceScore, t.detectedAt, t.description, t.trendType])
          const mapped = updated.rows[0] ? mapTrend(updated.rows[0]) : null
          if (mapped) stored.push(mapped)
        } else {
          const inserted = await client.query<Row>('INSERT INTO insights_trends (id, store_id, trend_type, category, title, description, direction, magnitude, time_period, data_source, confidence_score, detected_at, expires_at, alerts_enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *', [t.id, storeId, t.trendType, t.category, t.title, t.description, t.direction, t.magnitude, t.timePeriod, t.dataSource, t.confidenceScore, t.detectedAt, null, t.alertsEnabled])
          const mapped = inserted.rows[0] ? mapTrend(inserted.rows[0]) : null
          if (mapped) stored.push(mapped)
        }
      }
      return stored
    })
  }
  public setTrendAlerts(storeId: StoreId, id: string, enabled: boolean): Promise<InsightTrend | null> {
    return this.one(storeId, 'UPDATE insights_trends SET alerts_enabled = $3 WHERE store_id = $1 AND id = $2 RETURNING *', [storeId, id, enabled], mapTrend)
  }

  public async createComparison(comparison: InsightComparison): Promise<InsightComparison> {
    return withTenantContext(this.database, comparison.storeId as StoreId, async (client) => {
      await client.query('INSERT INTO insights_comparisons (id, store_id, comparison_type, title, subject_a, subject_b, comparison_data, winner, insights, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [comparison.id, comparison.storeId, comparison.comparisonType, comparison.title, JSON.stringify(comparison.subjectA), JSON.stringify(comparison.subjectB), JSON.stringify({ metrics: comparison.metrics }), comparison.winner, JSON.stringify(comparison.insights), comparison.createdAt])
      return comparison
    })
  }
  public listComparisons(storeId: StoreId, type: string | null, limit: number): Promise<readonly InsightComparison[]> {
    const values: unknown[] = [storeId]
    const filter = type ? `AND comparison_type = $3` : ''
    if (type) values.push(type)
    values.push(limit)
    return this.query(storeId, `SELECT * FROM insights_comparisons WHERE store_id = $1 ${filter} ORDER BY created_at DESC LIMIT $${values.length}`, values, mapComparison)
  }
  public getComparison(storeId: StoreId, id: string): Promise<InsightComparison | null> {
    return this.one(storeId, 'SELECT * FROM insights_comparisons WHERE store_id = $1 AND id = $2', [storeId, id], mapComparison)
  }
  public async deleteComparison(storeId: StoreId, id: string): Promise<boolean> {
    const row = await this.one(storeId, 'DELETE FROM insights_comparisons WHERE store_id = $1 AND id = $2 RETURNING id', [storeId, id], (r) => r.id)
    return row !== null
  }
  public async countComparisonsThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return num((await this.one(storeId, 'SELECT COUNT(*)::int AS n FROM insights_comparisons WHERE store_id = $1 AND created_at >= $2', [storeId, monthStart], (row) => row.n)) ?? 0)
  }

  public listKnowledge(storeId: StoreId, query: KnowledgeListQuery): Promise<readonly InsightKnowledgeEntry[]> {
    const values: unknown[] = [storeId]
    const filters = ['store_id = $1']
    if (query.entryType) { values.push(query.entryType); filters.push(`entry_type = $${values.length}`) }
    if (query.tag) { values.push(query.tag); filters.push(`tags @> ARRAY[$${values.length}]::text[]`) }
    values.push(query.limit)
    return this.query(storeId, `SELECT * FROM insights_knowledge_base WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT $${values.length}`, values, mapKnowledge)
  }
  public getKnowledge(storeId: StoreId, id: string): Promise<InsightKnowledgeEntry | null> {
    return this.one(storeId, 'SELECT * FROM insights_knowledge_base WHERE store_id = $1 AND id = $2', [storeId, id], mapKnowledge)
  }
  public async createKnowledge(entry: InsightKnowledgeEntry): Promise<InsightKnowledgeEntry> {
    return withTenantContext(this.database, entry.storeId as StoreId, async (client) => {
      await client.query('INSERT INTO insights_knowledge_base (id, store_id, entry_type, title, content_markdown, tags, linked_insights, author, created_at, updated_at, reference_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [entry.id, entry.storeId, entry.entryType, entry.title, entry.contentMarkdown, entry.tags as unknown as string[], entry.linkedInsights.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) as unknown as string[], entry.author, entry.createdAt, entry.updatedAt, entry.referenceCount])
      return entry
    })
  }
  public updateKnowledge(storeId: StoreId, id: string, patch: Readonly<{ title?: string; contentMarkdown?: string; tags?: readonly string[] }>, at: string): Promise<InsightKnowledgeEntry | null> {
    return this.one(storeId, 'UPDATE insights_knowledge_base SET title = COALESCE($3, title), content_markdown = COALESCE($4, content_markdown), tags = COALESCE($5::text[], tags), updated_at = $6, last_referenced_at = $6, reference_count = reference_count + 1 WHERE store_id = $1 AND id = $2 RETURNING *', [storeId, id, patch.title ?? null, patch.contentMarkdown ?? null, patch.tags ? [...patch.tags] : null, at], mapKnowledge)
  }
  public async deleteKnowledge(storeId: StoreId, id: string): Promise<boolean> {
    const row = await this.one(storeId, 'DELETE FROM insights_knowledge_base WHERE store_id = $1 AND id = $2 RETURNING id', [storeId, id], (r) => r.id)
    return row !== null
  }
  public async countKnowledge(storeId: StoreId): Promise<number> {
    return num((await this.one(storeId, 'SELECT COUNT(*)::int AS n FROM insights_knowledge_base WHERE store_id = $1', [storeId], (row) => row.n)) ?? 0)
  }

  public listTimeline(storeId: StoreId, sinceDay: string, types: readonly string[] | null): Promise<readonly InsightTimelineEvent[]> {
    const values: unknown[] = [storeId, sinceDay]
    const filter = types && types.length > 0 ? `AND entity_type = ANY($3::text[])` : ''
    if (types && types.length > 0) values.push([...types])
    return this.query(storeId, `SELECT * FROM insights_timeline_events WHERE store_id = $1 AND event_at >= $2 ${filter} ORDER BY event_at DESC LIMIT 400`, values, mapTimelineEvent)
  }
  public async addTimelineEvents(events: readonly InsightTimelineEvent[]): Promise<void> {
    for (const event of events) {
      await this.query(event.storeId as StoreId, 'INSERT INTO insights_timeline_events (id, store_id, event_type, entity_type, entity_id, entity_ref, description, event_data, event_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING RETURNING id', [event.id, event.storeId, event.eventType, event.entityType, /^[0-9a-f-]{36}$/i.test(event.entityId) ? event.entityId : null, event.entityId, event.description, '{}', event.eventAt], (row) => row.id)
    }
  }

  public listPredictions(storeId: StoreId, horizon: PredictionHorizon | null): Promise<readonly InsightPrediction[]> {
    const values: unknown[] = [storeId]
    const filter = horizon ? `AND prediction_horizon = $2` : ''
    if (horizon) values.push(horizon)
    return this.query(storeId, `SELECT * FROM insights_predictions WHERE store_id = $1 ${filter} ORDER BY created_at DESC LIMIT 60`, values, mapPrediction)
  }
  public getPrediction(storeId: StoreId, id: string): Promise<InsightPrediction | null> {
    return this.one(storeId, 'SELECT * FROM insights_predictions WHERE store_id = $1 AND id = $2', [storeId, id], mapPrediction)
  }
  public async upsertPredictions(storeId: StoreId, predictions: readonly InsightPrediction[]): Promise<readonly InsightPrediction[]> {
    return withTenantContext(this.database, storeId, async (client) => {
      for (const p of predictions) {
        await client.query(
          'INSERT INTO insights_predictions (id, store_id, prediction_type, prediction_horizon, title, description, predicted_value, predicted_low, predicted_high, predicted_value_currency, confidence_score, method, prediction_data, based_on, predicted_for, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING',
          [p.id, storeId, p.predictionType, p.horizon, p.title, p.description, p.predictedValue, p.predictedLow, p.predictedHigh, p.currency, p.confidenceScore, p.method, JSON.stringify({ series: p.series }), JSON.stringify([...p.basedOn]), p.predictedFor, p.createdAt],
        )
      }
      return predictions
    })
  }
  public validatePrediction(storeId: StoreId, id: string, actualValue: number, accuracyScore: number, at: string): Promise<InsightPrediction | null> {
    return this.one(storeId, 'UPDATE insights_predictions SET actual_value = $3, accuracy_score = $4, validated_at = $5 WHERE store_id = $1 AND id = $2 RETURNING *', [storeId, id, actualValue, accuracyScore, at], mapPrediction)
  }

  public getPreferences(storeId: StoreId): Promise<InsightsPreferences | null> {
    return this.one(storeId, 'SELECT * FROM insights_preferences WHERE store_id = $1', [storeId], mapPreferences)
  }
  public async putPreferences(preferences: InsightsPreferences, apiKey: string | null): Promise<void> {
    await withTenantContext(this.database, preferences.storeId as StoreId, async (client) => {
      await client.query(
        `INSERT INTO insights_preferences (store_id, auto_discovery_enabled, discovery_frequency, discovery_categories, notification_preferences, trend_monitoring_enabled, persona_updates_enabled, api_access_enabled, api_key, language, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (store_id) DO UPDATE SET auto_discovery_enabled = EXCLUDED.auto_discovery_enabled, discovery_frequency = EXCLUDED.discovery_frequency, discovery_categories = EXCLUDED.discovery_categories, notification_preferences = EXCLUDED.notification_preferences, trend_monitoring_enabled = EXCLUDED.trend_monitoring_enabled, persona_updates_enabled = EXCLUDED.persona_updates_enabled, api_access_enabled = EXCLUDED.api_access_enabled, language = EXCLUDED.language, updated_at = EXCLUDED.updated_at, api_key = COALESCE($9, insights_preferences.api_key) `,
        [preferences.storeId, preferences.autoDiscoveryEnabled, preferences.discoveryFrequency, preferences.discoveryCategories as unknown as string[], JSON.stringify(preferences.notificationPreferences), preferences.trendMonitoringEnabled, preferences.personaUpdatesEnabled, preferences.apiAccessEnabled, apiKey, preferences.language, preferences.updatedAt],
      )
    })
  }
  public async setLastDiscoveryRun(storeId: StoreId, at: string): Promise<void> {
    await this.query(storeId, 'INSERT INTO insights_preferences (store_id, last_discovery_run_at) VALUES ($1, $2) ON CONFLICT (store_id) DO UPDATE SET last_discovery_run_at = $2 RETURNING store_id', [storeId, at], (row) => row.store_id)
  }
  public async getLastDiscoveryRun(storeId: StoreId): Promise<string | null> {
    const value = await this.one(storeId, 'SELECT last_discovery_run_at FROM insights_preferences WHERE store_id = $1', [storeId], (row) => row.last_discovery_run_at)
    return value == null ? null : iso(value)
  }
  public async updateApiKey(storeId: StoreId, apiKey: string | null, masked: string | null, andEnable: boolean): Promise<void> {
    await this.query(storeId, 'INSERT INTO insights_preferences (store_id, api_key, api_access_enabled, api_rate_limit) VALUES ($1,$2,$3,$4) ON CONFLICT (store_id) DO UPDATE SET api_key = $2, api_access_enabled = $3, updated_at = now() RETURNING store_id', [storeId, apiKey, andEnable, 100], (row) => row.store_id)
    void masked
  }
  public async findStoreByApiKey(apiKey: string): Promise<StoreId | null> {
    // API keys authenticate external calls before a tenant context exists.
    const result = await this.database.query<Row>('SELECT store_id FROM insights_preferences WHERE api_key = $1 AND api_access_enabled = true LIMIT 1', [apiKey])
    const value = result.rows[0]?.store_id
    return typeof value === 'string' ? (value as StoreId) : null
  }

  public async recordApiUsage(storeId: StoreId, endpoint: string, responseSize: number, rateLimitRemaining: number | null): Promise<void> {
    await this.query(storeId, 'INSERT INTO insights_api_usage (store_id, endpoint, response_size, rate_limit_remaining) VALUES ($1,$2,$3,$4) RETURNING id', [storeId, endpoint, responseSize, rateLimitRemaining], (row) => row.id)
  }
  public async countApiUsageSince(storeId: StoreId, sinceIso: string): Promise<number> {
    return num((await this.one(storeId, 'SELECT COUNT(*)::int AS n FROM insights_api_usage WHERE store_id = $1 AND called_at >= $2', [storeId, sinceIso], (row) => row.n)) ?? 0)
  }
  public recentApiUsage(storeId: StoreId, limit: number): Promise<readonly Readonly<{ endpoint: string; calledAt: string; rateLimitRemaining: number | null }>[]> {
    return this.query(storeId, 'SELECT endpoint, called_at, rate_limit_remaining FROM insights_api_usage WHERE store_id = $1 ORDER BY called_at DESC LIMIT $2', [storeId, limit], (row) => ({ endpoint: str(row.endpoint), calledAt: iso(row.called_at), rateLimitRemaining: row.rate_limit_remaining == null ? null : num(row.rate_limit_remaining) }))
  }
}

/* ── Row mappers ───────────────────────────────────────────────────────── */

function mapDiscovery(row: Row): InsightDiscovery {
  return {
    id: str(row.id), storeId: str(row.store_id),
    discoveryType: str(row.discovery_type) as InsightDiscovery['discoveryType'],
    category: str(row.category) as InsightDiscovery['category'],
    title: str(row.title), description: str(row.description), explanation: str(row.explanation),
    confidenceScore: num(row.confidence_score), impactEstimate: row.impact_estimate == null ? null : num(row.impact_estimate),
    impactCurrency: str(row.impact_currency, 'USD'),
    dataEvidence: jsonObj(row.data_evidence) as InsightDiscovery['dataEvidence'],
    visualizationData: jsonObj(row.visualization_data) as InsightDiscovery['visualizationData'],
    discoveredAt: iso(row.discovered_at), status: str(row.status, 'NEW') as InsightDiscovery['status'],
    sample: bool(row.sample), viewedAt: isoOrNull(row.viewed_at), actionTakenAt: isoOrNull(row.action_taken_at), expiresAt: isoOrNull(row.expires_at),
  }
}
function mapLesson(row: Row): InsightLesson {
  return {
    id: str(row.id), storeId: str(row.store_id),
    lessonType: str(row.lesson_type) as InsightLesson['lessonType'], category: str(row.category) as InsightLesson['category'],
    title: str(row.title), summary: str(row.summary), contentMarkdown: str(row.content_markdown),
    readingTimeMinutes: num(row.reading_time_minutes), basedOnData: jsonObj(row.based_on_data) as InsightLesson['basedOnData'],
    personalized: bool(row.personalized), sample: bool(row.sample), generatedAt: iso(row.generated_at),
    readAt: isoOrNull(row.read_at), rating: row.rating == null ? null : num(row.rating), bookmarked: bool(row.bookmarked),
    actionItems: strArr(row.action_items),
  }
}
function mapPattern(row: Row): InsightPattern {
  return {
    id: str(row.id), storeId: str(row.store_id), patternType: str(row.pattern_type) as InsightPattern['patternType'],
    title: str(row.title), description: str(row.description), patternData: jsonObj(row.pattern_data) as InsightPattern['patternData'],
    occurrenceCount: num(row.occurrence_count), confidenceScore: num(row.confidence_score),
    firstDetected: iso(row.first_detected), lastConfirmed: iso(row.last_confirmed),
    status: str(row.status, 'ACTIVE') as InsightPattern['status'], alertsEnabled: bool(row.alerts_enabled),
  }
}
function mapPersona(row: Row): InsightPersona {
  return {
    id: str(row.id), storeId: str(row.store_id), personaName: str(row.persona_name), personaEmoji: str(row.persona_emoji, '🧭'),
    segmentCriteria: jsonObj(row.customer_segment_criteria) as InsightPersona['segmentCriteria'],
    percentageOfCustomers: num(row.percentage_of_customers), behaviorPatterns: strArr(row.behavior_patterns),
    motivations: strArr(row.motivations), howToReach: strArr(row.how_to_reach),
    estimatedRevenueImpact: num(row.estimated_revenue_impact), revenueCurrency: str(row.revenue_currency, 'USD'),
    confidenceScore: num(row.confidence_score), customerCount: num(row.customer_count),
    radar: jsonArr(row.radar).map((item) => ({ trait: str((item as Record<string, unknown> | null)?.trait), score: num((item as Record<string, unknown> | null)?.score) })),
    generatedAt: iso(row.generated_at),
  }
}
function mapInvestigation(row: Row): InsightInvestigation & { rating?: number | null } {
  return {
    id: str(row.id), storeId: str(row.store_id), question: str(row.question),
    status: str(row.investigation_status, 'COMPLETED') as InsightInvestigation['status'],
    steps: strArr(row.steps), rootCauses: jsonArr(row.root_causes) as InsightInvestigation['rootCauses'],
    dataSourcesAnalyzed: strArr(row.data_sources_analyzed), confidenceScore: num(row.confidence_score),
    whatToDo: strArr(row.what_to_do), preventionTips: strArr(row.prevention_tips),
    rating: row.rating == null ? null : num(row.rating),
    createdAt: iso(row.created_at), completedAt: isoOrNull(row.completed_at),
  }
}
function mapTrend(row: Row): InsightTrend {
  return {
    id: str(row.id), storeId: str(row.store_id), trendType: str(row.trend_type) as InsightTrend['trendType'],
    category: str(row.category) as InsightTrend['category'], title: str(row.title), description: str(row.description),
    direction: str(row.direction, 'STABLE') as TrendDirection, magnitude: num(row.magnitude), timePeriod: str(row.time_period, 'LAST_14_DAYS'),
    dataSource: str(row.data_source, 'INTERNAL') as InsightTrend['dataSource'], confidenceScore: num(row.confidence_score),
    detectedAt: iso(row.detected_at), alertsEnabled: bool(row.alerts_enabled),
  }
}
function mapComparison(row: Row): InsightComparison {
  const data = jsonObj(row.comparison_data)
  return {
    id: str(row.id), storeId: str(row.store_id), comparisonType: str(row.comparison_type) as InsightComparison['comparisonType'],
    title: str(row.title), subjectA: jsonObj(row.subject_a) as InsightComparison['subjectA'], subjectB: jsonObj(row.subject_b) as InsightComparison['subjectB'],
    metrics: jsonArr(data.metrics) as InsightComparison['metrics'], winner: str(row.winner, 'INSUFFICIENT_DATA') as InsightComparison['winner'],
    insights: strArr(row.insights), createdAt: iso(row.created_at),
  }
}
function mapKnowledge(row: Row): InsightKnowledgeEntry {
  return {
    id: str(row.id), storeId: str(row.store_id), entryType: str(row.entry_type) as InsightKnowledgeEntry['entryType'],
    title: str(row.title), contentMarkdown: str(row.content_markdown), tags: strArr(row.tags),
    linkedInsights: strArr(row.linked_insights), author: str(row.author, 'MERCHANT') as InsightKnowledgeEntry['author'],
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), referenceCount: num(row.reference_count),
  }
}
function mapTimelineEvent(row: Row): InsightTimelineEvent {
  return {
    id: str(row.id), storeId: str(row.store_id), eventType: str(row.event_type),
    entityType: str(row.entity_type) as InsightTimelineEvent['entityType'],
    entityId: str(row.entity_ref ?? row.entity_id), description: str(row.description), eventAt: iso(row.event_at),
  }
}
function mapPrediction(row: Row): InsightPrediction {
  const data = jsonObj(row.prediction_data)
  return {
    id: str(row.id), storeId: str(row.store_id), predictionType: str(row.prediction_type) as InsightPrediction['predictionType'],
    horizon: str(row.prediction_horizon) as PredictionHorizon, title: str(row.title), description: str(row.description),
    predictedValue: num(row.predicted_value), predictedLow: num(row.predicted_low), predictedHigh: num(row.predicted_high),
    currency: str(row.predicted_value_currency, 'USD'), confidenceScore: num(row.confidence_score), method: str(row.method),
    series: jsonArr(data.series) as InsightPrediction['series'], basedOn: strArr(row.based_on),
    predictedFor: str(row.predicted_for instanceof Date ? row.predicted_for.toISOString().slice(0, 10) : row.predicted_for),
    actualValue: row.actual_value == null ? null : num(row.actual_value), accuracyScore: row.accuracy_score == null ? null : num(row.accuracy_score),
    createdAt: iso(row.created_at),
  }
}
function mapPreferences(row: Row): InsightsPreferences {
  return {
    storeId: str(row.store_id),
    autoDiscoveryEnabled: bool(row.auto_discovery_enabled),
    discoveryFrequency: str(row.discovery_frequency, 'DAILY') as InsightsPreferences['discoveryFrequency'],
    discoveryCategories: strArr(row.discovery_categories) as InsightsPreferences['discoveryCategories'],
    notificationPreferences: { ...defaultInsightsPreferences(str(row.store_id)).notificationPreferences, ...(jsonObj(row.notification_preferences) as Partial<InsightsPreferences['notificationPreferences']>) },
    trendMonitoringEnabled: bool(row.trend_monitoring_enabled),
    personaUpdatesEnabled: bool(row.persona_updates_enabled),
    apiAccessEnabled: bool(row.api_access_enabled),
    apiKeyMasked: typeof row.api_key === 'string' && row.api_key ? maskApiKey(row.api_key) : null,
    language: str(row.language, 'en') as InsightsPreferences['language'],
    updatedAt: iso(row.updated_at),
  }
}

export function maskApiKey(key: string): string {
  return key.length <= 8 ? '••••••••' : `${key.slice(0, 7)}…${key.slice(-4)}`
}

/* ── Dataset assembly (real synced data only) ──────────────────────────── */

export type InsightsDatasetSources = Readonly<{
  snapshot: (storeId: StoreId) => Promise<StoreSnapshot>
  analytics: Pick<AnalyticsRepository, 'read' | 'readCatalog'>
  orders?: Pick<OrderRepository, 'list'> | null
}>

export async function buildInsightsDataset(storeId: StoreId, sources: InsightsDatasetSources): Promise<InsightsDataset> {
  const [snapshot, analytics, orders] = await Promise.all([
    sources.snapshot(storeId),
    sources.analytics.read(storeId),
    sources.orders?.list(storeId).catch(() => [] as readonly OrderView[]) ?? Promise.resolve([] as readonly OrderView[]),
  ])
  const hours = orderHours(orders)
  return {
    storeId,
    currency: snapshot.currency,
    revenueDaily: analytics.revenue.map((row) => ({ day: dayKey(row.day), grossRevenue: row.grossRevenue, orderCount: row.orderCount })),
    ordersDaily: analytics.orders.map((row) => ({ day: dayKey(row.day), orderCount: row.orderCount, averageOrderValue: row.averageOrderValue })),
    productSalesDaily: analytics.productSales.map((row) => ({ day: dayKey(row.day), productId: row.productId, unitsSold: row.unitsSold, grossRevenue: row.grossRevenue })),
    products: snapshot.products.map((product) => ({ productId: product.productId, title: product.title, price: product.unitPrice || null, category: null })),
    customers: snapshot.customers,
    productPairs: snapshot.productPairs.map((pair) => ({ productId: pair.productId, relatedProductId: pair.relatedProductId, coPurchaseRate: pair.coPurchaseRate })),
    hours,
  }
}

function dayKey(value: string): string {
  return value.slice(0, 10)
}

export function orderHours(orders: readonly Pick<OrderView, 'createdAt' | 'totalPrice'>[]): readonly Readonly<{ hour: number; orders: number; revenue: number }>[] {
  const buckets = new Map<number, { orders: number; revenue: number }>()
  for (const order of orders) {
    if (!order.createdAt) continue
    const at = new Date(order.createdAt)
    if (!Number.isFinite(at.getTime())) continue
    const hour = at.getUTCHours()
    const entry = buckets.get(hour) ?? { orders: 0, revenue: 0 }
    entry.orders += 1
    entry.revenue += order.totalPrice ?? 0
    buckets.set(hour, entry)
  }
  return [...buckets.entries()].map(([hour, entry]) => ({ hour, orders: entry.orders, revenue: round2(entry.revenue) })).sort((a, b) => a.hour - b.hour)
}

/* ── Per-store rate limiter (25/min default per INSIGHTS_HUB spec) ─────── */

export class InsightsRateLimiter {
  private readonly windows = new Map<string, number[]>()
  public constructor(private readonly limitPerMinute: number, private readonly now: () => number = () => Date.now()) {}
  public consume(storeId: string): Readonly<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
    const windowMs = 60_000
    const now = this.now()
    const entries = (this.windows.get(storeId) ?? []).filter((at) => now - at < windowMs)
    if (entries.length >= this.limitPerMinute) {
      this.windows.set(storeId, entries)
      const oldest = entries[0] ?? now
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) }
    }
    entries.push(now)
    this.windows.set(storeId, entries)
    return { allowed: true, remaining: this.limitPerMinute - entries.length, retryAfterSeconds: 0 }
  }
}

/* ── API keys (Commander) ──────────────────────────────────────────────── */

export function generateInsightsApiKey(): string {
  return `ihk_${randomBytes(24).toString('hex')}`
}

/* ── AI narration (language-only, firewall-validated) ──────────────────── */

export type InsightsNarrator = (input: Readonly<{ title: string; description: string; evidenceNumbers: readonly number[]; category: DiscoveryCategory }>) => Promise<{ text: string; model: string } | null>

export function createInsightsNarrator(provider: Pick<OpenRouterClient, 'generate'> | null): InsightsNarrator {
  return async (input) => {
    if (!provider) return null
    try {
      const generation = await provider.generate(INSIGHTS_HUB_SYSTEM_PROMPT, discoveryExplanationPrompt(input), { maxTokens: 300 })
      // Language firewall: every number must come from the evidence set.
      const evidence = input.evidenceNumbers.map((value, index) => ({ key: `n${index}`, label: `evidence-${index}`, value, source: 'insights-engine' }))
      const checked = firewallCheck(generation.text, evidence, input.evidenceNumbers[0] ?? 0)
      return { text: checked, model: generation.model }
    } catch {
      return null
    }
  }
}

/* ── Service ───────────────────────────────────────────────────────────── */

export type InsightsOverview = Readonly<{
  plan: PlanTier
  features: Readonly<Record<InsightsFeature, boolean>>
  requiredPlans: Readonly<Record<InsightsFeature, PlanTier>>
  usage: Readonly<{ discoveries: Readonly<{ used: number; limit: number | null; remaining: number | null }>; investigations: Readonly<{ used: number; limit: number | null; remaining: number | null }> }>
  counts: Readonly<{ newDiscoveries: number; totalDiscoveries: number; patterns: number; lessons: number; lessonsRead: number; personas: number; investigations: number; trends: number; predictions: number; comparisons: number; knowledge: number }>
  readiness: InsightsDataReadiness
  preferences: InsightsPreferences
  autoDiscoveryRan: boolean
  trial: boolean
  generatedAt: string
}>

export type InsightsServiceDependencies = Readonly<{
  dataset: InsightsDatasetSources
  repository: InsightsHubRepository
  plan: (storeId: StoreId) => Promise<PlanTier>
  billingState?: ((storeId: StoreId) => Promise<BillingState | null>) | null
  narrator?: InsightsNarrator | null
  env: InsightsHubEnvConfig
  now?: () => number
}>

const KNOWLEDGE_CAPS: Readonly<Record<PlanTier, number>> = { trial: 0, start: 25, growth: 500, commander: Number.POSITIVE_INFINITY }

export class InsightsHubService {
  private readonly cache = new Map<string, { expires: number; dataset: InsightsDataset }>()
  private readonly now: () => number

  public constructor(private readonly deps: InsightsServiceDependencies) {
    this.now = deps.now ?? (() => Date.now())
  }

  private iso(): string { return new Date(this.now()).toISOString() }
  private monthStart(): string { return `${this.iso().slice(0, 7)}-01T00:00:00.000Z` }

  private async planFor(storeId: StoreId): Promise<PlanTier> {
    return this.deps.plan(storeId)
  }

  /** Trial expiry is absolute: a dead subscription cancels generation immediately. */
  private async assertSubscriptionLive(storeId: StoreId): Promise<void> {
    if (!this.deps.billingState) return
    const state = await this.deps.billingState(storeId)
    if (state === 'PAST_DUE' || state === 'SUSPENDED' || state === 'CANCELLED' || state === 'PENDING_CONFIRMATION') {
      throw new AppError('PAYMENT_REQUIRED', 'Your trial or subscription is not active. Upgrade Subscription to continue using Insights Hub.', 402, { reason: 'SUBSCRIPTION_REQUIRED', cta: 'Upgrade Subscription', upgradePath: '/billing' })
    }
  }

  private async assertFeature(storeId: StoreId, feature: InsightsFeature): Promise<PlanTier> {
    const plan = await this.planFor(storeId)
    const access = insightsFeatureAccess(plan, feature)
    if (!access.allowed) throw insightsUpgradeError(feature, plan)
    return plan
  }

  private async datasetFor(storeId: StoreId, fresh = false): Promise<InsightsDataset> {
    const cached = this.cache.get(storeId)
    if (!fresh && cached && cached.expires > this.now()) return cached.dataset
    const dataset = await buildInsightsDataset(storeId, this.deps.dataset)
    this.cache.set(storeId, { expires: this.now() + INSIGHTS_HUB_CACHE_TTL_MS, dataset })
    return dataset
  }

  /* Overview + feed ----------------------------------------------------- */

  public async overview(storeId: StoreId): Promise<InsightsOverview> {
    const plan = await this.planFor(storeId)
    const repository = this.deps.repository
    let autoDiscoveryRan = false
    // Auto-discovery (Part 4): when due and enabled, run in-band so the feed
    // a merchant opens always reflects fresh data. Frequency is plan-shaped.
    if (this.deps.env.autoDiscoveryEnabled && plan !== 'trial') {
      const preferences = await this.preferences(storeId)
      const due = await repository.getLastDiscoveryRun(storeId)
      if (preferences.autoDiscoveryEnabled && autoDiscoveryDue(preferences, plan, due, this.now())) {
        autoDiscoveryRan = await this.runDiscoveryPipeline(storeId, plan, true).then((result) => result.generated > 0 || result.patternsDetected > 0).catch(() => false)
        await repository.setLastDiscoveryRun(storeId, this.iso())
      }
    }
    const [dataset, newD, allD, patterns, lessons, personas, investigations, trends, predictions, comparisons, knowledgeCount, usedDiscoveries, usedInvestigations, preferences] = await Promise.all([
      this.datasetFor(storeId),
      repository.listDiscoveries(storeId, { status: 'NEW', limit: 100, cursor: 0 }),
      repository.listDiscoveries(storeId, { limit: 500, cursor: 0 }),
      repository.listPatterns(storeId, null),
      repository.listLessons(storeId, null),
      repository.listPersonas(storeId),
      repository.listInvestigations(storeId, 100),
      repository.listTrends(storeId, null),
      repository.listPredictions(storeId, null),
      repository.listComparisons(storeId, null, 100),
      repository.countKnowledge(storeId),
      repository.countDiscoveriesThisMonth(storeId, this.monthStart()),
      repository.countInvestigationsThisMonth(storeId, this.monthStart()),
      this.preferences(storeId),
    ])
    const limits = INSIGHTS_PLAN_LIMITS[plan]
    const features = Object.fromEntries((['discoveries', 'lessons', 'patterns', 'personas', 'investigations', 'trends', 'comparisons', 'knowledge', 'timeline', 'predictions', 'autoDiscovery', 'export', 'share', 'apiAccess', 'externalTrends', 'anomalyAlerts'] as const).map((feature) => [feature, insightsFeatureAccess(plan, feature).allowed])) as Readonly<Record<InsightsFeature, boolean>>
    const requiredPlans = Object.fromEntries((Object.keys(features) as InsightsFeature[]).map((feature) => [feature, insightsFeatureAccess(plan, feature).requiredPlan])) as Readonly<Record<InsightsFeature, PlanTier>>
    return {
      plan,
      features,
      requiredPlans,
      usage: {
        discoveries: { used: usedDiscoveries, limit: Number.isFinite(limits.discoveriesPerMonth) ? limits.discoveriesPerMonth : null, remaining: Number.isFinite(limits.discoveriesPerMonth) ? Math.max(0, limits.discoveriesPerMonth - usedDiscoveries) : null },
        investigations: { used: usedInvestigations, limit: Number.isFinite(limits.investigationsPerMonth) ? limits.investigationsPerMonth : null, remaining: Number.isFinite(limits.investigationsPerMonth) ? Math.max(0, limits.investigationsPerMonth - usedInvestigations) : null },
      },
      counts: {
        newDiscoveries: newD.length,
        totalDiscoveries: allD.length,
        patterns: patterns.filter((pattern) => pattern.status === 'ACTIVE').length,
        lessons: lessons.length,
        lessonsRead: lessons.filter((lesson) => lesson.readAt !== null).length,
        personas: personas.length,
        investigations: investigations.length,
        trends: trends.length,
        predictions: predictions.length,
        comparisons: comparisons.length,
        knowledge: knowledgeCount,
      },
      readiness: insightsDataReadiness(dataset),
      preferences,
      autoDiscoveryRan,
      trial: plan === 'trial',
      generatedAt: this.iso(),
    }
  }

  /* Discoveries ---------------------------------------------------------- */

  private async runDiscoveryPipeline(storeId: StoreId, plan: PlanTier, automatic: boolean): Promise<Readonly<{ generated: number; discoveries: readonly InsightDiscovery[]; patternsDetected: number }>> {
    const dataset = await this.datasetFor(storeId, true)
    const limits = INSIGHTS_PLAN_LIMITS[plan]
    const discoveries = generateDiscoveries(dataset, {
      limit: Number.isFinite(limits.discoveriesPerMonth) ? Math.max(limits.discoveriesPerMonth, 5) : 12,
      minConfidence: this.deps.env.minConfidenceScore,
      now: this.iso(),
    })
    const narrated = await this.narrateDiscoveries(discoveries)
    // Patterns ride along: detection is deterministic and cheap.
    const patterns = detectPatterns(dataset, Number.isFinite(limits.patternsLimit ?? Number.POSITIVE_INFINITY) ? (limits.patternsLimit ?? 5) : 50, this.iso())
    const trends = detectTrends(dataset, this.iso())
    const repository = this.deps.repository
    await repository.upsertDiscoveries(storeId, narrated)
    const storedPatterns = patterns.length > 0 && !limits.patternsViewOnly ? await repository.upsertPatterns(storeId, patterns) : []
    if (trends.length > 0 && this.deps.env.trendMonitoring) await repository.upsertTrends(storeId, trends)
    if (narrated.length > 0) {
      await repository.addTimelineEvents(timelineFromEntities({ discoveries: narrated }))
    }
    void automatic
    return { generated: narrated.length, discoveries: narrated, patternsDetected: storedPatterns.length }
  }

  private async narrateDiscoveries(discoveries: readonly InsightDiscovery[]): Promise<readonly InsightDiscovery[]> {
    const narrator = this.deps.narrator ?? null
    if (!narrator) return discoveries
    const narrated: InsightDiscovery[] = []
    for (const discovery of discoveries) {
      const evidenceNumbers = [discovery.impactEstimate ?? 0, ...Object.values(discovery.dataEvidence).filter((value): value is number => typeof value === 'number')]
      const narration = await narrator({ title: discovery.title, description: discovery.description, evidenceNumbers, category: discovery.category })
      narrated.push(narration ? { ...discovery, explanation: narration.text } : discovery)
    }
    return narrated
  }

  public async listDiscoveries(storeId: StoreId, query: DiscoveryListQuery): Promise<readonly InsightDiscovery[]> {
    const plan = await this.planFor(storeId)
    if (plan === 'trial') {
      // Trial: exactly one clearly-labeled sample (Part 8.3).
      const dataset = await this.datasetFor(storeId)
      return trialSampleDiscoveries(dataset, this.iso())
    }
    return this.deps.repository.listDiscoveries(storeId, query)
  }

  public async discoveryFeed(storeId: StoreId): Promise<Readonly<{ plan: PlanTier; trial: boolean; readiness: InsightsDataReadiness; discoveries: readonly InsightDiscovery[] }>> {
    const plan = await this.planFor(storeId)
    const readiness = insightsDataReadiness(await this.datasetFor(storeId))
    if (plan === 'trial') {
      const dataset = await this.datasetFor(storeId)
      return { plan, trial: true, readiness, discoveries: trialSampleDiscoveries(dataset, this.iso()) }
    }
    const discoveries = await this.deps.repository.listDiscoveries(storeId, { limit: 50, cursor: 0 })
    return { plan, trial: false, readiness, discoveries }
  }

  public async getDiscovery(storeId: StoreId, id: string): Promise<InsightDiscovery> {
    const plan = await this.planFor(storeId)
    if (plan === 'trial') {
      const samples = trialSampleDiscoveries(await this.datasetFor(storeId), this.iso())
      const sample = samples.find((entry) => entry.id === id)
      if (!sample) throw new AppError('NOT_FOUND', 'Discovery not found', 404, { id })
      return sample
    }
    const discovery = await this.deps.repository.getDiscovery(storeId, id)
    if (!discovery) throw new AppError('NOT_FOUND', 'Discovery not found', 404, { id })
    await this.deps.repository.markDiscoveryViewed(storeId, id, this.iso())
    return discovery
  }

  public async generateDiscoveriesForStore(storeId: StoreId): Promise<Readonly<{ generated: number; discoveries: readonly InsightDiscovery[]; usage: ReturnType<typeof summarizeUsage> }>> {
    await this.assertSubscriptionLive(storeId)
    const plan = await this.assertFeature(storeId, 'discoveries')
    const limits = INSIGHTS_PLAN_LIMITS[plan]
    const used = await this.deps.repository.countDiscoveriesThisMonth(storeId, this.monthStart())
    if (used >= limits.discoveriesPerMonth) throw insightsLimitError('discoveries', plan, used, limits.discoveriesPerMonth, 'AI discoveries')
    const result = await this.runDiscoveryPipeline(storeId, plan, false)
    await this.deps.repository.setLastDiscoveryRun(storeId, this.iso())
    const after = used + result.generated
    return { generated: result.generated, discoveries: result.discoveries, usage: summarizeUsage(after, limits.discoveriesPerMonth) }
  }

  public async setDiscoveryStatus(storeId: StoreId, id: string, status: DiscoveryStatus): Promise<InsightDiscovery> {
    await this.assertFeature(storeId, 'discoveries')
    const updated = await this.deps.repository.setDiscoveryStatus(storeId, id, status, this.iso())
    if (!updated) throw new AppError('NOT_FOUND', 'Discovery not found', 404, { id })
    return updated
  }

  /* Lessons -------------------------------------------------------------- */

  public async listLessons(storeId: StoreId, category: DiscoveryCategory | null): Promise<readonly InsightLesson[]> {
    const plan = await this.planFor(storeId)
    if (plan === 'trial') return this.trialLessons(storeId)
    return this.deps.repository.listLessons(storeId, category)
  }

  private async trialLessons(storeId: StoreId): Promise<readonly InsightLesson[]> {
    const dataset = await this.datasetFor(storeId)
    const sample = generateLesson(dataset, 'REVENUE', { now: this.iso(), sample: true })
    const stored = await this.deps.repository.listLessons(storeId, null)
    return [...stored.filter((lesson) => lesson.sample), ...(sample ? [sample] : [])].slice(0, INSIGHTS_PLAN_LIMITS.trial.lessonsTotal)
  }

  public async generateLessons(storeId: StoreId, category: DiscoveryCategory | null): Promise<Readonly<{ generated: number; lessons: readonly InsightLesson[] }>> {
    await this.assertSubscriptionLive(storeId)
    const plan = await this.assertFeature(storeId, 'lessons')
    const limits = INSIGHTS_PLAN_LIMITS[plan]
    const used = await this.deps.repository.countLessonsThisMonth(storeId, this.monthStart())
    if (used >= limits.lessonsTotal) throw insightsLimitError('lessons', plan, used, limits.lessonsTotal, 'personalized lessons')
    const dataset = await this.datasetFor(storeId, true)
    const remaining = Math.max(1, limits.lessonsTotal - used)
    const lessons = category ? generateLessonLibrary(dataset, remaining, this.iso()).filter((lesson) => lesson.category === category) : generateLessonLibrary(dataset, remaining, this.iso())
    await this.deps.repository.upsertLessons(storeId, lessons)
    if (lessons.length > 0) await this.deps.repository.addTimelineEvents(timelineFromEntities({ lessons }))
    return { generated: lessons.length, lessons }
  }

  public async recommendedLessons(storeId: StoreId): Promise<readonly InsightLesson[]> {
    const plan = await this.planFor(storeId)
    if (plan === 'trial') return this.trialLessons(storeId)
    const lessons = await this.deps.repository.listLessons(storeId, null)
    return lessons.filter((lesson) => lesson.readAt === null).slice(0, 5)
  }

  public async getLesson(storeId: StoreId, id: string): Promise<InsightLesson> {
    const lesson = await this.deps.repository.getLesson(storeId, id)
    if (lesson) return lesson
    // Trial samples are generated on the fly and not persisted.
    const samples = await this.trialLessons(storeId)
    const sample = samples.find((entry) => entry.id === id)
    if (sample) return sample
    throw new AppError('NOT_FOUND', 'Lesson not found', 404, { id })
  }

  public async markLessonRead(storeId: StoreId, id: string): Promise<InsightLesson> {
    await this.assertFeature(storeId, 'lessons')
    const updated = await this.deps.repository.markLessonRead(storeId, id, this.iso())
    if (!updated) throw new AppError('NOT_FOUND', 'Lesson not found', 404, { id })
    return updated
  }
  public async rateLesson(storeId: StoreId, id: string, rating: number): Promise<InsightLesson> {
    await this.assertFeature(storeId, 'lessons')
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) throw new AppError('VALIDATION_ERROR', 'rating must be an integer between 0 and 5', 400, { rating })
    const updated = await this.deps.repository.rateLesson(storeId, id, rating)
    if (!updated) throw new AppError('NOT_FOUND', 'Lesson not found', 404, { id })
    return updated
  }
  public async bookmarkLesson(storeId: StoreId, id: string, bookmarked: boolean): Promise<InsightLesson> {
    await this.assertFeature(storeId, 'lessons')
    const updated = await this.deps.repository.bookmarkLesson(storeId, id, bookmarked)
    if (!updated) throw new AppError('NOT_FOUND', 'Lesson not found', 404, { id })
    return updated
  }

  /* Patterns ------------------------------------------------------------- */

  public async listPatterns(storeId: StoreId, type: string | null): Promise<Readonly<{ plan: PlanTier; viewOnly: boolean; patterns: readonly InsightPattern[] }>> {
    const plan = await this.planFor(storeId)
    const limits = INSIGHTS_PLAN_LIMITS[plan]
    return { plan, viewOnly: limits.patternsViewOnly, patterns: await this.deps.repository.listPatterns(storeId, type) }
  }

  public async detectPatternsForStore(storeId: StoreId): Promise<Readonly<{ detected: number; patterns: readonly InsightPattern[] }>> {
    await this.assertSubscriptionLive(storeId)
    const plan = await this.assertFeature(storeId, 'patterns')
    const limits = INSIGHTS_PLAN_LIMITS[plan]
    const dataset = await this.datasetFor(storeId, true)
    const detected = detectPatterns(dataset, Number.isFinite(limits.patternsLimit ?? Number.POSITIVE_INFINITY) ? (limits.patternsLimit ?? 5) : 50, this.iso())
    const stored = await this.deps.repository.upsertPatterns(storeId, detected)
    if (stored.length > 0) await this.deps.repository.addTimelineEvents(timelineFromEntities({ patterns: stored }))
    return { detected: stored.length, patterns: stored }
  }

  public async getPattern(storeId: StoreId, id: string): Promise<InsightPattern> {
    const pattern = await this.deps.repository.getPattern(storeId, id)
    if (!pattern) throw new AppError('NOT_FOUND', 'Pattern not found', 404, { id })
    return pattern
  }
  public async setPatternAlerts(storeId: StoreId, id: string, enabled: boolean): Promise<InsightPattern> {
    await this.assertFeature(storeId, 'patterns')
    const updated = await this.deps.repository.setPatternAlerts(storeId, id, enabled)
    if (!updated) throw new AppError('NOT_FOUND', 'Pattern not found', 404, { id })
    return updated
  }
  public async invalidatePattern(storeId: StoreId, id: string): Promise<void> {
    await this.assertFeature(storeId, 'patterns')
    if (!(await this.deps.repository.invalidatePattern(storeId, id))) throw new AppError('NOT_FOUND', 'Pattern not found', 404, { id })
  }

  /* Personas ------------------------------------------------------------- */

  public async listPersonas(storeId: StoreId): Promise<Readonly<{ plan: PlanTier; personas: readonly InsightPersona[]; readiness: InsightsDataReadiness }>> {
    const plan = await this.planFor(storeId)
    const readiness = insightsDataReadiness(await this.datasetFor(storeId))
    if (!insightsFeatureAccess(plan, 'personas').allowed) return { plan, personas: [], readiness }
    return { plan, personas: await this.deps.repository.listPersonas(storeId), readiness }
  }

  public async generatePersonas(storeId: StoreId): Promise<Readonly<{ generated: number; personas: readonly InsightPersona[]; readiness: InsightsDataReadiness }>> {
    await this.assertSubscriptionLive(storeId)
    const plan = await this.assertFeature(storeId, 'personas')
    const limits = INSIGHTS_PLAN_LIMITS[plan]
    const dataset = await this.datasetFor(storeId, true)
    const readiness = insightsDataReadiness(dataset)
    if (!readiness.canPersonas) return { generated: 0, personas: [], readiness }
    const personas = buildPersonas(dataset, limits.personasLimit, this.iso())
    await this.deps.repository.replacePersonas(storeId, personas)
    if (personas.length > 0) await this.deps.repository.addTimelineEvents(timelineFromEntities({ personas }))
    return { generated: personas.length, personas, readiness }
  }

  public async getPersona(storeId: StoreId, id: string): Promise<InsightPersona> {
    await this.assertFeature(storeId, 'personas')
    const persona = await this.deps.repository.getPersona(storeId, id)
    if (!persona) throw new AppError('NOT_FOUND', 'Persona not found', 404, { id })
    return persona
  }

  /** Aggregated, completely anonymized segment sample — never customer PII. */
  public async personaCustomers(storeId: StoreId, id: string): Promise<Readonly<{ personaId: string; customerCount: number; aggregate: Readonly<{ avgOrders: number; avgLifetimeValue: number; currency: string }>; anonymizedSample: readonly string[] }>> {
    await this.assertFeature(storeId, 'personas')
    const persona = await this.deps.repository.getPersona(storeId, id)
    if (!persona) throw new AppError('NOT_FOUND', 'Persona not found', 404, { id })
    const dataset = await this.datasetFor(storeId)
    const sample = Array.from({ length: Math.min(5, persona.customerCount) }, (_, index) => `Customer ${String(index + 1).padStart(2, '0')} of ${persona.customerCount}`)
    return {
      personaId: id,
      customerCount: persona.customerCount,
      aggregate: {
        avgOrders: dataset.customers.length > 0 ? round2(dataset.customers.reduce((sum, customer) => sum + customer.orderCount, 0) / dataset.customers.length) : 0,
        avgLifetimeValue: persona.customerCount > 0 ? round2(persona.estimatedRevenueImpact / persona.customerCount) : 0,
        currency: persona.revenueCurrency,
      },
      anonymizedSample: sample,
    }
  }

  /* Investigations ------------------------------------------------------- */

  public async investigateQuestion(storeId: StoreId, question: string): Promise<InsightInvestigation> {
    await this.assertSubscriptionLive(storeId)
    const plan = await this.assertFeature(storeId, 'investigations')
    const limits = INSIGHTS_PLAN_LIMITS[plan]
    const used = await this.deps.repository.countInvestigationsThisMonth(storeId, this.monthStart())
    if (used >= limits.investigationsPerMonth) throw insightsLimitError('investigations', plan, used, limits.investigationsPerMonth, 'Why? investigations')
    const dataset = await this.datasetFor(storeId, true)
    const result = investigate(question, dataset, this.iso())
    await this.deps.repository.createInvestigation(result)
    await this.deps.repository.addTimelineEvents(timelineFromEntities({ investigations: [result] }))
    return result
  }

  public async listInvestigations(storeId: StoreId, limit: number): Promise<readonly InsightInvestigation[]> {
    return this.deps.repository.listInvestigations(storeId, limit)
  }
  public async getInvestigation(storeId: StoreId, id: string): Promise<InsightInvestigation> {
    const investigation = await this.deps.repository.getInvestigation(storeId, id)
    if (!investigation) throw new AppError('NOT_FOUND', 'Investigation not found', 404, { id })
    return investigation
  }
  public async rateInvestigation(storeId: StoreId, id: string, rating: number): Promise<InsightInvestigation> {
    await this.assertFeature(storeId, 'investigations')
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) throw new AppError('VALIDATION_ERROR', 'rating must be an integer between 0 and 5', 400, { rating })
    const updated = await this.deps.repository.rateInvestigation(storeId, id, rating)
    if (!updated) throw new AppError('NOT_FOUND', 'Investigation not found', 404, { id })
    return updated
  }

  /* Trends --------------------------------------------------------------- */

  public async listTrends(storeId: StoreId, type: string | null): Promise<Readonly<{ plan: PlanTier; freshness: string; trends: readonly InsightTrend[] }>> {
    const plan = await this.planFor(storeId)
    let trends = await this.deps.repository.listTrends(storeId, type)
    const freshness = INSIGHTS_PLAN_LIMITS[plan].trendsFreshness
    if (trends.length === 0 && this.deps.env.trendMonitoring && plan !== 'trial') {
      // First visit: compute once so the dashboard is not empty when data allows.
      const dataset = await this.datasetFor(storeId)
      const detected = detectTrends(dataset, this.iso())
      if (detected.length > 0) trends = await this.deps.repository.upsertTrends(storeId, detected)
      if (type && type !== 'all') trends = trends.filter((trend) => trend.trendType === type)
    }
    return { plan, freshness, trends: type === 'market' ? trends.filter((trend) => trend.dataSource !== 'INTERNAL') : type === 'business' ? trends.filter((trend) => trend.trendType === 'BUSINESS') : trends }
  }

  public async marketTrends(storeId: StoreId): Promise<Readonly<{ available: false; message: string; trends: readonly never[] } | { available: true; message: string; trends: readonly InsightTrend[] }>> {
    const plan = await this.planFor(storeId)
    const access = insightsFeatureAccess(plan, 'externalTrends')
    if (!access.allowed) throw insightsUpgradeError('externalTrends', plan)
    const external = (await this.deps.repository.listTrends(storeId, null)).filter((trend) => trend.dataSource !== 'INTERNAL')
    if (!this.deps.env.externalTrends) return { available: false, message: 'External trend monitoring is disabled for this workspace (INSIGHTS_HUB_EXTERNAL_TRENDS=false).', trends: [] }
    if (external.length === 0) return { available: false, message: 'No external market trend feed is connected yet. Market trends appear here only when a verified public benchmark source is configured — Insights Hub never invents market data.', trends: [] }
    return { available: true, message: 'External market trends from the connected benchmark feed.', trends: external }
  }

  public async setTrendAlerts(storeId: StoreId, id: string, enabled: boolean): Promise<InsightTrend> {
    const plan = await this.planFor(storeId)
    if (enabled && !INSIGHTS_PLAN_LIMITS[plan].trendAlerts) throw insightsUpgradeError('anomalyAlerts', plan)
    const updated = await this.deps.repository.setTrendAlerts(storeId, id, enabled)
    if (!updated) throw new AppError('NOT_FOUND', 'Trend not found', 404, { id })
    return updated
  }

  /* Comparisons ---------------------------------------------------------- */

  public async createComparison(storeId: StoreId, comparisonType: ComparisonType, subjectA: string, subjectB: string): Promise<InsightComparison> {
    await this.assertSubscriptionLive(storeId)
    const plan = await this.assertFeature(storeId, 'comparisons')
    const limits = INSIGHTS_PLAN_LIMITS[plan]
    if (!limits.comparisonTypes.includes(comparisonType)) {
      throw new AppError('PAYMENT_REQUIRED', `${comparisonType.toLowerCase()} comparisons are not included in your current plan. Upgrade Plan to unlock all comparison types.`, 402, { reason: 'UPGRADE_REQUIRED', feature: 'comparisons', comparisonType, plan, requiredPlan: 'growth', cta: 'Upgrade Plan', upgradePath: '/billing' })
    }
    const dataset = await this.datasetFor(storeId)
    const comparison = runComparison(dataset, comparisonType, subjectA, subjectB, this.iso())
    await this.deps.repository.createComparison(comparison)
    await this.deps.repository.addTimelineEvents(timelineFromEntities({ comparisons: [comparison] }))
    return comparison
  }

  public async listComparisons(storeId: StoreId, type: string | null, limit: number): Promise<readonly InsightComparison[]> {
    return this.deps.repository.listComparisons(storeId, type, limit)
  }
  public async getComparison(storeId: StoreId, id: string): Promise<InsightComparison> {
    const comparison = await this.deps.repository.getComparison(storeId, id)
    if (!comparison) throw new AppError('NOT_FOUND', 'Comparison not found', 404, { id })
    return comparison
  }
  public async deleteComparison(storeId: StoreId, id: string): Promise<void> {
    if (!(await this.deps.repository.deleteComparison(storeId, id))) throw new AppError('NOT_FOUND', 'Comparison not found', 404, { id })
  }

  /* Knowledge base ------------------------------------------------------- */

  public async listKnowledge(storeId: StoreId, query: KnowledgeListQuery, search: string | null): Promise<readonly InsightKnowledgeEntry[]> {
    const rows = await this.deps.repository.listKnowledge(storeId, query)
    return search ? searchKnowledge(rows, search) : rows
  }
  public async getKnowledge(storeId: StoreId, id: string): Promise<InsightKnowledgeEntry> {
    const entry = await this.deps.repository.getKnowledge(storeId, id)
    if (!entry) throw new AppError('NOT_FOUND', 'Knowledge entry not found', 404, { id })
    return entry
  }
  public async createKnowledge(storeId: StoreId, input: Readonly<{ entryType: KnowledgeEntryType; title: string; contentMarkdown: string; tags?: readonly string[]; linkedInsights?: readonly string[] }>): Promise<InsightKnowledgeEntry> {
    const plan = await this.assertFeature(storeId, 'knowledge')
    const cap = KNOWLEDGE_CAPS[plan]
    const count = await this.deps.repository.countKnowledge(storeId)
    if (count >= cap) throw insightsLimitError('knowledge', plan, count, cap, 'knowledge entries')
    const title = input.title.trim()
    if (!title) throw new AppError('VALIDATION_ERROR', 'title is required', 400, { field: 'title' })
    if (title.length > 180) throw new AppError('VALIDATION_ERROR', 'title must be 180 characters or fewer', 400, { field: 'title' })
    if (input.contentMarkdown.length > 20_000) throw new AppError('VALIDATION_ERROR', 'content is too long (20,000 character cap)', 400, { field: 'contentMarkdown' })
    const suggested = suggestKnowledgeTags(title, input.contentMarkdown)
    const entry: InsightKnowledgeEntry = {
      id: `kb_${randomBytes(8).toString('hex')}`,
      storeId,
      entryType: input.entryType,
      title,
      contentMarkdown: input.contentMarkdown,
      tags: [...new Set([...(input.tags ?? []), ...suggested])].slice(0, 8),
      linkedInsights: (input.linkedInsights ?? []).slice(0, 20),
      author: 'MERCHANT',
      createdAt: this.iso(),
      updatedAt: this.iso(),
      referenceCount: 0,
    }
    return this.deps.repository.createKnowledge(entry)
  }
  public async updateKnowledge(storeId: StoreId, id: string, patch: Readonly<{ title?: string; contentMarkdown?: string; tags?: readonly string[] }>): Promise<InsightKnowledgeEntry> {
    await this.assertFeature(storeId, 'knowledge')
    const updated = await this.deps.repository.updateKnowledge(storeId, id, patch, this.iso())
    if (!updated) throw new AppError('NOT_FOUND', 'Knowledge entry not found', 404, { id })
    return updated
  }
  public async deleteKnowledge(storeId: StoreId, id: string): Promise<void> {
    await this.assertFeature(storeId, 'knowledge')
    if (!(await this.deps.repository.deleteKnowledge(storeId, id))) throw new AppError('NOT_FOUND', 'Knowledge entry not found', 404, { id })
  }

  /* Timeline ------------------------------------------------------------- */

  public async timeline(storeId: StoreId, days: number | null, types: readonly string[] | null): Promise<Readonly<{ plan: PlanTier; windowDays: number | null; events: readonly InsightTimelineEvent[] }>> {
    const plan = await this.planFor(storeId)
    const limitDays = INSIGHTS_PLAN_LIMITS[plan].timelineDays
    const effectiveDays = limitDays === null ? (days ?? 90) : Math.min(days ?? limitDays, limitDays)
    const capped = limitDays !== null && days !== null && days > limitDays
    if (capped) {
      throw new AppError('PAYMENT_REQUIRED', `Your plan includes ${limitDays} days of insight history. Upgrade Plan for unlimited history.`, 402, { reason: 'UPGRADE_REQUIRED', feature: 'timeline', plan, requiredPlan: 'commander', timelineDaysLimit: limitDays, cta: 'Upgrade Plan', upgradePath: '/billing' })
    }
    const sinceDay = new Date(this.now() - effectiveDays * 86_400_000).toISOString()
    const events = await this.deps.repository.listTimeline(storeId, sinceDay, types)
    return { plan, windowDays: limitDays, events }
  }

  /* Predictions ---------------------------------------------------------- */

  public async listPredictions(storeId: StoreId, horizon: PredictionHorizon | null): Promise<Readonly<{ plan: PlanTier; horizons: readonly PredictionHorizon[]; predictions: readonly InsightPrediction[]; readiness: InsightsDataReadiness }>> {
    const plan = await this.planFor(storeId)
    const limits = INSIGHTS_PLAN_LIMITS[plan]
    const readiness = insightsDataReadiness(await this.datasetFor(storeId))
    const predictions = insightsFeatureAccess(plan, 'predictions').allowed ? await this.deps.repository.listPredictions(storeId, horizon) : []
    return { plan, horizons: limits.predictionHorizons, predictions, readiness }
  }

  public async generatePredictions(storeId: StoreId): Promise<Readonly<{ generated: number; predictions: readonly InsightPrediction[] }>> {
    await this.assertSubscriptionLive(storeId)
    const plan = await this.assertFeature(storeId, 'predictions')
    const limits = INSIGHTS_PLAN_LIMITS[plan]
    const dataset = await this.datasetFor(storeId, true)
    const predictions: InsightPrediction[] = []
    for (const horizon of limits.predictionHorizons) {
      const revenue = forecastRevenue(dataset, horizon, this.iso())
      if (revenue) predictions.push(revenue)
      if (horizon !== '90_DAYS') {
        const orders = forecastOrders(dataset, horizon, this.iso())
        if (orders) predictions.push(orders)
      }
    }
    // Stockout velocity predictions are 30-day forecasts — they belong to
    // plans whose matrix includes the 30-day horizon (Growth+).
    if (limits.predictionHorizons.includes('30_DAYS') || limits.predictionHorizons.includes('90_DAYS')) {
      predictions.push(...predictStockouts(dataset, this.iso()))
    }
    await this.deps.repository.upsertPredictions(storeId, predictions)
    if (predictions.length > 0) await this.deps.repository.addTimelineEvents(timelineFromEntities({ predictions }))
    return { generated: predictions.length, predictions }
  }

  public async getPrediction(storeId: StoreId, id: string): Promise<InsightPrediction> {
    await this.assertFeature(storeId, 'predictions')
    const prediction = await this.deps.repository.getPrediction(storeId, id)
    if (!prediction) throw new AppError('NOT_FOUND', 'Prediction not found', 404, { id })
    return prediction
  }

  public async validatePredictionAccuracy(storeId: StoreId, id: string, actualValue: number): Promise<InsightPrediction> {
    await this.assertFeature(storeId, 'predictions')
    if (!Number.isFinite(actualValue) || actualValue < 0) throw new AppError('VALIDATION_ERROR', 'actualValue must be a non-negative number', 400, { actualValue })
    const existing = await this.deps.repository.getPrediction(storeId, id)
    if (!existing) throw new AppError('NOT_FOUND', 'Prediction not found', 404, { id })
    const accuracy = existing.predictedValue > 0 ? Math.max(0, round2(1 - Math.abs(actualValue - existing.predictedValue) / existing.predictedValue)) : actualValue === 0 ? 1 : 0
    const updated = await this.deps.repository.validatePrediction(storeId, id, actualValue, accuracy, this.iso())
    if (!updated) throw new AppError('NOT_FOUND', 'Prediction not found', 404, { id })
    return updated
  }

  /* Preferences ---------------------------------------------------------- */

  public async preferences(storeId: StoreId): Promise<InsightsPreferences> {
    const stored = await this.deps.repository.getPreferences(storeId)
    return stored ?? defaultInsightsPreferences(storeId, this.iso())
  }

  public async updatePreferences(storeId: StoreId, patch: InsightsPreferencesPatch): Promise<InsightsPreferences> {
    const plan = await this.planFor(storeId)
    const current = await this.preferences(storeId)
    if (patch.autoDiscoveryEnabled && !insightsFeatureAccess(plan, 'autoDiscovery').allowed) throw insightsUpgradeError('autoDiscovery', plan)
    if (patch.discoveryFrequency === 'REALTIME' && plan !== 'commander') throw insightsUpgradeError('autoDiscovery', plan)
    if (patch.language !== undefined && patch.language !== 'en' && patch.language !== 'hi') throw new AppError('VALIDATION_ERROR', 'language must be en or hi', 400, { language: patch.language })
    const next: InsightsPreferences = {
      ...current,
      autoDiscoveryEnabled: patch.autoDiscoveryEnabled ?? current.autoDiscoveryEnabled,
      discoveryFrequency: patch.discoveryFrequency ?? current.discoveryFrequency,
      discoveryCategories: patch.discoveryCategories ?? current.discoveryCategories,
      notificationPreferences: { ...current.notificationPreferences, ...(patch.notificationPreferences ?? {}) },
      trendMonitoringEnabled: patch.trendMonitoringEnabled ?? current.trendMonitoringEnabled,
      personaUpdatesEnabled: patch.personaUpdatesEnabled ?? current.personaUpdatesEnabled,
      language: patch.language ?? current.language,
      updatedAt: this.iso(),
    }
    await this.deps.repository.putPreferences(next, null)
    return next
  }

  /* API access (Commander) ------------------------------------------------ */

  public async generateApiKey(storeId: StoreId): Promise<Readonly<{ apiKey: string; masked: string; rateLimitPerHour: number | null }>> {
    await this.assertSubscriptionLive(storeId)
    const plan = await this.assertFeature(storeId, 'apiAccess')
    if (!this.deps.env.apiAccessEnabled) throw new AppError('DEPENDENCY_ERROR', 'Insights Hub API access is disabled on this workspace (INSIGHTS_HUB_API_ACCESS_ENABLED=false).', 503)
    const apiKey = generateInsightsApiKey()
    await this.deps.repository.updateApiKey(storeId, apiKey, maskApiKey(apiKey), true)
    return { apiKey, masked: maskApiKey(apiKey), rateLimitPerHour: INSIGHTS_PLAN_LIMITS[plan].apiRateLimitPerHour ?? this.deps.env.apiRateLimit }
  }

  public async apiAccessStatus(storeId: StoreId): Promise<Readonly<{ plan: PlanTier; enabled: boolean; maskedKey: string | null; rateLimitPerHour: number | null; usage: Readonly<{ requestsThisHour: number; requestsToday: number }>; recent: readonly Readonly<{ endpoint: string; calledAt: string; rateLimitRemaining: number | null }>[] }>> {
    const plan = await this.planFor(storeId)
    const preferences = await this.preferences(storeId)
    const hourAgo = new Date(this.now() - 3_600_000).toISOString()
    const dayAgo = new Date(this.now() - 86_400_000).toISOString()
    const [requestsThisHour, requestsToday, recent] = await Promise.all([
      this.deps.repository.countApiUsageSince(storeId, hourAgo),
      this.deps.repository.countApiUsageSince(storeId, dayAgo),
      this.deps.repository.recentApiUsage(storeId, 10),
    ])
    return {
      plan,
      enabled: preferences.apiAccessEnabled && insightsFeatureAccess(plan, 'apiAccess').allowed,
      maskedKey: preferences.apiKeyMasked,
      rateLimitPerHour: INSIGHTS_PLAN_LIMITS[plan].apiRateLimitPerHour,
      usage: { requestsThisHour, requestsToday },
      recent,
    }
  }

  /** Authenticates a public API call by Bearer key; enforces the hourly cap. */
  public async authenticatePublicApi(apiKey: string, endpoint: string): Promise<StoreId> {
    if (!this.deps.env.apiAccessEnabled) throw new AppError('DEPENDENCY_ERROR', 'Insights Hub public API is disabled on this workspace.', 503)
    const storeId = await this.deps.repository.findStoreByApiKey(apiKey)
    if (!storeId) throw new AppError('UNAUTHORIZED', 'Invalid or revoked Insights Hub API key', 401, { hint: 'Generate a key in Insights Hub → API Access' })
    const since = new Date(this.now() - 3_600_000).toISOString()
    const used = await this.deps.repository.countApiUsageSince(storeId, since)
    const limit = this.deps.env.apiRateLimit
    if (used >= limit) throw new AppError('RATE_LIMITED', `Insights Hub API rate limit reached (${limit} requests/hour). Retry later.`, 429, { limit, used, cta: null })
    await this.deps.repository.recordApiUsage(storeId, endpoint, 0, Math.max(0, limit - used - 1))
    return storeId
  }

  /* Usage + cost ----------------------------------------------------------- */

  public async usageSummary(storeId: StoreId): Promise<Readonly<{ plan: PlanTier; meters: readonly Readonly<{ feature: string; used: number; limit: number | null; percent: number; warning: boolean; blocked: boolean }>[] }>> {
    const plan = await this.planFor(storeId)
    const limits = INSIGHTS_PLAN_LIMITS[plan]
    const [discoveries, investigations, lessons] = await Promise.all([
      this.deps.repository.countDiscoveriesThisMonth(storeId, this.monthStart()),
      this.deps.repository.countInvestigationsThisMonth(storeId, this.monthStart()),
      this.deps.repository.countLessonsThisMonth(storeId, this.monthStart()),
    ])
    const meter = (feature: string, used: number, limit: number) => {
      const summary = summarizeUsage(used, limit)
      return { feature, used: summary.used, limit: Number.isFinite(limit) ? summary.limit : null, percent: summary.percent, warning: summary.warning, blocked: summary.blocked }
    }
    return {
      plan,
      meters: [
        meter(INSIGHTS_USAGE_FEATURES.discoveries, discoveries, limits.discoveriesPerMonth),
        meter(INSIGHTS_USAGE_FEATURES.investigations, investigations, limits.investigationsPerMonth),
        meter(INSIGHTS_USAGE_FEATURES.lessonsRead, lessons, limits.lessonsTotal),
      ],
    }
  }
}

/* ── Bootstrap factory (env → provider + service) ──────────────────────── */

export type InsightsHubBootstrap = Readonly<{
  env: InsightsHubEnvConfig
  provider: OpenRouterClient | null
  narrator: InsightsNarrator
}>

/**
 * Builds the dedicated OpenRouter client for Insights Hub. Uses ONLY
 * INSIGHTS_HUB_API_KEY — never the shared command-center keys — with the
 * Nemotron primary/fallback pair. Returns null when disabled or unkeyed so
 * the service degrades to pure deterministic output.
 */
export function createInsightsHubBootstrap(environment: Readonly<Record<string, string | undefined>>): InsightsHubBootstrap {
  const env = insightsHubEnvConfig(environment)
  if (!env.enabled || !env.apiKey) return { env, provider: null, narrator: createInsightsNarrator(null) }
  const provider = new OpenRouterClient({ keys: [env.apiKey], models: env.models, temperature: 0.35, maxTokens: 400 })
  return { env, provider, narrator: createInsightsNarrator(provider) }
}
