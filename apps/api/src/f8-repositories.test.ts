import { describe, expect, it } from 'vitest'
import type { DatabaseResult, QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { PostgresCopilotRepository, PostgresJarvisRepository, PostgresReportRepository } from './f8-repositories.js'

const preference = { store_id: 'store-1', addressing: 'Sir' as const, language: 'auto' as const, engagement_mode: 'balanced' as const, silence_until: null, navigation_suggestions: true, only_answer_when_asked: false, updated_at: new Date(100) }
const session = { id: 'session-1', store_id: 'store-1', plan: 'growth' as const, active: true, paused: false, started_at: new Date(100), last_activity_at: new Date(100), last_page: 'dashboard', memory_expires_at: new Date(1000), undo_window_seconds: 120, nonsense_count: 0, pending_action: null, ended_at: null }
const message = { id: 'message-1', session_id: 'session-1', store_id: 'store-1', role: 'jarvis' as const, text: 'Ready', language: 'en' as const, mode: 'ANSWER' as const, evidence: null, created_at: new Date(100) }
const thread = { id: 'thread-1', store_id: 'store-1', title: 'Revenue', created_at: new Date(100), updated_at: new Date(100) }
const answer = { id: 'answer-1', thread_id: 'thread-1', store_id: 'store-1', query: 'revenue', intent: 'REVENUE_SUMMARY' as const, answer: 'Revenue: 189', clarification: null, evidence: { confidence: .9, confidenceLevel: 'HIGH', facts: [] }, slots: [{ name: 'N1', value: 189, formatted: '189', source: 'analytics' }], created_at: new Date(100) }
const run = { id: 'run-1', store_id: 'store-1', frequency: 'WEEKLY' as const, period_start: '2024-05-01', period_end: '2024-05-07', idempotency_key: 'WEEKLY:1:2', filename: 'report.pdf', object_key: 'reports/report.pdf', content_sha256: 'hash', status: 'COMPLETED' as const, email_status: 'EMAIL_UNAVAILABLE' as const, created_at: new Date(100), completed_at: new Date(200) }
const schedule = { id: 'schedule-1', store_id: 'store-1', frequency: 'WEEKLY' as const, enabled: true, next_run_at: new Date(300), version: 0 }
const reportRecord = { id: 'run-1', storeId: 'store-1', frequency: 'WEEKLY' as const, period: { start: '2024-05-01', end: '2024-05-07' }, idempotencyKey: 'WEEKLY:1:2', filename: 'report.pdf', objectKey: 'reports/report.pdf', contentSha256: 'hash', status: 'COMPLETED' as const, emailStatus: 'EMAIL_UNAVAILABLE' as const, createdAt: 100, completedAt: 200 }
const scheduleRecord = { id: 'schedule-1', storeId: 'store-1', frequency: 'WEEKLY' as const, enabled: true, nextRunAt: 300, version: 0 }

function makeExecutor(): { executor: SqlExecutor; queries: string[] } {
  const queries: string[] = []
  const value: SqlExecutor = { async query<Row extends QueryResultRow>(text: string): Promise<DatabaseResult<Row>> { queries.push(text); const row = text.includes('jarvis_preferences') ? preference : text.includes('jarvis_sessions') ? session : text.includes('jarvis_messages') ? message : text.includes('copilot_threads') ? thread : text.includes('copilot_answers') ? answer : text.includes('report_runs') ? run : text.includes('report_schedules') ? schedule : null; return { rows: row ? [row as unknown as Row] : [], rowCount: text.startsWith('INSERT') || text.startsWith('UPDATE') ? 1 : row ? 1 : 0 } } }
  return { executor: value, queries }
}

describe('F8 Postgres repositories', () => {
  it('maps Jarvis preferences, sessions, and messages with tenant-bound SQL', async () => {
    const { executor, queries } = makeExecutor()
    const repository = new PostgresJarvisRepository(executor)
    expect((await repository.getPreferences('store-1' as never))?.addressing).toBe('Sir')
    expect((await repository.savePreferences({ storeId: 'store-1' as never, addressing: 'Boss', language: 'en', engagementMode: 'quiet', silenceUntil: null, navigationSuggestions: true, onlyAnswerWhenAsked: false, updatedAt: 200 })).addressing).toBe('Boss')
    expect((await repository.getActiveSession('store-1' as never))?.plan).toBe('growth')
    expect((await repository.getSession('store-1' as never, 'session-1'))?.id).toBe('session-1')
    await repository.saveSession({ id: 'session-1', storeId: 'store-1' as never, plan: 'growth', active: true, paused: false, startedAt: 100, lastActivityAt: 100, lastPage: 'dashboard', memoryExpiresAt: 1000, undoWindowSeconds: 120, nonsenseCount: 0, pendingAction: null, endedAt: null })
    await repository.appendMessage({ id: 'message-1', sessionId: 'session-1', storeId: 'store-1' as never, role: 'merchant', text: 'hello', language: 'en', mode: 'ANSWER', evidence: null, createdAt: 100 })
    expect((await repository.listMessages('store-1' as never, 'session-1'))[0]?.text).toBe('Ready')
    expect(queries.every((query) => !query.includes('store-1'))).toBe(true)
  })

  it('casts nullable epoch parameters so Postgres can infer their types', async () => {
    // Regression: `CASE WHEN $5 IS NULL THEN NULL ELSE to_timestamp($5 / 1000.0) END`
    // leaves $5 without an inferable type and Postgres rejects the query with
    // "could not determine data type of parameter $5". The same pattern hit
    // jarvis_sessions.ended_at ($13).
    const { executor, queries } = makeExecutor()
    const repository = new PostgresJarvisRepository(executor)
    await repository.savePreferences({ storeId: 'store-1' as never, addressing: 'Sir', language: 'auto', engagementMode: 'balanced', silenceUntil: null, navigationSuggestions: true, onlyAnswerWhenAsked: false, updatedAt: 200 })
    await repository.saveSession({ id: 'session-1', storeId: 'store-1' as never, plan: 'trial', active: true, paused: false, startedAt: 100, lastActivityAt: 100, lastPage: 'dashboard', memoryExpiresAt: 1000, undoWindowSeconds: 60, nonsenseCount: 0, pendingAction: null, endedAt: null })
    const preferenceSql = queries.find((query) => query.includes('INSERT INTO jarvis_preferences')) ?? ''
    const sessionSql = queries.find((query) => query.includes('INSERT INTO jarvis_sessions')) ?? ''
    expect(preferenceSql).toContain('CASE WHEN $5::bigint IS NULL THEN NULL ELSE to_timestamp($5::bigint / 1000.0) END')
    expect(sessionSql).toContain('CASE WHEN $13::bigint IS NULL THEN NULL ELSE to_timestamp($13::bigint / 1000.0) END')
  })

  it('maps Copilot threads, answers, and report schedules/runs', async () => {
    const { executor } = makeExecutor()
    const copilot = new PostgresCopilotRepository(executor)
    expect((await copilot.createThread({ id: 'thread-1', storeId: 'store-1' as never, title: 'Revenue', createdAt: 100, updatedAt: 100 })).id).toBe('thread-1')
    expect((await copilot.getThread('store-1' as never, 'thread-1'))?.title).toBe('Revenue')
    expect((await copilot.listThreads('store-1' as never))).toHaveLength(1)
    await copilot.appendAnswer({ id: 'answer-1', threadId: 'thread-1', storeId: 'store-1' as never, query: 'revenue', intent: 'REVENUE_SUMMARY', answer: 'Revenue: 189', clarification: null, evidence: null, slots: [], createdAt: 100 })
    expect((await copilot.listAnswers('store-1' as never, 'thread-1'))[0]?.intent).toBe('REVENUE_SUMMARY')
    const reports = new PostgresReportRepository(executor)
    expect((await reports.listRuns('store-1'))[0]?.filename).toBe('report.pdf')
    expect((await reports.getRun('store-1', 'run-1'))?.status).toBe('COMPLETED')
    expect((await reports.getByIdempotency('store-1', 'key'))?.id).toBe('run-1')
    expect(await reports.createRunIfAbsent({ id: 'run-2', storeId: 'store-1', frequency: 'WEEKLY', period: { start: '2024-05-01', end: '2024-05-07' }, idempotencyKey: 'key', filename: 'report.pdf', objectKey: 'report.pdf', contentSha256: null, status: 'GENERATING', emailStatus: 'NOT_REQUESTED', createdAt: 100, completedAt: null })).toBe(true)
    await reports.updateRun(reportRecord)
    expect((await reports.listSchedules('store-1'))[0]?.frequency).toBe('WEEKLY')
    expect((await reports.saveSchedule(scheduleRecord)).id).toBe('schedule-1')
  })
})
