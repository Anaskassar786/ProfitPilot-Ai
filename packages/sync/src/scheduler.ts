import type { JobId, StoreId } from '@profitpilot/types'

export type PriorityLane = 'webhook' | 'sync' | 'report'
export type ScheduledTask<Value = unknown> = Readonly<{ id: JobId; storeId: StoreId; lane: PriorityLane; value: Value; createdAt: number }>

const LANE_WEIGHT: Readonly<Record<PriorityLane, number>> = { webhook: 0, sync: 1, report: 2 }

export class PriorityScheduler<Value = unknown> {
  private readonly tasks = new Map<JobId, ScheduledTask<Value>>()

  public enqueue(task: ScheduledTask<Value>): boolean {
    if (this.tasks.has(task.id)) return false
    this.tasks.set(task.id, task)
    return true
  }

  public dequeue(storeId: StoreId): ScheduledTask<Value> | null {
    const candidates = [...this.tasks.values()].filter((task) => task.storeId === storeId).sort((left, right) => LANE_WEIGHT[left.lane] - LANE_WEIGHT[right.lane] || left.createdAt - right.createdAt)
    const next = candidates[0]
    if (!next) return null
    this.tasks.delete(next.id)
    return next
  }

  public pending(storeId?: StoreId): number {
    return [...this.tasks.values()].filter((task) => storeId === undefined || task.storeId === storeId).length
  }
}
