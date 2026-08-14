import type { JobId, StoreId } from '@profitpilot/types'

export type QueueStatus = 'queued' | 'processing' | 'completed' | 'failed'

export type QueueJob<Value> = Readonly<{
  id: JobId
  storeId: StoreId
  type: string
  data: Value
  status: QueueStatus
  attempts: number
  maxAttempts: number
  availableAt: number
  createdAt: number
  lastError?: string
}>

export type EnqueueOptions = Readonly<{
  maxAttempts?: number
  delayMs?: number
  now?: number
}>

export type EnqueueResult<Value> = Readonly<{
  accepted: boolean
  job: QueueJob<Value>
}>

export interface QueuePort {
  enqueue<Value>(job: Omit<QueueJob<Value>, 'status' | 'attempts' | 'maxAttempts' | 'createdAt' | 'availableAt'>, options?: EnqueueOptions): Promise<EnqueueResult<Value>>
  reserve<Value>(now?: number): Promise<QueueJob<Value> | null>
  complete(id: JobId): Promise<void>
  fail(id: JobId, reason: string, now?: number): Promise<QueueJob<unknown> | null>
  size(): number
}

export class InMemoryQueue implements QueuePort {
  private readonly jobs = new Map<JobId, QueueJob<unknown>>()
  private readonly ready: JobId[] = []

  public async enqueue<Value>(job: Omit<QueueJob<Value>, 'status' | 'attempts' | 'maxAttempts' | 'createdAt' | 'availableAt'>, options: EnqueueOptions = {}): Promise<EnqueueResult<Value>> {
    const existing = this.jobs.get(job.id)
    if (existing) return { accepted: false, job: existing as QueueJob<Value> }
    const now = options.now ?? Date.now()
    const entry: QueueJob<Value> = {
      ...job,
      status: 'queued',
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      availableAt: now + (options.delayMs ?? 0),
      createdAt: now,
    }
    this.jobs.set(job.id, entry as QueueJob<unknown>)
    this.ready.push(job.id)
    return { accepted: true, job: entry }
  }

  public async reserve<Value>(now = Date.now()): Promise<QueueJob<Value> | null> {
    for (let index = 0; index < this.ready.length; index += 1) {
      const id = this.ready[index]
      if (!id) continue
      const job = this.jobs.get(id)
      if (!job || job.status !== 'queued' || job.availableAt > now) continue
      this.ready.splice(index, 1)
      const processing: QueueJob<unknown> = { ...job, status: 'processing', attempts: job.attempts + 1 }
      this.jobs.set(id, processing)
      return processing as QueueJob<Value>
    }
    return null
  }

  public async complete(id: JobId): Promise<void> {
    const job = this.jobs.get(id)
    if (!job) throw new Error(`Unknown job ${id}`)
    this.jobs.set(id, { ...job, status: 'completed' })
  }

  public async fail(id: JobId, reason: string, now = Date.now()): Promise<QueueJob<unknown> | null> {
    const job = this.jobs.get(id)
    if (!job) return null
    if (job.attempts < job.maxAttempts) {
      const retry: QueueJob<unknown> = { ...job, status: 'queued', availableAt: now + 2 ** job.attempts * 100, lastError: reason }
      this.jobs.set(id, retry)
      this.ready.push(id)
      return retry
    }
    const failed: QueueJob<unknown> = { ...job, status: 'failed', lastError: reason }
    this.jobs.set(id, failed)
    return failed
  }

  public size(): number {
    return [...this.jobs.values()].filter((job) => job.status === 'queued' || job.status === 'processing').length
  }
}

type RedisResponse = Readonly<{ result: string | null }>
export type QueueFetcher = (input: string, init: RequestInit) => Promise<Response>

export class UpstashQueue implements QueuePort {
  private readonly url: string
  private readonly token: string
  private readonly queueName: string
  private readonly fetcher: QueueFetcher

  public constructor(url: string, token: string, queueName: string, fetcher: QueueFetcher = fetch) {
    if (!url.startsWith('http')) throw new TypeError('Queue URL must be HTTP(S)')
    if (!token.trim() || !queueName.trim()) throw new TypeError('Queue token and name are required')
    this.url = url
    this.token = token
    this.queueName = queueName
    this.fetcher = fetcher
  }

  public async enqueue<Value>(job: Omit<QueueJob<Value>, 'status' | 'attempts' | 'maxAttempts' | 'createdAt' | 'availableAt'>, options: EnqueueOptions = {}): Promise<EnqueueResult<Value>> {
    const dedupe = await this.command(['SET', `profitpilot:job:${job.id}`, '1', 'NX', 'EX', '86400'])
    if (dedupe.result === null) {
      return { accepted: false, job: { ...job, status: 'queued', attempts: 0, maxAttempts: options.maxAttempts ?? 3, availableAt: Date.now(), createdAt: Date.now() } }
    }
    const entry: QueueJob<Value> = { ...job, status: 'queued', attempts: 0, maxAttempts: options.maxAttempts ?? 3, availableAt: Date.now() + (options.delayMs ?? 0), createdAt: Date.now() }
    await this.command(['RPUSH', this.queueName, JSON.stringify(entry)])
    return { accepted: true, job: entry }
  }

  public async reserve<Value>(): Promise<QueueJob<Value> | null> {
    const response = await this.command(['LPOP', this.queueName])
    return response.result === null ? null : (JSON.parse(response.result) as QueueJob<Value>)
  }

  public async complete(_id: JobId): Promise<void> {
    return Promise.resolve()
  }

  public async fail(_id: JobId, _reason: string): Promise<QueueJob<unknown> | null> {
    return Promise.resolve(null)
  }

  public size(): number {
    return 0
  }

  private async command(command: readonly string[]): Promise<RedisResponse> {
    const response = await this.fetcher(this.url, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify(command) })
    if (!response.ok) throw new Error(`Upstash queue request failed with ${response.status}`)
    return (await response.json()) as RedisResponse
  }
}
