/**
 * PR #49 — AI Executive repositories.
 *
 * PostgreSQL-backed repositories for the nine AI Executive tables plus an
 * in-memory implementation for tests. All Postgres access runs inside
 * `withTenantContext` so the RLS `app.store_id` session is set and every
 * query stays tenant-isolated at the database layer as well as the route
 * layer. JSON columns are typed to the module models — nothing is cast
 * blindly, and malformed historical rows degrade to safe defaults instead
 * of throwing into the response.
 */
import { randomUUID } from 'node:crypto'
import { withTenantContext } from '@profitpilot/db'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { storeId } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type {
  BenchmarkPercentile,
  ExecutiveBenchmarkCategory,
  ExecutiveDecision,
  ExecutiveHealthDiagnosis,
  ExecutiveOpportunity,
  ExecutivePreferences,
  ExecutiveReport,
  ExecutiveRisk,
  ExecutiveRoadmap,
  ExecutiveScenario,
  RoadmapType,
} from './executive-model.js'
import { isBenchmarkCategory } from './executive-benchmarks.js'
import type { ExecutiveOpportunityDraft, ExecutiveRiskDraft } from './executive-analytics.js'
import { applyMilestoneClock, decisionAccuracyScore, decisionLessons, qualityRatingForAccuracy, roadmapProgressFromMilestones } from './executive-analytics.js'

// ────────────────────────────────────────────────────────────────────────────
// Public interface
// ────────────────────────────────────────────────────────────────────────────

export type ExecutiveReportCreate = Omit<ExecutiveReport, 'id' | 'storeId' | 'generatedAt' | 'viewedAt' | 'pdfUrl'> & { pdfUrl?: string | null }

export type ExecutiveDecisionInput = Readonly<{
  decisionType: ExecutiveDecision['decisionType']
  title: string
  description: string
  decisionDate: string
  predictedOutcome: Readonly<Record<string, number | string>> | null
  actualOutcome: Readonly<Record<string, number | string>> | null
  createdBy: string
}>

export type ExecutiveRoadmapInput = Readonly<{
  roadmapType: RoadmapType
  periodStart: string
  periodEnd: string
  title: string
  milestones: readonly ExecutiveRoadmap['milestones'][number][]
  expectedOutcomes: readonly string[]
  confidenceScore: number
}>

export type ExecutivePreferencesInput = Readonly<{
  monthlyReportEnabled?: boolean
  monthlyReportEmailEnabled?: boolean
  reportEmail?: string | null
  reportGenerationDay?: number
  riskAlertsEnabled?: boolean
  riskAlertSeverity?: ExecutivePreferences['riskAlertSeverity']
  benchmarkCategory?: ExecutiveBenchmarkCategory
  language?: ExecutivePreferences['language']
}>

export interface ExecutiveRepository {
  // Reports
  listReports(storeId: StoreId, limit: number): Promise<readonly ExecutiveReport[]>
  getReport(storeId: StoreId, id: string): Promise<ExecutiveReport | null>
  latestReport(storeId: StoreId): Promise<ExecutiveReport | null>
  createReport(storeId: StoreId, input: ExecutiveReportCreate): Promise<ExecutiveReport>
  markReportViewed(storeId: StoreId, id: string): Promise<ExecutiveReport | null>
  setReportPdfUrl(storeId: StoreId, id: string, pdfUrl: string): Promise<void>
  countReportsThisMonth(storeId: StoreId, monthStart: string): Promise<number>
  // Benchmarks
  benchmarkRows(category: string): Promise<readonly import('./executive-model.js').ExecutiveBenchmarkRow[]>
  // Scenarios
  listScenarios(storeId: StoreId, limit: number): Promise<readonly ExecutiveScenario[]>
  getScenario(storeId: StoreId, id: string): Promise<ExecutiveScenario | null>
  createScenario(storeId: StoreId, input: Omit<ExecutiveScenario, 'id' | 'storeId' | 'createdAt'>): Promise<ExecutiveScenario>
  deleteScenario(storeId: StoreId, id: string): Promise<boolean>
  countScenariosThisMonth(storeId: StoreId, monthStart: string): Promise<number>
  // Health
  latestDiagnosis(storeId: StoreId): Promise<ExecutiveHealthDiagnosis | null>
  diagnosisHistory(storeId: StoreId, limit: number): Promise<readonly ExecutiveHealthDiagnosis[]>
  saveDiagnosis(storeId: StoreId, input: Omit<ExecutiveHealthDiagnosis, 'id' | 'storeId'>): Promise<ExecutiveHealthDiagnosis>
  countDiagnosesThisMonth(storeId: StoreId, monthStart: string): Promise<number>
  // Opportunities
  listOpportunities(storeId: StoreId): Promise<readonly ExecutiveOpportunity[]>
  getOpportunity(storeId: StoreId, id: string): Promise<ExecutiveOpportunity | null>
  replaceActiveOpportunities(storeId: StoreId, drafts: readonly ExecutiveOpportunityDraft[]): Promise<readonly ExecutiveOpportunity[]>
  updateOpportunityStatus(storeId: StoreId, id: string, status: ExecutiveOpportunity['status']): Promise<ExecutiveOpportunity | null>
  countTrackedOpportunities(storeId: StoreId): Promise<number>
  // Decisions
  listDecisions(storeId: StoreId, limit: number): Promise<readonly ExecutiveDecision[]>
  getDecision(storeId: StoreId, id: string): Promise<ExecutiveDecision | null>
  createDecision(storeId: StoreId, input: ExecutiveDecisionInput): Promise<ExecutiveDecision>
  updateDecision(storeId: StoreId, id: string, patch: Partial<Pick<ExecutiveDecision, 'title' | 'description' | 'predictedOutcome' | 'actualOutcome'>>): Promise<ExecutiveDecision | null>
  reviewDecision(storeId: StoreId, id: string, actualOutcome: Readonly<Record<string, number | string>>): Promise<ExecutiveDecision | null>
  deleteDecision(storeId: StoreId, id: string): Promise<boolean>
  countDecisions(storeId: StoreId): Promise<number>
  // Risks
  listRisks(storeId: StoreId): Promise<readonly ExecutiveRisk[]>
  getRisk(storeId: StoreId, id: string): Promise<ExecutiveRisk | null>
  applyRiskScan(storeId: StoreId, detected: readonly ExecutiveRiskDraft[]): Promise<readonly ExecutiveRisk[]>
  updateRiskMitigation(storeId: StoreId, id: string, mitigationPlan: ExecutiveRisk['mitigationPlan']): Promise<ExecutiveRisk | null>
  resolveRisk(storeId: StoreId, id: string): Promise<ExecutiveRisk | null>
  countRiskScansThisMonth(storeId: StoreId, monthStart: string): Promise<number>
  // Roadmaps
  listRoadmaps(storeId: StoreId): Promise<readonly ExecutiveRoadmap[]>
  getRoadmap(storeId: StoreId, id: string): Promise<ExecutiveRoadmap | null>
  createRoadmap(storeId: StoreId, input: ExecutiveRoadmapInput): Promise<ExecutiveRoadmap>
  updateRoadmap(storeId: StoreId, id: string, patch: Partial<Pick<ExecutiveRoadmap, 'title' | 'milestones' | 'expectedOutcomes' | 'status' | 'confidenceScore'>>): Promise<ExecutiveRoadmap | null>
  deleteRoadmap(storeId: StoreId, id: string): Promise<boolean>
  countActiveRoadmaps(storeId: StoreId): Promise<number>
  // Preferences
  getPreferences(storeId: StoreId): Promise<ExecutivePreferences>
  savePreferences(storeId: StoreId, patch: ExecutivePreferencesInput): Promise<ExecutivePreferences>
  // Monthly scheduling
  storesDueForMonthlyReport(dayOfMonth: number, monthStart: string): Promise<readonly StoreId[]>
}

// ────────────────────────────────────────────────────────────────────────────
// Row mapping helpers
// ────────────────────────────────────────────────────────────────────────────

type JsonRow = QueryResultRow & Record<string, unknown>

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : {}
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? fallback)
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' && value.length > 0 ? value : null
}

// ────────────────────────────────────────────────────────────────────────────
// In-memory repository (tests)
// ────────────────────────────────────────────────────────────────────────────

export class InMemoryExecutiveRepository implements ExecutiveRepository {
  private readonly reports = new Map<string, ExecutiveReport>()
  private readonly benchmarks = new Map<string, import('./executive-model.js').ExecutiveBenchmarkRow[]>()
  private readonly scenarios = new Map<string, ExecutiveScenario>()
  private readonly diagnoses = new Map<string, ExecutiveHealthDiagnosis>()
  private readonly opportunities = new Map<string, ExecutiveOpportunity>()
  private readonly decisions = new Map<string, ExecutiveDecision>()
  private readonly risks = new Map<string, ExecutiveRisk>()
  private readonly roadmaps = new Map<string, ExecutiveRoadmap>()
  private readonly preferences = new Map<StoreId, ExecutivePreferences>()
  private readonly now: () => number

  public constructor(now: () => number = () => Date.now()) { this.now = now }

  private key(storeId: StoreId, id: string): string { return `${storeId}:${id}` }
  private monthStart(): string { return new Date(this.now()).toISOString().slice(0, 7) + '-01' }

  public seedBenchmarks(category: string, rows: readonly import('./executive-model.js').ExecutiveBenchmarkRow[]): void { this.benchmarks.set(category, [...rows]) }
  public seedReport(report: ExecutiveReport): void { this.reports.set(this.key(report.storeId, report.id), report) }
  public seedPreference(storeId: StoreId, patch: Partial<ExecutivePreferences> = {}): void {
    this.preferences.set(storeId, { storeId, monthlyReportEnabled: true, monthlyReportEmailEnabled: true, reportEmail: null, reportGenerationDay: 1, riskAlertsEnabled: true, riskAlertSeverity: 'HIGH', benchmarkCategory: 'Other', language: 'en', updatedAt: new Date(this.now()).toISOString(), ...patch })
  }

  public async listReports(storeId: StoreId, limit: number): Promise<readonly ExecutiveReport[]> {
    return [...this.reports.values()].filter((report) => report.storeId === storeId).sort((left, right) => right.generatedAt.localeCompare(left.generatedAt)).slice(0, limit)
  }
  public async getReport(storeId: StoreId, id: string): Promise<ExecutiveReport | null> { return this.reports.get(this.key(storeId, id)) ?? null }
  public async latestReport(storeId: StoreId): Promise<ExecutiveReport | null> { return (await this.listReports(storeId, 1))[0] ?? null }
  public async createReport(storeId: StoreId, input: ExecutiveReportCreate): Promise<ExecutiveReport> {
    const report: ExecutiveReport = { ...input, id: randomUUID(), storeId, pdfUrl: input.pdfUrl ?? null, generatedAt: new Date(this.now()).toISOString(), viewedAt: null }
    this.reports.set(this.key(storeId, report.id), report)
    return report
  }
  public async markReportViewed(storeId: StoreId, id: string): Promise<ExecutiveReport | null> {
    const existing = await this.getReport(storeId, id)
    if (!existing) return null
    const updated = { ...existing, viewedAt: new Date(this.now()).toISOString() }
    this.reports.set(this.key(storeId, id), updated)
    return updated
  }
  public async setReportPdfUrl(storeId: StoreId, id: string, pdfUrl: string): Promise<void> {
    const existing = await this.getReport(storeId, id)
    if (existing) this.reports.set(this.key(storeId, id), { ...existing, pdfUrl })
  }
  public async countReportsThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return (await this.listReports(storeId, 1000)).filter((report) => report.generatedAt.slice(0, 7) === monthStart.slice(0, 7)).length
  }

  public async benchmarkRows(category: string): Promise<readonly import('./executive-model.js').ExecutiveBenchmarkRow[]> { return this.benchmarks.get(category) ?? [] }

  public async listScenarios(storeId: StoreId, limit: number): Promise<readonly ExecutiveScenario[]> {
    return [...this.scenarios.values()].filter((scenario) => scenario.storeId === storeId).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit)
  }
  public async getScenario(storeId: StoreId, id: string): Promise<ExecutiveScenario | null> { return this.scenarios.get(this.key(storeId, id)) ?? null }
  public async createScenario(storeId: StoreId, input: Omit<ExecutiveScenario, 'id' | 'storeId' | 'createdAt'>): Promise<ExecutiveScenario> {
    const scenario: ExecutiveScenario = { ...input, id: randomUUID(), storeId, createdAt: new Date(this.now()).toISOString() }
    this.scenarios.set(this.key(storeId, scenario.id), scenario)
    return scenario
  }
  public async deleteScenario(storeId: StoreId, id: string): Promise<boolean> { return this.scenarios.delete(this.key(storeId, id)) }
  public async countScenariosThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return (await this.listScenarios(storeId, 1000)).filter((scenario) => scenario.createdAt.slice(0, 7) === monthStart.slice(0, 7)).length
  }

  public async latestDiagnosis(storeId: StoreId): Promise<ExecutiveHealthDiagnosis | null> {
    const rows = [...this.diagnoses.values()].filter((diagnosis) => diagnosis.storeId === storeId).sort((left, right) => right.diagnosedAt.localeCompare(left.diagnosedAt))
    return rows[0] ?? null
  }
  public async diagnosisHistory(storeId: StoreId, limit: number): Promise<readonly ExecutiveHealthDiagnosis[]> {
    return [...this.diagnoses.values()].filter((diagnosis) => diagnosis.storeId === storeId).sort((left, right) => right.diagnosedAt.localeCompare(left.diagnosedAt)).slice(0, limit)
  }
  public async saveDiagnosis(storeId: StoreId, input: Omit<ExecutiveHealthDiagnosis, 'id' | 'storeId'>): Promise<ExecutiveHealthDiagnosis> {
    const diagnosis: ExecutiveHealthDiagnosis = { ...input, id: randomUUID(), storeId }
    this.diagnoses.set(this.key(storeId, diagnosis.id), diagnosis)
    return diagnosis
  }
  public async countDiagnosesThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return (await this.diagnosisHistory(storeId, 1000)).filter((diagnosis) => diagnosis.diagnosedAt.slice(0, 7) === monthStart.slice(0, 7)).length
  }

  public async listOpportunities(storeId: StoreId): Promise<readonly ExecutiveOpportunity[]> {
    return [...this.opportunities.values()].filter((opportunity) => opportunity.storeId === storeId).sort((left, right) => right.estimatedImpactAnnual - left.estimatedImpactAnnual)
  }
  public async getOpportunity(storeId: StoreId, id: string): Promise<ExecutiveOpportunity | null> { return this.opportunities.get(this.key(storeId, id)) ?? null }
  public async replaceActiveOpportunities(storeId: StoreId, drafts: readonly ExecutiveOpportunityDraft[]): Promise<readonly ExecutiveOpportunity[]> {
    for (const [key, opportunity] of this.opportunities) {
      if (opportunity.storeId === storeId && opportunity.status === 'NEW') this.opportunities.delete(key)
    }
    const now = new Date(this.now()).toISOString()
    const created = drafts.map((draft) => ({ ...draft, id: randomUUID(), storeId, status: 'NEW' as const, identifiedAt: now, updatedAt: now }))
    for (const opportunity of created) this.opportunities.set(this.key(storeId, opportunity.id), opportunity)
    return created
  }
  public async updateOpportunityStatus(storeId: StoreId, id: string, status: ExecutiveOpportunity['status']): Promise<ExecutiveOpportunity | null> {
    const existing = await this.getOpportunity(storeId, id)
    if (!existing) return null
    const updated = { ...existing, status, updatedAt: new Date(this.now()).toISOString() }
    this.opportunities.set(this.key(storeId, id), updated)
    return updated
  }
  public async countTrackedOpportunities(storeId: StoreId): Promise<number> {
    return (await this.listOpportunities(storeId)).filter((opportunity) => opportunity.status === 'NEW' || opportunity.status === 'REVIEWING' || opportunity.status === 'PURSUING').length
  }

  public async listDecisions(storeId: StoreId, limit: number): Promise<readonly ExecutiveDecision[]> {
    return [...this.decisions.values()].filter((decision) => decision.storeId === storeId).sort((left, right) => right.decisionDate.localeCompare(left.decisionDate)).slice(0, limit)
  }
  public async getDecision(storeId: StoreId, id: string): Promise<ExecutiveDecision | null> { return this.decisions.get(this.key(storeId, id)) ?? null }
  public async createDecision(storeId: StoreId, input: ExecutiveDecisionInput): Promise<ExecutiveDecision> {
    const decision: ExecutiveDecision = {
      id: randomUUID(),
      storeId,
      decisionType: input.decisionType,
      title: input.title,
      description: input.description,
      decisionDate: input.decisionDate,
      predictedOutcome: input.predictedOutcome,
      actualOutcome: input.actualOutcome,
      accuracyScore: input.predictedOutcome && input.actualOutcome ? decisionAccuracyScore(input.predictedOutcome, input.actualOutcome) : null,
      qualityRating: input.predictedOutcome && input.actualOutcome ? qualityRatingForAccuracy(decisionAccuracyScore(input.predictedOutcome, input.actualOutcome)) : 'PENDING',
      lessonsLearned: input.predictedOutcome && input.actualOutcome ? decisionLessons(input.predictedOutcome, input.actualOutcome, decisionAccuracyScore(input.predictedOutcome, input.actualOutcome)) : '',
      createdBy: input.createdBy,
      createdAt: new Date(this.now()).toISOString(),
      reviewedAt: input.actualOutcome ? new Date(this.now()).toISOString() : null,
    }
    this.decisions.set(this.key(storeId, decision.id), decision)
    return decision
  }
  public async updateDecision(storeId: StoreId, id: string, patch: Partial<Pick<ExecutiveDecision, 'title' | 'description' | 'predictedOutcome' | 'actualOutcome'>>): Promise<ExecutiveDecision | null> {
    const existing = await this.getDecision(storeId, id)
    if (!existing) return null
    const predicted = patch.predictedOutcome !== undefined ? patch.predictedOutcome : existing.predictedOutcome
    const actual = patch.actualOutcome !== undefined ? patch.actualOutcome : existing.actualOutcome
    const accuracy = predicted && actual ? decisionAccuracyScore(predicted, actual) : null
    const updated: ExecutiveDecision = {
      ...existing,
      title: patch.title ?? existing.title,
      description: patch.description ?? existing.description,
      predictedOutcome: predicted,
      actualOutcome: actual,
      accuracyScore: accuracy,
      qualityRating: accuracy === null ? 'PENDING' : qualityRatingForAccuracy(accuracy),
      lessonsLearned: predicted && actual && accuracy !== null ? decisionLessons(predicted, actual, accuracy) : existing.lessonsLearned,
      reviewedAt: actual ? new Date(this.now()).toISOString() : existing.reviewedAt,
    }
    this.decisions.set(this.key(storeId, id), updated)
    return updated
  }
  public async reviewDecision(storeId: StoreId, id: string, actualOutcome: Readonly<Record<string, number | string>>): Promise<ExecutiveDecision | null> {
    return this.updateDecision(storeId, id, { actualOutcome })
  }
  public async deleteDecision(storeId: StoreId, id: string): Promise<boolean> { return this.decisions.delete(this.key(storeId, id)) }
  public async countDecisions(storeId: StoreId): Promise<number> { return (await this.listDecisions(storeId, 1000)).length }

  public async listRisks(storeId: StoreId): Promise<readonly ExecutiveRisk[]> {
    return [...this.risks.values()].filter((risk) => risk.storeId === storeId).sort(riskSeverityOrder).slice()
  }
  public async getRisk(storeId: StoreId, id: string): Promise<ExecutiveRisk | null> { return this.risks.get(this.key(storeId, id)) ?? null }
  public async applyRiskScan(storeId: StoreId, detected: readonly ExecutiveRiskDraft[]): Promise<readonly ExecutiveRisk[]> {
    const now = new Date(this.now()).toISOString()
    for (const [key, risk] of this.risks) {
      if (risk.storeId === storeId && risk.status === 'ACTIVE' && !detected.some((draft) => draft.riskType === risk.riskType && draft.title === risk.title)) {
        this.risks.set(key, { ...risk, status: 'RESOLVED' as const, resolvedAt: now })
      }
    }
    for (const draft of detected) {
      const existing = [...this.risks.values()].find((risk) => risk.storeId === storeId && risk.riskType === draft.riskType && risk.title === draft.title && risk.status === 'ACTIVE')
      if (existing) {
        this.risks.set(this.key(storeId, existing.id), { ...existing, ...draft })
      } else {
        const risk: ExecutiveRisk = { ...draft, id: randomUUID(), storeId, status: 'ACTIVE', detectedAt: now, resolvedAt: null }
        this.risks.set(this.key(storeId, risk.id), risk)
      }
    }
    return this.listRisks(storeId)
  }
  public async updateRiskMitigation(storeId: StoreId, id: string, mitigationPlan: ExecutiveRisk['mitigationPlan']): Promise<ExecutiveRisk | null> {
    const existing = await this.getRisk(storeId, id)
    if (!existing) return null
    const updated = { ...existing, mitigationPlan }
    this.risks.set(this.key(storeId, id), updated)
    return updated
  }
  public async resolveRisk(storeId: StoreId, id: string): Promise<ExecutiveRisk | null> {
    const existing = await this.getRisk(storeId, id)
    if (!existing) return null
    const updated = { ...existing, status: 'RESOLVED' as const, resolvedAt: new Date(this.now()).toISOString() }
    this.risks.set(this.key(storeId, id), updated)
    return updated
  }
  public async countRiskScansThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    const month = monthStart.slice(0, 7)
    return [...this.risks.values()].filter((risk) => risk.storeId === storeId && risk.detectedAt.slice(0, 7) === month).length > 0 ? 1 : 0
  }

  public async listRoadmaps(storeId: StoreId): Promise<readonly ExecutiveRoadmap[]> {
    return [...this.roadmaps.values()].filter((roadmap) => roadmap.storeId === storeId).sort((left, right) => right.periodStart.localeCompare(left.periodStart))
  }
  public async getRoadmap(storeId: StoreId, id: string): Promise<ExecutiveRoadmap | null> { return this.roadmaps.get(this.key(storeId, id)) ?? null }
  public async createRoadmap(storeId: StoreId, input: ExecutiveRoadmapInput): Promise<ExecutiveRoadmap> {
    const now = new Date(this.now()).toISOString()
    const milestones = applyMilestoneClock(input.milestones, this.now())
    const roadmap: ExecutiveRoadmap = {
      id: randomUUID(),
      storeId,
      roadmapType: input.roadmapType,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      title: input.title,
      milestones,
      expectedOutcomes: input.expectedOutcomes,
      confidenceScore: input.confidenceScore,
      currentProgress: roadmapProgressFromMilestones(milestones, this.now()),
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    }
    this.roadmaps.set(this.key(storeId, roadmap.id), roadmap)
    return roadmap
  }
  public async updateRoadmap(storeId: StoreId, id: string, patch: Partial<Pick<ExecutiveRoadmap, 'title' | 'milestones' | 'expectedOutcomes' | 'status' | 'confidenceScore'>>): Promise<ExecutiveRoadmap | null> {
    const existing = await this.getRoadmap(storeId, id)
    if (!existing) return null
    const milestones = patch.milestones ? applyMilestoneClock(patch.milestones, this.now()) : existing.milestones
    const updated: ExecutiveRoadmap = {
      ...existing,
      title: patch.title ?? existing.title,
      milestones,
      expectedOutcomes: patch.expectedOutcomes ?? existing.expectedOutcomes,
      confidenceScore: patch.confidenceScore ?? existing.confidenceScore,
      status: patch.status ?? existing.status,
      currentProgress: roadmapProgressFromMilestones(milestones, this.now()),
      updatedAt: new Date(this.now()).toISOString(),
    }
    this.roadmaps.set(this.key(storeId, id), updated)
    return updated
  }
  public async deleteRoadmap(storeId: StoreId, id: string): Promise<boolean> { return this.roadmaps.delete(this.key(storeId, id)) }
  public async countActiveRoadmaps(storeId: StoreId): Promise<number> {
    return (await this.listRoadmaps(storeId)).filter((roadmap) => roadmap.status === 'ACTIVE').length
  }

  public async getPreferences(storeId: StoreId): Promise<ExecutivePreferences> {
    const existing = this.preferences.get(storeId)
    if (existing) return existing
    const defaults: ExecutivePreferences = { storeId, monthlyReportEnabled: true, monthlyReportEmailEnabled: true, reportEmail: null, reportGenerationDay: 1, riskAlertsEnabled: true, riskAlertSeverity: 'HIGH', benchmarkCategory: 'Other', language: 'en', updatedAt: new Date(this.now()).toISOString() }
    this.preferences.set(storeId, defaults)
    return defaults
  }
  public async savePreferences(storeId: StoreId, patch: ExecutivePreferencesInput): Promise<ExecutivePreferences> {
    const existing = await this.getPreferences(storeId)
    const updated: ExecutivePreferences = {
      ...existing,
      monthlyReportEnabled: patch.monthlyReportEnabled ?? existing.monthlyReportEnabled,
      monthlyReportEmailEnabled: patch.monthlyReportEmailEnabled ?? existing.monthlyReportEmailEnabled,
      reportEmail: patch.reportEmail !== undefined ? patch.reportEmail : existing.reportEmail,
      reportGenerationDay: clampInt(patch.reportGenerationDay ?? existing.reportGenerationDay, 1, 28),
      riskAlertsEnabled: patch.riskAlertsEnabled ?? existing.riskAlertsEnabled,
      riskAlertSeverity: patch.riskAlertSeverity ?? existing.riskAlertSeverity,
      benchmarkCategory: patch.benchmarkCategory ?? existing.benchmarkCategory,
      language: patch.language ?? existing.language,
      updatedAt: new Date(this.now()).toISOString(),
    }
    this.preferences.set(storeId, updated)
    return updated
  }

  public async storesDueForMonthlyReport(dayOfMonth: number, monthStart: string): Promise<readonly StoreId[]> {
    const month = monthStart.slice(0, 7)
    const due: StoreId[] = []
    for (const [storeId, preferences] of this.preferences) {
      if (!preferences.monthlyReportEnabled || preferences.reportGenerationDay !== dayOfMonth) continue
      const hasReport = [...this.reports.values()].some((report) => report.storeId === storeId && report.reportType === 'MONTHLY' && report.generatedAt.slice(0, 7) === month)
      if (!hasReport) due.push(storeId)
    }
    return due
  }
}

function riskSeverityOrder(left: ExecutiveRisk, right: ExecutiveRisk): number {
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const
  if (left.status !== right.status) return left.status === 'ACTIVE' ? -1 : 1
  return order[left.severity] - order[right.severity]
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

// ────────────────────────────────────────────────────────────────────────────
// PostgreSQL repository
// ────────────────────────────────────────────────────────────────────────────

export class PostgresExecutiveRepository implements ExecutiveRepository {
  private readonly executor: SqlExecutor

  public constructor(executor: SqlExecutor) { this.executor = executor }

  // Reports
  public async listReports(storeId: StoreId, limit: number): Promise<readonly ExecutiveReport[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, report_type, report_period_start, report_period_end, executive_summary, content, pdf_url, generated_at, viewed_at FROM ai_executive_reports WHERE store_id = $1 ORDER BY report_period_start DESC LIMIT $2',
        [storeId, Math.min(Math.max(limit, 1), 100)],
      )
      return result.rows.map(mapReport)
    })
  }

  public async getReport(storeId: StoreId, id: string): Promise<ExecutiveReport | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, report_type, report_period_start, report_period_end, executive_summary, content, pdf_url, generated_at, viewed_at FROM ai_executive_reports WHERE store_id = $1 AND id = $2',
        [storeId, id],
      )
      return result.rows[0] ? mapReport(result.rows[0]) : null
    })
  }

  public async latestReport(storeId: StoreId): Promise<ExecutiveReport | null> {
    return (await this.listReports(storeId, 1))[0] ?? null
  }

  public async createReport(storeId: StoreId, input: ExecutiveReportCreate): Promise<ExecutiveReport> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const id = randomUUID()
      const result = await client.query<JsonRow>(
        `INSERT INTO ai_executive_reports (id, store_id, report_type, report_period_start, report_period_end, executive_summary, content, pdf_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         ON CONFLICT (store_id, report_type, report_period_start) DO UPDATE SET
           executive_summary = EXCLUDED.executive_summary, content = EXCLUDED.content, generated_at = now()
         RETURNING id, store_id, report_type, report_period_start, report_period_end, executive_summary, content, pdf_url, generated_at, viewed_at`,
        [id, storeId, input.reportType, input.periodStart, input.periodEnd, input.executiveSummary, JSON.stringify(input.content), input.pdfUrl ?? null],
      )
      return mapReport(result.rows[0]!)
    })
  }

  public async markReportViewed(storeId: StoreId, id: string): Promise<ExecutiveReport | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'UPDATE ai_executive_reports SET viewed_at = COALESCE(viewed_at, now()) WHERE store_id = $1 AND id = $2 RETURNING id, store_id, report_type, report_period_start, report_period_end, executive_summary, content, pdf_url, generated_at, viewed_at',
        [storeId, id],
      )
      return result.rows[0] ? mapReport(result.rows[0]) : null
    })
  }

  public async setReportPdfUrl(storeId: StoreId, id: string, pdfUrl: string): Promise<void> {
    await withTenantContext(this.executor, storeId, async (client) => {
      await client.query('UPDATE ai_executive_reports SET pdf_url = $3 WHERE store_id = $1 AND id = $2', [storeId, id, pdfUrl])
    })
  }

  public async countReportsThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM ai_executive_reports WHERE store_id = $1 AND generated_at >= $2::date AND generated_at < ($2::date + INTERVAL '1 month')",
        [storeId, monthStart],
      )
      return Number(result.rows[0]?.count ?? 0)
    })
  }

  // Benchmarks
  public async benchmarkRows(category: string): Promise<readonly import('./executive-model.js').ExecutiveBenchmarkRow[]> {
    const result = await this.executor.query<JsonRow>(
      `SELECT id, category, metric, percentile, value, currency, data_source, source_label, valid_from, valid_to
       FROM ai_executive_benchmarks
       WHERE category = $1 AND valid_to >= CURRENT_DATE
       ORDER BY metric, percentile`,
      [category],
    )
    return result.rows.map((row) => ({
      id: asString(row.id),
      category: asString(row.category),
      metric: asString(row.metric),
      percentile: Number(row.percentile) as BenchmarkPercentile,
      value: Number(row.value),
      currency: typeof row.currency === 'string' ? row.currency : null,
      dataSource: row.data_source === 'ANONYMIZED_INTERNAL' ? 'ANONYMIZED_INTERNAL' : 'SHOPIFY_PUBLIC',
      sourceLabel: asString(row.source_label),
      validFrom: asString(row.valid_from),
      validTo: asString(row.valid_to),
    }))
  }

  // Scenarios
  public async listScenarios(storeId: StoreId, limit: number): Promise<readonly ExecutiveScenario[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, scenario_type, title, description, inputs, predictions, confidence, risk_level, recommendation, created_at FROM ai_executive_scenarios WHERE store_id = $1 ORDER BY created_at DESC LIMIT $2',
        [storeId, Math.min(Math.max(limit, 1), 100)],
      )
      return result.rows.map(mapScenario)
    })
  }

  public async getScenario(storeId: StoreId, id: string): Promise<ExecutiveScenario | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, scenario_type, title, description, inputs, predictions, confidence, risk_level, recommendation, created_at FROM ai_executive_scenarios WHERE store_id = $1 AND id = $2',
        [storeId, id],
      )
      return result.rows[0] ? mapScenario(result.rows[0]) : null
    })
  }

  public async createScenario(storeId: StoreId, input: Omit<ExecutiveScenario, 'id' | 'storeId' | 'createdAt'>): Promise<ExecutiveScenario> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        `INSERT INTO ai_executive_scenarios (id, store_id, scenario_type, title, description, inputs, predictions, confidence, risk_level, recommendation)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
         RETURNING id, store_id, scenario_type, title, description, inputs, predictions, confidence, risk_level, recommendation, created_at`,
        [randomUUID(), storeId, input.scenarioType, input.title, input.description, JSON.stringify(input.inputs), JSON.stringify(input.predictions), input.confidence, input.riskLevel, input.recommendation],
      )
      return mapScenario(result.rows[0]!)
    })
  }

  public async deleteScenario(storeId: StoreId, id: string): Promise<boolean> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query('DELETE FROM ai_executive_scenarios WHERE store_id = $1 AND id = $2', [storeId, id])
      return result.rowCount > 0
    })
  }

  public async countScenariosThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM ai_executive_scenarios WHERE store_id = $1 AND created_at >= $2::date AND created_at < ($2::date + INTERVAL '1 month')",
        [storeId, monthStart],
      )
      return Number(result.rows[0]?.count ?? 0)
    })
  }

  // Health
  public async latestDiagnosis(storeId: StoreId): Promise<ExecutiveHealthDiagnosis | null> {
    return (await this.diagnosisHistory(storeId, 1))[0] ?? null
  }

  public async diagnosisHistory(storeId: StoreId, limit: number): Promise<readonly ExecutiveHealthDiagnosis[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, overall_score, overall_status, vital_signs, conditions, prescriptions, diagnosed_at, next_diagnosis_due FROM ai_executive_health_diagnoses WHERE store_id = $1 ORDER BY diagnosed_at DESC LIMIT $2',
        [storeId, Math.min(Math.max(limit, 1), 100)],
      )
      return result.rows.map(mapDiagnosis)
    })
  }

  public async saveDiagnosis(storeId: StoreId, input: Omit<ExecutiveHealthDiagnosis, 'id' | 'storeId'>): Promise<ExecutiveHealthDiagnosis> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        `INSERT INTO ai_executive_health_diagnoses (id, store_id, overall_score, overall_status, vital_signs, conditions, prescriptions, diagnosed_at, next_diagnosis_due)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
         RETURNING id, store_id, overall_score, overall_status, vital_signs, conditions, prescriptions, diagnosed_at, next_diagnosis_due`,
        [randomUUID(), storeId, input.overallScore, input.overallStatus, JSON.stringify(input.vitalSigns), JSON.stringify(input.conditions), JSON.stringify(input.prescriptions), input.diagnosedAt, input.nextDiagnosisDue],
      )
      return mapDiagnosis(result.rows[0]!)
    })
  }

  public async countDiagnosesThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM ai_executive_health_diagnoses WHERE store_id = $1 AND diagnosed_at >= $2::date AND diagnosed_at < ($2::date + INTERVAL '1 month')",
        [storeId, monthStart],
      )
      return Number(result.rows[0]?.count ?? 0)
    })
  }

  // Opportunities
  public async listOpportunities(storeId: StoreId): Promise<readonly ExecutiveOpportunity[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, category, title, description, estimated_impact_annual, impact_currency, confidence, effort_level, timeline, action_plan, status, identified_at, updated_at FROM ai_executive_opportunities WHERE store_id = $1 ORDER BY estimated_impact_annual DESC',
        [storeId],
      )
      return result.rows.map(mapOpportunity)
    })
  }

  public async getOpportunity(storeId: StoreId, id: string): Promise<ExecutiveOpportunity | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, category, title, description, estimated_impact_annual, impact_currency, confidence, effort_level, timeline, action_plan, status, identified_at, updated_at FROM ai_executive_opportunities WHERE store_id = $1 AND id = $2',
        [storeId, id],
      )
      return result.rows[0] ? mapOpportunity(result.rows[0]) : null
    })
  }

  public async replaceActiveOpportunities(storeId: StoreId, drafts: readonly ExecutiveOpportunityDraft[]): Promise<readonly ExecutiveOpportunity[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      await client.query("DELETE FROM ai_executive_opportunities WHERE store_id = $1 AND status = 'NEW'", [storeId])
      const created: ExecutiveOpportunity[] = []
      for (const draft of drafts) {
        const result = await client.query<JsonRow>(
          `INSERT INTO ai_executive_opportunities (id, store_id, category, title, description, estimated_impact_annual, impact_currency, confidence, effort_level, timeline, action_plan, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 'NEW')
           RETURNING id, store_id, category, title, description, estimated_impact_annual, impact_currency, confidence, effort_level, timeline, action_plan, status, identified_at, updated_at`,
          [randomUUID(), storeId, draft.category, draft.title, draft.description, draft.estimatedImpactAnnual, draft.impactCurrency, draft.confidence, draft.effortLevel, draft.timeline, JSON.stringify(draft.actionPlan)],
        )
        created.push(mapOpportunity(result.rows[0]!))
      }
      return created
    })
  }

  public async updateOpportunityStatus(storeId: StoreId, id: string, status: ExecutiveOpportunity['status']): Promise<ExecutiveOpportunity | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'UPDATE ai_executive_opportunities SET status = $3, updated_at = now() WHERE store_id = $1 AND id = $2 RETURNING id, store_id, category, title, description, estimated_impact_annual, impact_currency, confidence, effort_level, timeline, action_plan, status, identified_at, updated_at',
        [storeId, id, status],
      )
      return result.rows[0] ? mapOpportunity(result.rows[0]) : null
    })
  }

  public async countTrackedOpportunities(storeId: StoreId): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM ai_executive_opportunities WHERE store_id = $1 AND status IN ('NEW', 'REVIEWING', 'PURSUING')",
        [storeId],
      )
      return Number(result.rows[0]?.count ?? 0)
    })
  }

  // Decisions
  public async listDecisions(storeId: StoreId, limit: number): Promise<readonly ExecutiveDecision[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, decision_type, title, description, decision_date, predicted_outcome, actual_outcome, accuracy_score, quality_rating, lessons_learned, created_by, created_at, reviewed_at FROM ai_executive_decisions WHERE store_id = $1 ORDER BY decision_date DESC LIMIT $2',
        [storeId, Math.min(Math.max(limit, 1), 200)],
      )
      return result.rows.map(mapDecision)
    })
  }

  public async getDecision(storeId: StoreId, id: string): Promise<ExecutiveDecision | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, decision_type, title, description, decision_date, predicted_outcome, actual_outcome, accuracy_score, quality_rating, lessons_learned, created_by, created_at, reviewed_at FROM ai_executive_decisions WHERE store_id = $1 AND id = $2',
        [storeId, id],
      )
      return result.rows[0] ? mapDecision(result.rows[0]) : null
    })
  }

  public async createDecision(storeId: StoreId, input: ExecutiveDecisionInput): Promise<ExecutiveDecision> {
    const accuracy = input.predictedOutcome && input.actualOutcome ? decisionAccuracyScore(input.predictedOutcome, input.actualOutcome) : null
    const rating = accuracy === null ? 'PENDING' : qualityRatingForAccuracy(accuracy)
    const lessons = input.predictedOutcome && input.actualOutcome && accuracy !== null ? decisionLessons(input.predictedOutcome, input.actualOutcome, accuracy) : ''
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        `INSERT INTO ai_executive_decisions (id, store_id, decision_type, title, description, decision_date, predicted_outcome, actual_outcome, accuracy_score, quality_rating, lessons_learned, created_by, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, CASE WHEN $8::jsonb IS NOT NULL THEN now() END)
         RETURNING id, store_id, decision_type, title, description, decision_date, predicted_outcome, actual_outcome, accuracy_score, quality_rating, lessons_learned, created_by, created_at, reviewed_at`,
        [randomUUID(), storeId, input.decisionType, input.title, input.description, input.decisionDate, input.predictedOutcome ? JSON.stringify(input.predictedOutcome) : null, input.actualOutcome ? JSON.stringify(input.actualOutcome) : null, accuracy, rating, lessons, input.createdBy],
      )
      return mapDecision(result.rows[0]!)
    })
  }

  public async updateDecision(storeId: StoreId, id: string, patch: Partial<Pick<ExecutiveDecision, 'title' | 'description' | 'predictedOutcome' | 'actualOutcome'>>): Promise<ExecutiveDecision | null> {
    const existing = await this.getDecision(storeId, id)
    if (!existing) return null
    const predicted = patch.predictedOutcome !== undefined ? patch.predictedOutcome : existing.predictedOutcome
    const actual = patch.actualOutcome !== undefined ? patch.actualOutcome : existing.actualOutcome
    const accuracy = predicted && actual ? decisionAccuracyScore(predicted, actual) : null
    const rating = accuracy === null ? 'PENDING' : qualityRatingForAccuracy(accuracy)
    const lessons = predicted && actual && accuracy !== null ? decisionLessons(predicted, actual, accuracy) : existing.lessonsLearned
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        `UPDATE ai_executive_decisions SET
           title = $3, description = $4, predicted_outcome = $5::jsonb, actual_outcome = $6::jsonb,
           accuracy_score = $7, quality_rating = $8, lessons_learned = $9,
           reviewed_at = CASE WHEN $6::jsonb IS NOT NULL THEN COALESCE(reviewed_at, now()) ELSE reviewed_at END
         WHERE store_id = $1 AND id = $2
         RETURNING id, store_id, decision_type, title, description, decision_date, predicted_outcome, actual_outcome, accuracy_score, quality_rating, lessons_learned, created_by, created_at, reviewed_at`,
        [storeId, id, patch.title ?? existing.title, patch.description ?? existing.description, predicted ? JSON.stringify(predicted) : null, actual ? JSON.stringify(actual) : null, accuracy, rating, lessons],
      )
      return result.rows[0] ? mapDecision(result.rows[0]) : null
    })
  }

  public async reviewDecision(storeId: StoreId, id: string, actualOutcome: Readonly<Record<string, number | string>>): Promise<ExecutiveDecision | null> {
    return this.updateDecision(storeId, id, { actualOutcome })
  }

  public async deleteDecision(storeId: StoreId, id: string): Promise<boolean> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query('DELETE FROM ai_executive_decisions WHERE store_id = $1 AND id = $2', [storeId, id])
      return result.rowCount > 0
    })
  }

  public async countDecisions(storeId: StoreId): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM ai_executive_decisions WHERE store_id = $1', [storeId])
      return Number(result.rows[0]?.count ?? 0)
    })
  }

  // Risks
  public async listRisks(storeId: StoreId): Promise<readonly ExecutiveRisk[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, risk_type, title, description, severity, probability, impact_if_realized, impact_currency, mitigation_plan, status, detected_at, resolved_at FROM ai_executive_risks WHERE store_id = $1 ORDER BY detected_at DESC',
        [storeId],
      )
      return result.rows.map(mapRisk).sort(riskSeverityOrder)
    })
  }

  public async getRisk(storeId: StoreId, id: string): Promise<ExecutiveRisk | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, risk_type, title, description, severity, probability, impact_if_realized, impact_currency, mitigation_plan, status, detected_at, resolved_at FROM ai_executive_risks WHERE store_id = $1 AND id = $2',
        [storeId, id],
      )
      return result.rows[0] ? mapRisk(result.rows[0]) : null
    })
  }

  public async applyRiskScan(storeId: StoreId, detected: readonly ExecutiveRiskDraft[]): Promise<readonly ExecutiveRisk[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const active = await client.query<JsonRow>(
        "SELECT id, risk_type, title FROM ai_executive_risks WHERE store_id = $1 AND status = 'ACTIVE'",
        [storeId],
      )
      const detectedKeys = new Set(detected.map((draft) => `${draft.riskType}|${draft.title}`))
      for (const row of active.rows) {
        if (!detectedKeys.has(`${asString(row.risk_type)}|${asString(row.title)}`)) {
          await client.query("UPDATE ai_executive_risks SET status = 'RESOLVED', resolved_at = now() WHERE store_id = $1 AND id = $2", [storeId, asString(row.id)])
        }
      }
      for (const draft of detected) {
        const existing = await client.query<JsonRow>(
          "SELECT id FROM ai_executive_risks WHERE store_id = $1 AND status = 'ACTIVE' AND risk_type = $2 AND title = $3 ORDER BY detected_at DESC LIMIT 1",
          [storeId, draft.riskType, draft.title],
        )
        if (existing.rows[0]) {
          await client.query(
            `UPDATE ai_executive_risks SET description = $4, severity = $5, probability = $6, impact_if_realized = $7, impact_currency = $8, mitigation_plan = $9::jsonb
             WHERE store_id = $1 AND id = $2`,
            [storeId, asString(existing.rows[0].id), draft.riskType, draft.description, draft.severity, draft.probability, draft.impactIfRealized, draft.impactCurrency, JSON.stringify(draft.mitigationPlan)],
          )
        } else {
          await client.query(
            `INSERT INTO ai_executive_risks (id, store_id, risk_type, title, description, severity, probability, impact_if_realized, impact_currency, mitigation_plan)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
            [randomUUID(), storeId, draft.riskType, draft.title, draft.description, draft.severity, draft.probability, draft.impactIfRealized, draft.impactCurrency, JSON.stringify(draft.mitigationPlan)],
          )
        }
      }
      return this.listRisks(storeId)
    })
  }

  public async updateRiskMitigation(storeId: StoreId, id: string, mitigationPlan: ExecutiveRisk['mitigationPlan']): Promise<ExecutiveRisk | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'UPDATE ai_executive_risks SET mitigation_plan = $3::jsonb WHERE store_id = $1 AND id = $2 RETURNING id, store_id, risk_type, title, description, severity, probability, impact_if_realized, impact_currency, mitigation_plan, status, detected_at, resolved_at',
        [storeId, id, JSON.stringify(mitigationPlan)],
      )
      return result.rows[0] ? mapRisk(result.rows[0]) : null
    })
  }

  public async resolveRisk(storeId: StoreId, id: string): Promise<ExecutiveRisk | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        "UPDATE ai_executive_risks SET status = 'RESOLVED', resolved_at = now() WHERE store_id = $1 AND id = $2 RETURNING id, store_id, risk_type, title, description, severity, probability, impact_if_realized, impact_currency, mitigation_plan, status, detected_at, resolved_at",
        [storeId, id],
      )
      return result.rows[0] ? mapRisk(result.rows[0]) : null
    })
  }

  public async countRiskScansThisMonth(storeId: StoreId, monthStart: string): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<{ count: string }>(
        "SELECT COUNT(DISTINCT date_trunc('day', detected_at))::text AS count FROM ai_executive_risks WHERE store_id = $1 AND detected_at >= $2::date AND detected_at < ($2::date + INTERVAL '1 month')",
        [storeId, monthStart],
      )
      return Number(result.rows[0]?.count ?? 0)
    })
  }

  // Roadmaps
  public async listRoadmaps(storeId: StoreId): Promise<readonly ExecutiveRoadmap[]> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, roadmap_type, period_start, period_end, title, milestones, expected_outcomes, confidence_score, current_progress, status, created_at, updated_at FROM ai_executive_roadmaps WHERE store_id = $1 ORDER BY period_start DESC',
        [storeId],
      )
      return result.rows.map(mapRoadmap)
    })
  }

  public async getRoadmap(storeId: StoreId, id: string): Promise<ExecutiveRoadmap | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT id, store_id, roadmap_type, period_start, period_end, title, milestones, expected_outcomes, confidence_score, current_progress, status, created_at, updated_at FROM ai_executive_roadmaps WHERE store_id = $1 AND id = $2',
        [storeId, id],
      )
      return result.rows[0] ? mapRoadmap(result.rows[0]) : null
    })
  }

  public async createRoadmap(storeId: StoreId, input: ExecutiveRoadmapInput): Promise<ExecutiveRoadmap> {
    const milestones = applyMilestoneClock(input.milestones)
    const progress = roadmapProgressFromMilestones(milestones)
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        `INSERT INTO ai_executive_roadmaps (id, store_id, roadmap_type, period_start, period_end, title, milestones, expected_outcomes, confidence_score, current_progress, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, 'ACTIVE')
         RETURNING id, store_id, roadmap_type, period_start, period_end, title, milestones, expected_outcomes, confidence_score, current_progress, status, created_at, updated_at`,
        [randomUUID(), storeId, input.roadmapType, input.periodStart, input.periodEnd, input.title, JSON.stringify(milestones), JSON.stringify(input.expectedOutcomes), input.confidenceScore, progress],
      )
      return mapRoadmap(result.rows[0]!)
    })
  }

  public async updateRoadmap(storeId: StoreId, id: string, patch: Partial<Pick<ExecutiveRoadmap, 'title' | 'milestones' | 'expectedOutcomes' | 'status' | 'confidenceScore'>>): Promise<ExecutiveRoadmap | null> {
    const existing = await this.getRoadmap(storeId, id)
    if (!existing) return null
    const milestones = patch.milestones ? applyMilestoneClock(patch.milestones) : existing.milestones
    const progress = roadmapProgressFromMilestones(milestones)
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        `UPDATE ai_executive_roadmaps SET
           title = $3, milestones = $4::jsonb, expected_outcomes = $5::jsonb,
           confidence_score = $6, current_progress = $7, status = $8, updated_at = now()
         WHERE store_id = $1 AND id = $2
         RETURNING id, store_id, roadmap_type, period_start, period_end, title, milestones, expected_outcomes, confidence_score, current_progress, status, created_at, updated_at`,
        [storeId, id, patch.title ?? existing.title, JSON.stringify(milestones), JSON.stringify(patch.expectedOutcomes ?? existing.expectedOutcomes), patch.confidenceScore ?? existing.confidenceScore, progress, patch.status ?? existing.status],
      )
      return result.rows[0] ? mapRoadmap(result.rows[0]) : null
    })
  }

  public async deleteRoadmap(storeId: StoreId, id: string): Promise<boolean> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query('DELETE FROM ai_executive_roadmaps WHERE store_id = $1 AND id = $2', [storeId, id])
      return result.rowCount > 0
    })
  }

  public async countActiveRoadmaps(storeId: StoreId): Promise<number> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM ai_executive_roadmaps WHERE store_id = $1 AND status = 'ACTIVE'",
        [storeId],
      )
      return Number(result.rows[0]?.count ?? 0)
    })
  }

  // Preferences
  public async getPreferences(storeId: StoreId): Promise<ExecutivePreferences> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        'SELECT store_id, monthly_report_enabled, monthly_report_email_enabled, report_email, report_generation_day, risk_alerts_enabled, risk_alert_severity, benchmark_category, language, updated_at FROM ai_executive_preferences WHERE store_id = $1',
        [storeId],
      )
      if (result.rows[0]) return mapPreferences(result.rows[0])
      const defaults: ExecutivePreferences = { storeId, monthlyReportEnabled: true, monthlyReportEmailEnabled: true, reportEmail: null, reportGenerationDay: 1, riskAlertsEnabled: true, riskAlertSeverity: 'HIGH', benchmarkCategory: 'Other', language: 'en', updatedAt: new Date().toISOString() }
      await client.query(
        `INSERT INTO ai_executive_preferences (store_id) VALUES ($1) ON CONFLICT (store_id) DO NOTHING`,
        [storeId],
      )
      return defaults
    })
  }

  public async savePreferences(storeId: StoreId, patch: ExecutivePreferencesInput): Promise<ExecutivePreferences> {
    const existing = await this.getPreferences(storeId)
    const benchmarkCategory = patch.benchmarkCategory !== undefined ? patch.benchmarkCategory : existing.benchmarkCategory
    const safeCategory = isBenchmarkCategory(benchmarkCategory) ? benchmarkCategory : 'Other'
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<JsonRow>(
        `INSERT INTO ai_executive_preferences
           (store_id, monthly_report_enabled, monthly_report_email_enabled, report_email, report_generation_day, risk_alerts_enabled, risk_alert_severity, benchmark_category, language, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (store_id) DO UPDATE SET
           monthly_report_enabled = EXCLUDED.monthly_report_enabled,
           monthly_report_email_enabled = EXCLUDED.monthly_report_email_enabled,
           report_email = EXCLUDED.report_email,
           report_generation_day = EXCLUDED.report_generation_day,
           risk_alerts_enabled = EXCLUDED.risk_alerts_enabled,
           risk_alert_severity = EXCLUDED.risk_alert_severity,
           benchmark_category = EXCLUDED.benchmark_category,
           language = EXCLUDED.language,
           updated_at = now()
         RETURNING store_id, monthly_report_enabled, monthly_report_email_enabled, report_email, report_generation_day, risk_alerts_enabled, risk_alert_severity, benchmark_category, language, updated_at`,
        [
          storeId,
          patch.monthlyReportEnabled ?? existing.monthlyReportEnabled,
          patch.monthlyReportEmailEnabled ?? existing.monthlyReportEmailEnabled,
          patch.reportEmail !== undefined ? patch.reportEmail : existing.reportEmail,
          clampInt(patch.reportGenerationDay ?? existing.reportGenerationDay, 1, 28),
          patch.riskAlertsEnabled ?? existing.riskAlertsEnabled,
          patch.riskAlertSeverity ?? existing.riskAlertSeverity,
          safeCategory,
          patch.language ?? existing.language,
        ],
      )
      return mapPreferences(result.rows[0]!)
    })
  }

  public async storesDueForMonthlyReport(dayOfMonth: number, monthStart: string): Promise<readonly StoreId[]> {
    const result = await this.executor.query<JsonRow>(
      `SELECT p.store_id
       FROM ai_executive_preferences p
       JOIN billing_subscriptions b ON b.shop_id = p.store_id
       WHERE p.monthly_report_enabled = true
         AND p.report_generation_day = $1
         AND b.plan IN ('growth', 'commander')
         AND NOT EXISTS (
           SELECT 1 FROM ai_executive_reports r
           WHERE r.store_id = p.store_id AND r.report_type = 'MONTHLY'
             AND r.generated_at >= $2::date AND r.generated_at < ($2::date + INTERVAL '1 month')
         )`,
      [dayOfMonth, monthStart],
    )
    return result.rows.map((row) => storeId(asString(row.store_id)))
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Row mappers
// ────────────────────────────────────────────────────────────────────────────

function mapReport(row: JsonRow): ExecutiveReport {
  const content = asRecord(row.content)
  const forecast = asRecord(content.financialForecast)
  const projections = asArray(forecast.projections).map((item) => {
    const record = asRecord(item)
    return { label: asString(record.label), low: asNumber(record.low), expected: asNumber(record.expected), high: asNumber(record.high) }
  })
  const appendix: Record<string, Record<string, string | number | null>> = {}
  for (const [section, value] of Object.entries(asRecord(content.appendix))) {
    appendix[section] = Object.fromEntries(Object.entries(asRecord(value)).map(([key, entry]) => [key, typeof entry === 'string' || typeof entry === 'number' ? entry : null]))
  }
  return {
    id: asString(row.id),
    storeId: storeIdFrom(row.store_id),
    reportType: asString(row.report_type, 'MONTHLY') as ExecutiveReport['reportType'],
    periodStart: asString(row.report_period_start),
    periodEnd: asString(row.report_period_end),
    executiveSummary: asString(row.executive_summary),
    content: {
      strategicPosition: typeof content.strategicPosition === 'string' ? content.strategicPosition : null,
      keyInsights: asArray(content.keyInsights).map((item) => asString(item)).filter((item) => item.length > 0),
      recommendedDecisions: asArray(content.recommendedDecisions).map((item) => asString(item)).filter((item) => item.length > 0),
      financialForecast: forecast.horizonDays === undefined ? null : { horizonDays: asNumber(forecast.horizonDays, 90), currency: typeof forecast.currency === 'string' ? forecast.currency : 'USD', projections },
      appendix,
      aiNarrativeAvailable: asBoolean(content.aiNarrativeAvailable),
      generatedWithModel: typeof content.generatedWithModel === 'string' ? content.generatedWithModel : null,
    },
    pdfUrl: typeof row.pdf_url === 'string' ? row.pdf_url : null,
    generatedAt: toIso(row.generated_at) ?? '',
    viewedAt: toIso(row.viewed_at),
  }
}

function mapScenario(row: JsonRow): ExecutiveScenario {
  const predictions = asRecord(row.predictions)
  const baseline = asRecord(predictions.baseline)
  const projected = asRecord(predictions.projected)
  const delta = asRecord(predictions.delta)
  return {
    id: asString(row.id),
    storeId: storeIdFrom(row.store_id),
    scenarioType: asString(row.scenario_type, 'CUSTOM') as ExecutiveScenario['scenarioType'],
    title: asString(row.title),
    description: asString(row.description),
    inputs: numberRecord(asRecord(row.inputs)),
    predictions: {
      baseline: numberRecord(baseline),
      projected: numberRecord(projected),
      delta: numberRecord(delta),
      horizonMonths: asNumber(predictions.horizonMonths, 1),
      assumptions: asArray(predictions.assumptions).map((item) => asString(item)).filter((item) => item.length > 0),
      narrative: typeof predictions.narrative === 'string' ? predictions.narrative : null,
      currency: typeof predictions.currency === 'string' ? predictions.currency : 'USD',
    },
    confidence: asNumber(row.confidence),
    riskLevel: asString(row.risk_level, 'LOW') as ExecutiveScenario['riskLevel'],
    recommendation: asString(row.recommendation),
    narrative: typeof predictions.narrative === 'string' ? predictions.narrative : null,
    createdAt: toIso(row.created_at) ?? '',
  }
}

function mapDiagnosis(row: JsonRow): ExecutiveHealthDiagnosis {
  return {
    id: asString(row.id),
    storeId: storeIdFrom(row.store_id),
    overallScore: asNumber(row.overall_score),
    overallStatus: asString(row.overall_status, 'CRITICAL') as ExecutiveHealthDiagnosis['overallStatus'],
    vitalSigns: asArray(row.vital_signs).map((item) => {
      const record = asRecord(item)
      return {
        key: asString(record.key),
        label: asString(record.label),
        status: asString(record.status, 'NEEDS_ATTENTION') as ExecutiveHealthDiagnosis['vitalSigns'][number]['status'],
        value: record.value === null ? null : asNumber(record.value),
        formattedValue: asString(record.formattedValue),
        trend: asString(record.trend, 'unknown') as ExecutiveHealthDiagnosis['vitalSigns'][number]['trend'],
        explanation: asString(record.explanation),
        evidence: valueEvidence(asRecord(record.evidence)),
      }
    }),
    conditions: asArray(row.conditions).map((item) => {
      const record = asRecord(item)
      return { key: asString(record.key), title: asString(record.title), severity: asString(record.severity, 'RISK') as ExecutiveHealthDiagnosis['conditions'][number]['severity'], causes: asString(record.causes), treatment: asString(record.treatment) }
    }),
    prescriptions: asArray(row.prescriptions).map((item) => {
      const record = asRecord(item)
      return { title: asString(record.title), action: asString(record.action), timeframe: asString(record.timeframe) }
    }),
    diagnosedAt: toIso(row.diagnosed_at) ?? '',
    nextDiagnosisDue: typeof row.next_diagnosis_due === 'string' ? row.next_diagnosis_due : toIso(row.next_diagnosis_due),
  }
}

function mapOpportunity(row: JsonRow): ExecutiveOpportunity {
  return {
    id: asString(row.id),
    storeId: storeIdFrom(row.store_id),
    category: asString(row.category, 'PRODUCT') as ExecutiveOpportunity['category'],
    title: asString(row.title),
    description: asString(row.description),
    estimatedImpactAnnual: asNumber(row.estimated_impact_annual),
    impactCurrency: asString(row.impact_currency, 'USD'),
    confidence: asNumber(row.confidence),
    effortLevel: asString(row.effort_level, 'MEDIUM') as ExecutiveOpportunity['effortLevel'],
    timeline: asString(row.timeline, '30_DAYS') as ExecutiveOpportunity['timeline'],
    actionPlan: asArray(row.action_plan).map((item) => {
      const record = asRecord(item)
      return { step: asString(record.step), detail: asString(record.detail) }
    }),
    status: asString(row.status, 'NEW') as ExecutiveOpportunity['status'],
    identifiedAt: toIso(row.identified_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  }
}

function mapDecision(row: JsonRow): ExecutiveDecision {
  return {
    id: asString(row.id),
    storeId: storeIdFrom(row.store_id),
    decisionType: asString(row.decision_type, 'CUSTOM') as ExecutiveDecision['decisionType'],
    title: asString(row.title),
    description: asString(row.description),
    decisionDate: asString(row.decision_date),
    predictedOutcome: row.predicted_outcome === null || row.predicted_outcome === undefined ? null : valueRecord(asRecord(row.predicted_outcome)),
    actualOutcome: row.actual_outcome === null || row.actual_outcome === undefined ? null : valueRecord(asRecord(row.actual_outcome)),
    accuracyScore: row.accuracy_score === null || row.accuracy_score === undefined ? null : asNumber(row.accuracy_score),
    qualityRating: asString(row.quality_rating, 'PENDING') as ExecutiveDecision['qualityRating'],
    lessonsLearned: asString(row.lessons_learned),
    createdBy: asString(row.created_by, 'merchant'),
    createdAt: toIso(row.created_at) ?? '',
    reviewedAt: toIso(row.reviewed_at),
  }
}

function mapRisk(row: JsonRow): ExecutiveRisk {
  return {
    id: asString(row.id),
    storeId: storeIdFrom(row.store_id),
    riskType: asString(row.risk_type, 'MARKET') as ExecutiveRisk['riskType'],
    title: asString(row.title),
    description: asString(row.description),
    severity: asString(row.severity, 'MEDIUM') as ExecutiveRisk['severity'],
    probability: asNumber(row.probability),
    impactIfRealized: asNumber(row.impact_if_realized),
    impactCurrency: asString(row.impact_currency, 'USD'),
    mitigationPlan: asArray(row.mitigation_plan).map((item) => {
      const record = asRecord(item)
      return { step: asString(record.step), timeline: asString(record.timeline) }
    }),
    status: asString(row.status, 'ACTIVE') as ExecutiveRisk['status'],
    detectedAt: toIso(row.detected_at) ?? '',
    resolvedAt: toIso(row.resolved_at),
  }
}

function mapRoadmap(row: JsonRow): ExecutiveRoadmap {
  return {
    id: asString(row.id),
    storeId: storeIdFrom(row.store_id),
    roadmapType: asString(row.roadmap_type, '30_DAY') as ExecutiveRoadmap['roadmapType'],
    periodStart: asString(row.period_start),
    periodEnd: asString(row.period_end),
    title: asString(row.title),
    milestones: asArray(row.milestones).map((item) => {
      const record = asRecord(item)
      return {
        key: asString(record.key),
        title: asString(record.title),
        description: asString(record.description),
        dueDate: asString(record.dueDate),
        status: asString(record.status, 'PENDING') as ExecutiveRoadmap['milestones'][number]['status'],
        successMetrics: asArray(record.successMetrics).map((entry) => asString(entry)),
        dependencies: asArray(record.dependencies).map((entry) => asString(entry)),
      }
    }),
    expectedOutcomes: asArray(row.expected_outcomes).map((item) => asString(item)),
    confidenceScore: asNumber(row.confidence_score),
    currentProgress: asNumber(row.current_progress),
    status: asString(row.status, 'ACTIVE') as ExecutiveRoadmap['status'],
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  }
}

function mapPreferences(row: JsonRow): ExecutivePreferences {
  const category = asString(row.benchmark_category, 'Other')
  return {
    storeId: storeIdFrom(row.store_id),
    monthlyReportEnabled: asBoolean(row.monthly_report_enabled, true),
    monthlyReportEmailEnabled: asBoolean(row.monthly_report_email_enabled, true),
    reportEmail: typeof row.report_email === 'string' ? row.report_email : null,
    reportGenerationDay: clampInt(asNumber(row.report_generation_day, 1), 1, 28),
    riskAlertsEnabled: asBoolean(row.risk_alerts_enabled, true),
    riskAlertSeverity: asString(row.risk_alert_severity, 'HIGH') as ExecutivePreferences['riskAlertSeverity'],
    benchmarkCategory: isBenchmarkCategory(category) ? category : 'Other',
    language: asString(row.language, 'en') === 'hi' ? 'hi' : 'en',
    updatedAt: toIso(row.updated_at) ?? '',
  }
}

function numberRecord(record: Readonly<Record<string, unknown>>): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
}

function valueRecord(record: Readonly<Record<string, unknown>>): Readonly<Record<string, number | string>> {
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, number | string] => typeof entry[1] === 'number' || typeof entry[1] === 'string'))
}

function valueEvidence(record: Readonly<Record<string, unknown>>): Readonly<Record<string, string | number | boolean | null>> {
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string | number | boolean | null] => typeof entry[1] === 'string' || typeof entry[1] === 'number' || typeof entry[1] === 'boolean' || entry[1] === null))
}

function storeIdFrom(value: unknown): StoreId {
  return storeId(asString(value))
}
