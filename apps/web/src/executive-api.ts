/**
 * GrowthIQ (formerly "AI Executive") — API client.
 *
 * Thin typed wrappers over the /ai-executive endpoints. All responses use
 * the standard `{ ok, data, requestId }` envelope handled by `requestJson`;
 * 402 UPGRADE_REQUIRED responses surface as ApiClientError with the
 * upgrade context attached in the message.
 */
import { requestJson } from './api.js'
import type {
  BenchmarkPosition,
  ExecutiveDashboard,
  ExecutiveDecision,
  ExecutiveHealthDiagnosis,
  ExecutiveOpportunity,
  ExecutivePdfJob,
  ExecutivePreferences,
  ExecutiveReport,
  ExecutiveRisk,
  ExecutiveRoadmap,
  ExecutiveScenario,
  ExecutiveUsage,
  ScenarioTemplate,
} from './executive-model.js'

const q = (storeId: string, extra: Readonly<Record<string, string | number>> = {}): string => {
  const params = new URLSearchParams({ storeId, ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [key, String(value)])) })
  return `?${params.toString()}`
}

export function fetchExecutiveDashboard(storeId: string): Promise<ExecutiveDashboard> {
  return requestJson<ExecutiveDashboard>(`/ai-executive/dashboard${q(storeId)}`)
}

export function fetchExecutiveUsage(storeId: string): Promise<ExecutiveUsage> {
  return requestJson<ExecutiveUsage>(`/ai-executive/usage${q(storeId)}`)
}

// Reports
export function fetchExecutiveReports(storeId: string, type?: string): Promise<readonly ExecutiveReport[]> {
  return requestJson<readonly ExecutiveReport[]>(`/ai-executive/reports${q(storeId, type ? { type } : {})}`)
}
export function fetchExecutiveReport(storeId: string, id: string): Promise<ExecutiveReport> {
  return requestJson<ExecutiveReport>(`/ai-executive/reports/${id}${q(storeId)}`)
}
export function generateExecutiveReport(storeId: string, input: Readonly<{ reportType?: string; periodStart?: string; periodEnd?: string }> = {}): Promise<ExecutiveReport> {
  return requestJson<ExecutiveReport>(`/ai-executive/reports/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, ...input }) })
}
export function markExecutiveReportViewed(storeId: string, id: string): Promise<ExecutiveReport> {
  return requestJson<ExecutiveReport>(`/ai-executive/reports/${id}/mark-viewed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) })
}
export function generateExecutiveReportPdf(storeId: string, id: string, whiteLabel?: Readonly<{ brandName?: string; logoText?: string; primaryColor?: string; footerText?: string }>): Promise<Readonly<{ jobId: string; status: string }>> {
  return requestJson<Readonly<{ jobId: string; status: string }>>(`/ai-executive/reports/${id}/pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, ...(whiteLabel ? { whiteLabel } : {}) }) })
}
export function fetchExecutivePdfJob(storeId: string, id: string, jobId: string): Promise<ExecutivePdfJob> {
  return requestJson<ExecutivePdfJob>(`/ai-executive/reports/${id}/pdf/status${q(storeId, { jobId })}`)
}
export function executivePdfDownloadUrl(id: string): string {
  return `/ai-executive/reports/${id}/pdf/download?storeId=${encodeURIComponent(localStorageStoreId() ?? '')}`
}
export function emailExecutiveReport(storeId: string, id: string, email?: string): Promise<Readonly<{ sent: boolean; messageId: string }>> {
  return requestJson<Readonly<{ sent: boolean; messageId: string }>>(`/ai-executive/reports/${id}/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, ...(email ? { email } : {}) }) })
}

// Benchmarks
export function fetchBenchmarkPosition(storeId: string, category?: string): Promise<BenchmarkPosition> {
  return requestJson<BenchmarkPosition>(`/ai-executive/benchmarks/position${q(storeId, category ? { category } : {})}`)
}
export function refreshBenchmarks(storeId: string): Promise<Readonly<{ refreshed: boolean; rows: number }>> {
  return requestJson<Readonly<{ refreshed: boolean; rows: number }>>(`/ai-executive/benchmarks/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) })
}

// Scenarios
export function fetchExecutiveScenarios(storeId: string): Promise<readonly ExecutiveScenario[]> {
  return requestJson<readonly ExecutiveScenario[]>(`/ai-executive/scenarios${q(storeId)}`)
}
export function fetchScenarioTemplates(): Promise<readonly ScenarioTemplate[]> {
  return requestJson<readonly ScenarioTemplate[]>('/ai-executive/scenarios/templates')
}
export function runExecutiveScenario(storeId: string, input: Readonly<{ scenarioType: string; title: string; description: string; inputs: Readonly<Record<string, number>> }>): Promise<ExecutiveScenario> {
  return requestJson<ExecutiveScenario>(`/ai-executive/scenarios`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, ...input }) })
}
export function deleteExecutiveScenario(storeId: string, id: string): Promise<Readonly<{ deleted: boolean }>> {
  return requestJson<Readonly<{ deleted: boolean }>>(`/ai-executive/scenarios/${id}${q(storeId)}`, { method: 'DELETE' })
}

// Health
export function fetchExecutiveHealth(storeId: string): Promise<ExecutiveHealthDiagnosis | null> {
  return requestJson<ExecutiveHealthDiagnosis | null>(`/ai-executive/health/current${q(storeId)}`)
}
export function runExecutiveDiagnosis(storeId: string): Promise<ExecutiveHealthDiagnosis> {
  return requestJson<ExecutiveHealthDiagnosis>(`/ai-executive/health/diagnose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) })
}
export function fetchExecutiveHealthHistory(storeId: string): Promise<readonly ExecutiveHealthDiagnosis[]> {
  return requestJson<readonly ExecutiveHealthDiagnosis[]>(`/ai-executive/health/history${q(storeId)}`)
}
export function fetchExecutiveHealthTrends(storeId: string): Promise<Readonly<{ points: readonly Readonly<{ diagnosedAt: string; score: number; status: string }>[] }>> {
  return requestJson<Readonly<{ points: readonly Readonly<{ diagnosedAt: string; score: number; status: string }>[] }>>(`/ai-executive/health/trends${q(storeId)}`)
}

// Opportunities
export function fetchExecutiveOpportunities(storeId: string): Promise<readonly ExecutiveOpportunity[]> {
  return requestJson<readonly ExecutiveOpportunity[]>(`/ai-executive/opportunities${q(storeId)}`)
}
export function generateExecutiveOpportunities(storeId: string): Promise<Readonly<{ opportunities: readonly ExecutiveOpportunity[]; generated: number }>> {
  return requestJson<Readonly<{ opportunities: readonly ExecutiveOpportunity[]; generated: number }>>(`/ai-executive/opportunities/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) })
}
export function updateExecutiveOpportunityStatus(storeId: string, id: string, status: string): Promise<ExecutiveOpportunity> {
  return requestJson<ExecutiveOpportunity>(`/ai-executive/opportunities/${id}/status${q(storeId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, status }) })
}

// Decisions
export function fetchExecutiveDecisions(storeId: string): Promise<readonly ExecutiveDecision[]> {
  return requestJson<readonly ExecutiveDecision[]>(`/ai-executive/decisions${q(storeId)}`)
}
export function logExecutiveDecision(storeId: string, input: Readonly<{ decisionType: string; title: string; description: string; decisionDate: string; predictedOutcome: Readonly<Record<string, number>> | null; actualOutcome: Readonly<Record<string, number>> | null }>): Promise<ExecutiveDecision> {
  return requestJson<ExecutiveDecision>(`/ai-executive/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, ...input, createdBy: 'merchant' }) })
}
export function reviewExecutiveDecision(storeId: string, id: string, actualOutcome: Readonly<Record<string, number>>): Promise<ExecutiveDecision> {
  return requestJson<ExecutiveDecision>(`/ai-executive/decisions/${id}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, actualOutcome }) })
}
export function deleteExecutiveDecision(storeId: string, id: string): Promise<Readonly<{ deleted: boolean }>> {
  return requestJson<Readonly<{ deleted: boolean }>>(`/ai-executive/decisions/${id}${q(storeId)}`, { method: 'DELETE' })
}
export function fetchExecutiveDecisionAnalytics(storeId: string): Promise<Readonly<{ total: number; reviewed: number; averageAccuracy: number | null; qualityDistribution: Readonly<Record<string, number>>; bestDecisions: readonly ExecutiveDecision[]; improvementAreas: readonly string[] }>> {
  return requestJson(`/ai-executive/decisions/analytics${q(storeId)}`)
}

// Risks
export function fetchExecutiveRisks(storeId: string): Promise<readonly ExecutiveRisk[]> {
  return requestJson<readonly ExecutiveRisk[]>(`/ai-executive/risks${q(storeId)}`)
}
export function runExecutiveRiskScan(storeId: string): Promise<Readonly<{ risks: readonly ExecutiveRisk[]; active: number }>> {
  return requestJson<Readonly<{ risks: readonly ExecutiveRisk[]; active: number }>>(`/ai-executive/risks/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) })
}
export function resolveExecutiveRisk(storeId: string, id: string): Promise<ExecutiveRisk> {
  return requestJson<ExecutiveRisk>(`/ai-executive/risks/${id}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId }) })
}
export function fetchExecutiveRiskTrends(storeId: string): Promise<Readonly<{ points: readonly Readonly<{ periodStart: string; active: number; critical: number; high: number }>[] }>> {
  return requestJson<Readonly<{ points: readonly Readonly<{ periodStart: string; active: number; critical: number; high: number }>[] }>>(`/ai-executive/risks/trends${q(storeId)}`)
}

// Roadmaps
export function fetchExecutiveRoadmaps(storeId: string): Promise<readonly ExecutiveRoadmap[]> {
  return requestJson<readonly ExecutiveRoadmap[]>(`/ai-executive/roadmaps${q(storeId)}`)
}
export function createExecutiveRoadmap(storeId: string, input: Readonly<{ roadmapType: string; goal?: string }>): Promise<ExecutiveRoadmap> {
  return requestJson<ExecutiveRoadmap>(`/ai-executive/roadmaps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, ...input }) })
}
export function markExecutiveMilestone(storeId: string, id: string, milestoneKey: string): Promise<ExecutiveRoadmap> {
  return requestJson<ExecutiveRoadmap>(`/ai-executive/roadmaps/${id}/mark-milestone`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, milestoneKey }) })
}
export function deleteExecutiveRoadmap(storeId: string, id: string): Promise<Readonly<{ deleted: boolean }>> {
  return requestJson<Readonly<{ deleted: boolean }>>(`/ai-executive/roadmaps/${id}${q(storeId)}`, { method: 'DELETE' })
}

// Preferences
export function fetchExecutivePreferences(storeId: string): Promise<ExecutivePreferences> {
  return requestJson<ExecutivePreferences>(`/ai-executive/preferences${q(storeId)}`)
}
export function saveExecutivePreferences(storeId: string, patch: Readonly<Record<string, unknown>>): Promise<ExecutivePreferences> {
  return requestJson<ExecutivePreferences>(`/ai-executive/preferences`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, ...patch }) })
}

function localStorageStoreId(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('storeId')
  } catch {
    return null
  }
}
