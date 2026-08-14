import type { Logger } from '@profitpilot/logger'
import type { JobId } from '@profitpilot/types'
import type { QueueJob, QueuePort } from '@profitpilot/queue'

export type JobHandler = (job: QueueJob<unknown>) => Promise<void>

export class WorkerRuntime {
  private readonly queue: QueuePort
  private readonly handler: JobHandler
  private readonly logger: Logger

  public constructor(queue: QueuePort, handler: JobHandler, logger: Logger) {
    this.queue = queue
    this.handler = handler
    this.logger = logger
  }

  public async tick(now = Date.now()): Promise<'idle' | 'completed' | 'failed'> {
    const job = await this.queue.reserve<unknown>(now)
    if (!job) return 'idle'
    try {
      await this.handler(job)
      await this.queue.complete(job.id)
      this.logger.info('Job completed', { jobId: job.id, jobType: job.type })
      return 'completed'
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown worker failure'
      await this.queue.fail(job.id, message, now)
      this.logger.error('Job failed', { jobId: job.id, jobType: job.type, reason: message })
      return 'failed'
    }
  }

  public async acknowledge(jobId: JobId): Promise<void> {
    await this.queue.complete(jobId)
  }
}
