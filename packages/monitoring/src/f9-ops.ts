import { AppError } from '@profitpilot/types'
import type { F9ControlService } from './f9-controls.js'

export type OpsJob = Readonly<{ id: string; storeId: string; type: string; status: 'queued' | 'processing' | 'completed' | 'failed' | 'dead-letter'; attempts: number; lastError: string | null; availableAt: number; createdAt: number }>
export type QueueSnapshot = Readonly<{ queue: string; queued: number; processing: number; failed: number; deadLetter: number; jobs: readonly OpsJob[] }>
export type OpsMetrics = Readonly<{ capturedAt: number; queue: QueueSnapshot; completed: number; failed: number; retried: number; activeStores: number }>
export type StoreActivity = Readonly<{ storeId: string; event: string; at: number; jobId: string | null }>

export interface OpsQueueAdapter {
  snapshot(): Promise<QueueSnapshot>
  retry(jobId: string): Promise<OpsJob>
}

export class InMemoryOpsQueue implements OpsQueueAdapter {
  private readonly jobs = new Map<string, OpsJob>()
  private readonly queueName: string
  public constructor(queueName = 'profitpilot:jobs') { this.queueName = queueName }
  public add(job: OpsJob): void { this.jobs.set(job.id, job) }
  public async snapshot(): Promise<QueueSnapshot> { const jobs = [...this.jobs.values()]; return { queue: this.queueName, queued: jobs.filter((job) => job.status === 'queued').length, processing: jobs.filter((job) => job.status === 'processing').length, failed: jobs.filter((job) => job.status === 'failed').length, deadLetter: jobs.filter((job) => job.status === 'dead-letter').length, jobs } }
  public async retry(jobId: string): Promise<OpsJob> { const job = this.jobs.get(jobId); if (!job || (job.status !== 'failed' && job.status !== 'dead-letter')) throw new AppError('NOT_FOUND', 'Failed job not found', 404); const next: OpsJob = { ...job, status: 'queued', attempts: job.attempts + 1, lastError: null, availableAt: Date.now() }; this.jobs.set(jobId, next); return next }
}

export class UpstashOpsQueue implements OpsQueueAdapter {
  private readonly url: string
  private readonly token: string
  private readonly queueName: string
  private readonly deadLetterName: string
  private readonly fetcher: (input: string, init: RequestInit) => Promise<Response>
  public constructor(url: string, token: string, queueName = 'profitpilot:jobs', deadLetterName = 'profitpilot:dead-letter', fetcher: (input: string, init: RequestInit) => Promise<Response> = fetch) { if (!url.startsWith('http') || !token.trim()) throw new TypeError('Upstash ops configuration is incomplete'); this.url = url; this.token = token; this.queueName = queueName; this.deadLetterName = deadLetterName; this.fetcher = fetcher }
  public async snapshot(): Promise<QueueSnapshot> { const [queued, deadLetter] = await Promise.all([this.command(['LRANGE', this.queueName, '0', '99']), this.command(['LRANGE', this.deadLetterName, '0', '99'])]); const jobs = [...parseJobs(queued), ...parseJobs(deadLetter).map((job) => ({ ...job, status: 'dead-letter' as const }))]; return { queue: this.queueName, queued: jobs.filter((job) => job.status === 'queued').length, processing: jobs.filter((job) => job.status === 'processing').length, failed: jobs.filter((job) => job.status === 'failed').length, deadLetter: jobs.filter((job) => job.status === 'dead-letter').length, jobs } }
  public async retry(jobId: string): Promise<OpsJob> { const snapshot = await this.snapshot(); const job = snapshot.jobs.find((candidate) => candidate.id === jobId); if (!job) throw new AppError('NOT_FOUND', 'Failed job not found', 404); const next: OpsJob = { ...job, status: 'queued', attempts: job.attempts + 1, lastError: null, availableAt: Date.now() }; await this.command(['LPUSH', this.queueName, JSON.stringify(next)]); return next }
  private async command(command: readonly string[]): Promise<Readonly<{ result: string | readonly string[] | null }>> { const response = await this.fetcher(this.url, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify(command) }); if (!response.ok) throw new AppError('DEPENDENCY_ERROR', `Upstash ops request failed with ${response.status}`, 503); return await response.json() as Readonly<{ result: string | readonly string[] | null }> }
}

function parseJobs(response: Readonly<{ result: string | readonly string[] | null }>): readonly OpsJob[] { const values = Array.isArray(response.result) ? response.result : response.result === null ? [] : [response.result]; return values.flatMap((value) => { try { const parsed: unknown = JSON.parse(value); return isJob(parsed) ? [parsed] : [] } catch { return [] } }) }
function isJob(value: unknown): value is OpsJob { return isRecord(value) && typeof value.id === 'string' && typeof value.storeId === 'string' && typeof value.type === 'string' && (value.status === 'queued' || value.status === 'processing' || value.status === 'completed' || value.status === 'failed' || value.status === 'dead-letter') && typeof value.attempts === 'number' && (value.lastError === null || typeof value.lastError === 'string') && typeof value.availableAt === 'number' && typeof value.createdAt === 'number' }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

export class AdminOpsService {
  private readonly queue: OpsQueueAdapter
  private readonly controls: F9ControlService | null
  private readonly now: () => number
  private readonly activity: StoreActivity[] = []
  private completed = 0
  private failed = 0
  private retried = 0
  public constructor(queue: OpsQueueAdapter, controls: F9ControlService | null = null, now: () => number = () => Date.now()) { this.queue = queue; this.controls = controls; this.now = now }
  public async snapshot(): Promise<QueueSnapshot> { return this.queue.snapshot() }
  public async retry(jobId: string, actorId = 'admin'): Promise<OpsJob> { const job = await this.queue.retry(jobId); this.retried += 1; this.activity.push({ storeId: job.storeId, event: 'job_retried', at: this.now(), jobId }); if (this.controls) await this.controls.audit(job.storeId).catch(() => undefined); return job }
  public async metrics(): Promise<OpsMetrics> { const queue = await this.queue.snapshot(); return { capturedAt: this.now(), queue, completed: this.completed, failed: this.failed, retried: this.retried, activeStores: new Set(queue.jobs.map((job) => job.storeId)).size } }
  public activityFor(storeId?: string): readonly StoreActivity[] { return this.activity.filter((event) => storeId === undefined || event.storeId === storeId) }
  public recordCompleted(): void { this.completed += 1 }
  public recordFailed(): void { this.failed += 1 }
}
