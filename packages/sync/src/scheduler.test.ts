import { describe, expect, it } from 'vitest'
import { jobId, storeId } from '@profitpilot/types'
import { PriorityScheduler } from './index.js'

describe('priority lanes', () => {
  it('serves webhook work before sync and reports', () => {
    const scheduler = new PriorityScheduler()
    const store = storeId('s')
    scheduler.enqueue({ id: jobId('report'), storeId: store, lane: 'report', value: 'report', createdAt: 1 })
    scheduler.enqueue({ id: jobId('sync'), storeId: store, lane: 'sync', value: 'sync', createdAt: 2 })
    scheduler.enqueue({ id: jobId('webhook'), storeId: store, lane: 'webhook', value: 'webhook', createdAt: 3 })
    expect(scheduler.dequeue(store)?.lane).toBe('webhook')
    expect(scheduler.dequeue(store)?.lane).toBe('sync')
    expect(scheduler.dequeue(store)?.lane).toBe('report')
  })
  it('keeps FIFO order within a lane', () => {
    const scheduler = new PriorityScheduler()
    const store = storeId('s')
    scheduler.enqueue({ id: jobId('one'), storeId: store, lane: 'sync', value: 1, createdAt: 1 })
    scheduler.enqueue({ id: jobId('two'), storeId: store, lane: 'sync', value: 2, createdAt: 2 })
    expect(scheduler.dequeue(store)?.id).toBe('one')
  })
  it('deduplicates task ids', () => {
    const scheduler = new PriorityScheduler()
    const task = { id: jobId('same'), storeId: storeId('s'), lane: 'webhook' as const, value: true, createdAt: 1 }
    expect(scheduler.enqueue(task)).toBe(true)
    expect(scheduler.enqueue(task)).toBe(false)
    expect(scheduler.pending()).toBe(1)
  })
  it('isolates lanes by store', () => {
    const scheduler = new PriorityScheduler()
    scheduler.enqueue({ id: jobId('one'), storeId: storeId('one'), lane: 'webhook', value: 1, createdAt: 1 })
    scheduler.enqueue({ id: jobId('two'), storeId: storeId('two'), lane: 'webhook', value: 2, createdAt: 1 })
    expect(scheduler.dequeue(storeId('one'))?.id).toBe('one')
    expect(scheduler.pending(storeId('two'))).toBe(1)
  })
  it('returns null when a store has no work', () => expect(new PriorityScheduler().dequeue(storeId('empty'))).toBeNull())
  it('counts all pending work', () => {
    const scheduler = new PriorityScheduler()
    scheduler.enqueue({ id: jobId('one'), storeId: storeId('one'), lane: 'sync', value: 1, createdAt: 1 })
    scheduler.enqueue({ id: jobId('two'), storeId: storeId('two'), lane: 'sync', value: 2, createdAt: 1 })
    expect(scheduler.pending()).toBe(2)
  })
})
