import { createHmac, createHash, randomUUID } from 'node:crypto'
import { AppError } from '@profitpilot/types'
import type { PlanTier } from '@profitpilot/types'
import { assertClosedPeriod, reportFileName } from './reports.js'
import type { ClosedPeriod, ReportFrequency } from './reports.js'
import { writePdf } from './exporters.js'
import type { ExportRow, ExportFile } from './exporters.js'

export type ReportRunStatus = 'GENERATING' | 'COMPLETED' | 'FAILED'
export type ReportEmailStatus = 'NOT_REQUESTED' | 'SENT' | 'EMAIL_UNAVAILABLE' | 'FAILED'
export type ReportSchedule = Readonly<{ id: string; storeId: string; frequency: ReportFrequency; enabled: boolean; nextRunAt: number; version: number }>
export type ReportRun = Readonly<{ id: string; storeId: string; frequency: ReportFrequency; period: ClosedPeriod; idempotencyKey: string; filename: string; objectKey: string; contentSha256: string | null; status: ReportRunStatus; emailStatus: ReportEmailStatus; createdAt: number; completedAt: number | null }>
export type ReportData = Readonly<{ storeId: string; currency: string | null; rows: readonly ExportRow[]; summary: string }>
export type ReportGeneration = Readonly<{ run: ReportRun; file: ExportFile | null }>

export interface ReportRepository {
  listRuns(storeId: string): Promise<readonly ReportRun[]>
  getRun(storeId: string, id: string): Promise<ReportRun | null>
  getByIdempotency(storeId: string, idempotencyKey: string): Promise<ReportRun | null>
  createRunIfAbsent(run: ReportRun): Promise<boolean>
  updateRun(run: ReportRun): Promise<void>
  listSchedules(storeId: string): Promise<readonly ReportSchedule[]>
  saveSchedule(schedule: ReportSchedule): Promise<ReportSchedule>
  saveBody?(storeId: string, id: string, body: Buffer): Promise<void>
  getBody?(storeId: string, id: string): Promise<Buffer | null>
}

export interface ReportObjectStore {
  put(objectKey: string, body: Buffer, contentType: string): Promise<Readonly<{ etag: string | null }>>
  get(objectKey: string): Promise<Buffer | null>
}

export interface ReportEmailDelivery {
  send(input: Readonly<{ storeId: string; filename: string; body: Buffer; subject: string }>): Promise<void>
}

export interface ReportDataProvider {
  get(storeId: string, frequency: ReportFrequency, period: ClosedPeriod): Promise<ReportData>
}

/** Minimal structured logger surface (see @profitpilot/logger). */
export interface ReportLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void
  warn(message: string, context?: Readonly<Record<string, unknown>>): void
  error(message: string, context?: Readonly<Record<string, unknown>>): void
}

/**
 * A `GENERATING` run older than this is treated as a crashed/orphaned
 * generation (process died mid-write, request timed out, …) and flipped to
 * FAILED so the merchant can retry instead of staring at a spinner forever.
 */
export const STALE_GENERATING_MS = 10 * 60 * 1000

/**
 * The billing_usage feature key reports are metered against. `null` limit means
 * unlimited (Commander); `0` means the plan does not include the requested
 * report kind (e.g. quarterly below Growth).
 */
export const REPORT_USAGE_FEATURE = 'reports'

/**
 * Server-side monthly report quota. `consume` atomically reserves one slot and
 * reports whether the reservation was allowed; `refund` releases a reserved
 * slot when generation fails so a failed attempt never burns a merchant's
 * monthly allowance.
 */
export interface ReportQuota {
  plan(storeId: string): Promise<PlanTier>
  limitFor(plan: PlanTier, frequency: ReportFrequency): number | null
  consume(storeId: string, limit: number | null): Promise<Readonly<{ allowed: boolean; used: number }>>
  refund(storeId: string): Promise<void>
}

export class InMemoryReportRepository implements ReportRepository {
  private readonly runs = new Map<string, ReportRun>()
  private readonly schedules = new Map<string, ReportSchedule>()
  private readonly bodies = new Map<string, Buffer>()
  public async listRuns(storeId: string): Promise<readonly ReportRun[]> { return [...this.runs.values()].filter((run) => run.storeId === storeId).sort((a, b) => b.createdAt - a.createdAt) }
  public async getRun(storeId: string, id: string): Promise<ReportRun | null> { const run = this.runs.get(id); return run?.storeId === storeId ? run : null }
  public async getByIdempotency(storeId: string, idempotencyKey: string): Promise<ReportRun | null> { return [...this.runs.values()].find((run) => run.storeId === storeId && run.idempotencyKey === idempotencyKey) ?? null }
  public async createRunIfAbsent(run: ReportRun): Promise<boolean> { if (this.runs.has(run.id)) return false; if ([...this.runs.values()].some((current) => current.storeId === run.storeId && current.idempotencyKey === run.idempotencyKey)) return false; this.runs.set(run.id, run); return true }
  public async updateRun(run: ReportRun): Promise<void> { this.runs.set(run.id, run) }
  public async listSchedules(storeId: string): Promise<readonly ReportSchedule[]> { return [...this.schedules.values()].filter((schedule) => schedule.storeId === storeId) }
  public async saveSchedule(schedule: ReportSchedule): Promise<ReportSchedule> { this.schedules.set(schedule.id, schedule); return schedule }
  public async saveBody(storeId: string, id: string, body: Buffer): Promise<void> { this.bodies.set(`${storeId}:${id}`, Buffer.from(body)) }
  public async getBody(storeId: string, id: string): Promise<Buffer | null> { const value = this.bodies.get(`${storeId}:${id}`); return value ? Buffer.from(value) : null }
}

export class InMemoryReportObjectStore implements ReportObjectStore {
  private readonly objects = new Map<string, Buffer>()
  public async put(objectKey: string, body: Buffer): Promise<Readonly<{ etag: string }>> { this.objects.set(objectKey, Buffer.from(body)); return { etag: createHash('sha256').update(body).digest('hex') } }
  public async get(objectKey: string): Promise<Buffer | null> { const value = this.objects.get(objectKey); return value ? Buffer.from(value) : null }
}

export type CloudflareR2Config = Readonly<{ endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; fetcher?: (input: string, init: RequestInit) => Promise<Response> }>

export class CloudflareR2ObjectStore implements ReportObjectStore {
  private readonly config: Readonly<{ endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; fetcher: (input: string, init: RequestInit) => Promise<Response> }>
  public constructor(config: CloudflareR2Config) {
    if (!config.endpoint.startsWith('https://') || !config.bucket.trim() || !config.accessKeyId.trim() || !config.secretAccessKey.trim()) throw new TypeError('Cloudflare R2 configuration is incomplete')
    this.config = { ...config, endpoint: config.endpoint.replace(/\/$/, ''), fetcher: config.fetcher ?? fetch }
  }
  public async put(objectKey: string, body: Buffer, contentType = 'application/pdf'): Promise<Readonly<{ etag: string | null }>> {
    const response = await this.request('PUT', objectKey, body, contentType)
    if (!response.ok) throw new AppError('DEPENDENCY_ERROR', `Cloudflare R2 upload failed with ${response.status}`, 503)
    return { etag: response.headers.get('etag') }
  }
  public async get(objectKey: string): Promise<Buffer | null> {
    const response = await this.request('GET', objectKey, null, '')
    if (response.status === 404) return null
    if (!response.ok) throw new AppError('DEPENDENCY_ERROR', `Cloudflare R2 download failed with ${response.status}`, 503)
    return Buffer.from(await response.arrayBuffer())
  }
  private async request(method: 'GET' | 'PUT', objectKey: string, body: Buffer | null, contentType: string): Promise<Response> {
    const url = `${this.config.endpoint}/${this.config.bucket}/${objectKey.split('/').map(encodeURIComponent).join('/')}`
    const parsed = new URL(url)
    const payloadHash = body ? createHash('sha256').update(body).digest('hex') : createHash('sha256').update('', 'utf8').digest('hex')
    const now = new Date()
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const shortDate = amzDate.slice(0, 8)
    const headers: Record<string, string> = { host: parsed.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
    if (contentType) headers['content-type'] = contentType
    const signedHeaders = Object.keys(headers).sort().join(';')
    const canonicalHeaders = Object.keys(headers).sort().map((key) => `${key}:${headers[key]?.trim()}\n`).join('')
    const canonicalRequest = [method, parsed.pathname, parsed.search.slice(1), canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const scope = `${shortDate}/auto/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
    const signingKey = hmac(hmac(hmac(hmac(Buffer.from(`AWS4${this.config.secretAccessKey}`), shortDate), 'auto'), 's3'), 'aws4_request')
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    const init: RequestInit = body === null ? { method, headers } : { method, headers, body }
    return this.config.fetcher(url, init)
  }
}

export class ReportService {
  private readonly repository: ReportRepository
  private readonly objectStore: ReportObjectStore | null
  private readonly dataProvider: ReportDataProvider
  private readonly delivery: ReportEmailDelivery | null
  private readonly now: () => number
  private readonly quota: ReportQuota | null
  private readonly logger: ReportLogger | null
  public constructor(repository: ReportRepository, objectStore: ReportObjectStore | null, dataProvider: ReportDataProvider, delivery: ReportEmailDelivery | null = null, now: () => number = () => Date.now(), quota: ReportQuota | null = null, logger: ReportLogger | null = null) { this.repository = repository; this.objectStore = objectStore; this.dataProvider = dataProvider; this.delivery = delivery; this.now = now; this.quota = quota; this.logger = logger }

  /**
   * Marks runs that were left in `GENERATING` by a crashed/interrupted worker
   * as `FAILED` so merchants always see a terminal state (Retry) instead of a
   * permanent "Processing…". Runs newer than {@link STALE_GENERATING_MS} are
   * left alone — they may genuinely still be generating.
   */
  public async recoverStaleRuns(storeId: string): Promise<readonly ReportRun[]> {
    const now = this.now()
    const runs = await this.repository.listRuns(storeId)
    for (const run of runs) {
      if (run.status !== 'GENERATING' || now - run.createdAt < STALE_GENERATING_MS) continue
      const failed: ReportRun = { ...run, status: 'FAILED', emailStatus: 'NOT_REQUESTED', completedAt: now }
      await this.repository.updateRun(failed).catch(() => undefined)
      this.logger?.warn(`[REPORTS] Recovered stale GENERATING run ${run.id} (created ${run.createdAt}) as FAILED`, { storeId, reportId: run.id, frequency: run.frequency })
    }
    return runs.map((run) => (run.status === 'GENERATING' && now - run.createdAt >= STALE_GENERATING_MS ? { ...run, status: 'FAILED' as const, emailStatus: 'NOT_REQUESTED' as const, completedAt: now } : run))
  }

  public async list(storeId: string): Promise<readonly ReportRun[]> { await this.recoverStaleRuns(storeId); return this.repository.listRuns(storeId) }
  public async get(storeId: string, id: string): Promise<ReportRun> { const run = await this.repository.getRun(storeId, id); if (!run) throw new AppError('NOT_FOUND', 'Report run not found', 404); return run }
  public async generate(input: Readonly<{ storeId: string; frequency: ReportFrequency; period: ClosedPeriod; email: boolean }>): Promise<ReportGeneration> {
    try {
      assertClosedPeriod(input.period, new Date(this.now()))
    } catch (error: unknown) {
      // Invalid periods are a client mistake, not a server fault: surface them
      // as a 400 validation error instead of a 500 INTERNAL_ERROR.
      throw new AppError('VALIDATION_ERROR', error instanceof Error && error.message.trim() ? error.message : 'Reports only support closed periods', 400)
    }
    const idempotencyKey = `${input.frequency}:${input.period.start}:${input.period.end}`
    const existing = await this.repository.getByIdempotency(input.storeId, idempotencyKey)
    // A run that is still GENERATING but older than the staleness window is a
    // crashed generation — recover it to FAILED and start fresh so the store
    // is never stuck in "Processing…" forever.
    if (existing?.status === 'GENERATING' && this.now() - existing.createdAt >= STALE_GENERATING_MS) {
      const stale = { ...existing, status: 'FAILED' as const, emailStatus: 'NOT_REQUESTED' as const, completedAt: this.now() }
      await this.repository.updateRun(stale).catch(() => undefined)
      this.logger?.warn(`[REPORTS] Stale GENERATING run ${existing.id} recovered to FAILED before retry`, { storeId: input.storeId, reportId: existing.id, frequency: input.frequency })
    }
    if (existing?.status === 'COMPLETED') {
      const stored = await this.readStoredBody(existing)
      const file = stored ? { filename: existing.filename, contentType: 'application/pdf', body: stored } : null
      // Regenerating the same period is idempotent, but a request to email an
      // already-generated report must still deliver (and persist) the email —
      // otherwise the vault's "Email" button would report success while
      // sending nothing.
      if (input.email && existing.emailStatus !== 'SENT') {
        const emailed = await this.sendEmail(existing, stored)
        await this.repository.updateRun(emailed)
        return { run: emailed, file }
      }
      return { run: existing, file }
    }
    // Reserve the monthly quota before doing any work. The reservation is
    // atomic (INSERT ... ON CONFLICT DO UPDATE ... WHERE used < limit), so two
    // concurrent requests can't both claim the last available slot. A reserved
    // slot is refunded below if generation fails.
    let reserved = false
    if (this.quota) {
      const plan = await this.quota.plan(input.storeId)
      const limit = this.quota.limitFor(plan, input.frequency)
      const decision = await this.quota.consume(input.storeId, limit)
      if (!decision.allowed) {
        throw new AppError('PAYMENT_REQUIRED', reportQuotaMessage(plan, input.frequency, decision.used, limit), 402, { reason: 'UPGRADE_REQUIRED', feature: REPORT_USAGE_FEATURE, plan, frequency: input.frequency, used: decision.used, limit: limit ?? 0 })
      }
      reserved = true
    }
    let run: ReportRun | null = null
    try {
      const startedAt = this.now()
      this.logger?.info(`[REPORTS] Started generating report`, { storeId: input.storeId, frequency: input.frequency, periodStart: input.period.start, periodEnd: input.period.end, idempotencyKey })
      const data = await this.dataProvider.get(input.storeId, input.frequency, input.period)
      const filename = reportFileName(input.storeId, input.frequency, input.period)
      const rows: readonly ExportRow[] = [{ section: 'Executive summary', metric: 'summary', value: data.summary, source: 'reporting' }, { section: 'Standard sections', metric: 'currency', value: data.currency, source: 'store configuration' }, ...data.rows]
      const file = writePdf(filename, rows)
      const objectKey = `reports/${input.storeId}/${filename}`
      const hash = createHash('sha256').update(file.body).digest('hex')
      const now = this.now()
      run = { id: existing?.id ?? randomUUID(), storeId: input.storeId, frequency: input.frequency, period: input.period, idempotencyKey, filename, objectKey, contentSha256: hash, status: 'GENERATING', emailStatus: 'NOT_REQUESTED', createdAt: existing?.createdAt ?? now, completedAt: null }
      this.logger?.info(`[REPORTS] Started generating report ${run.id}`, { storeId: input.storeId, reportId: run.id, frequency: input.frequency, bytes: file.body.byteLength })
      if (existing?.status === 'GENERATING' || existing?.status === 'FAILED') await this.repository.updateRun(run)
      else if (!(await this.repository.createRunIfAbsent(run))) {
        const concurrent = await this.repository.getByIdempotency(input.storeId, idempotencyKey)
        if (concurrent?.status === 'COMPLETED') {
          // Another request already finished this exact report and consumed the
          // quota; release this request's reservation and hand back the result.
          if (reserved) await this.quota?.refund(input.storeId).catch(() => undefined)
          return { run: concurrent, file: null }
        }
        if (concurrent?.status === 'GENERATING') throw new AppError('CONFLICT', 'Report generation is already in progress', 409)
      }
      await this.repository.saveBody?.(input.storeId, run.id, file.body)
      if (this.objectStore) {
        try { await this.objectStore.put(objectKey, file.body, file.contentType) } catch { /* PDF remains available from the database vault */ }
      }
      let completed: ReportRun = { ...run, status: 'COMPLETED', emailStatus: input.email ? 'EMAIL_UNAVAILABLE' : 'NOT_REQUESTED', completedAt: this.now() }
      if (input.email && this.delivery) completed = await this.sendEmail(completed, file.body)
      await this.repository.updateRun(completed)
      this.logger?.info(`[REPORTS] Completed report ${run.id}`, { storeId: input.storeId, reportId: run.id, frequency: input.frequency, durationMs: this.now() - startedAt, bytes: file.body.byteLength, sha256: run.contentSha256 })
      return { run: completed, file }
    } catch (error: unknown) {
      if (reserved) await this.quota?.refund(input.storeId).catch(() => undefined)
      if (run) {
        const failed: ReportRun = { ...run, status: 'FAILED', emailStatus: 'NOT_REQUESTED', completedAt: this.now() }
        await this.repository.updateRun(failed).catch(() => undefined)
        this.logger?.error(`[REPORTS] Failed report ${run.id}`, { storeId: input.storeId, reportId: run.id, frequency: input.frequency, error: error instanceof Error ? error.message : String(error) })
      }
      throw error
    }
  }

  private async sendEmail(run: ReportRun, body: Buffer | null): Promise<ReportRun> {
    if (!this.delivery || !body) return { ...run, emailStatus: 'EMAIL_UNAVAILABLE' }
    try {
      await this.delivery.send({ storeId: run.storeId, filename: run.filename, body, subject: `${run.frequency} ProfitPilot report` })
      return { ...run, emailStatus: 'SENT' }
    } catch {
      return { ...run, emailStatus: 'FAILED' }
    }
  }
  public async download(storeId: string, id: string): Promise<Readonly<{ run: ReportRun; body: Buffer }>> {
    const run = await this.get(storeId, id)
    if (run.status !== 'COMPLETED') throw new AppError('DEPENDENCY_ERROR', run.status === 'GENERATING' ? 'This report is still generating. Refresh in a moment.' : 'This report failed and has no file to download.', 409, { status: run.status })
    const stored = await this.readStoredBody(run)
    if (stored) return { run, body: stored }
    throw new AppError('NOT_FOUND', 'Report file not found', 404)
  }
  private async readStoredBody(run: ReportRun): Promise<Buffer | null> {
    const fromRepo = await this.repository.getBody?.(run.storeId, run.id)
    if (fromRepo) return fromRepo
    if (!this.objectStore) return null
    return this.objectStore.get(run.objectKey)
  }
  public async saveSchedule(schedule: ReportSchedule): Promise<ReportSchedule> { if (!['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'].includes(schedule.frequency)) throw new AppError('VALIDATION_ERROR', 'Invalid report frequency', 400); return this.repository.saveSchedule(schedule) }
  public async schedules(storeId: string): Promise<readonly ReportSchedule[]> { return this.repository.listSchedules(storeId) }
}

export function isSixHourlyTick(at: number): boolean { return new Date(at).getUTCHours() % 6 === 0 && new Date(at).getUTCMinutes() === 0 }

function reportQuotaMessage(plan: PlanTier, frequency: ReportFrequency, used: number, limit: number | null): string {
  if (limit === 0) return frequency === 'QUARTERLY' ? 'Quarterly reports unlock when you Upgrade Plan.' : 'This report unlocks when you Upgrade Plan.'
  const count = limit ?? 0
  if (count === 1) return `Your ${plan} plan includes 1 report per month and it has already been generated. Upgrade Plan for more.`
  return `Your ${plan} plan includes ${count} reports per month and all ${count} are used. Upgrade Plan for more.`
}

function hmac(key: Buffer | string, value: string): Buffer { return createHmac('sha256', key).update(value).digest() }
