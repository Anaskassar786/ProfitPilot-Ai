import { describe, expect, it } from 'vitest'
import { InMemoryNotificationStore } from './index.js'
import { storeId, userId } from '@profitpilot/types'

const base = { id: 'n1', storeId: storeId('s1'), recipientId: userId('u1'), kind: 'info' as const, title: 'Sync ready', body: 'Your sync completed', dedupeKey: 'sync:1', now: 100 }

describe('notification ledger', () => {
  it('publishes an unread notification', () => {
    const store = new InMemoryNotificationStore()
    expect(store.publish(base).created).toBe(true)
    expect(store.unreadCount(base.storeId, base.recipientId)).toBe(1)
  })
  it('deduplicates the same tenant event', () => {
    const store = new InMemoryNotificationStore()
    const first = store.publish(base)
    const second = store.publish({ ...base, id: 'n2' })
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(store.list(base.storeId, base.recipientId)).toHaveLength(1)
  })
  it('isolates notifications by store', () => {
    const store = new InMemoryNotificationStore()
    store.publish(base)
    store.publish({ ...base, id: 'n2', storeId: storeId('s2'), dedupeKey: 'sync:1' })
    expect(store.list(storeId('s2'), base.recipientId)).toHaveLength(1)
  })
  it('sorts newest notifications first', () => {
    const store = new InMemoryNotificationStore()
    store.publish(base)
    store.publish({ ...base, id: 'n2', dedupeKey: 'sync:2', now: 200 })
    expect(store.list(base.storeId, base.recipientId)[0]?.id).toBe('n2')
  })
  it('marks a notification read once', () => {
    const store = new InMemoryNotificationStore()
    store.publish(base)
    expect(store.markRead('n1', 200)).toBe(true)
    expect(store.markRead('n1', 300)).toBe(true)
    expect(store.list(base.storeId, base.recipientId)[0]?.readAt).toBe(200)
  })
  it('returns false for an unknown notification', () => expect(new InMemoryNotificationStore().markRead('missing')).toBe(false))
  it('marks all notifications read and returns count', () => {
    const store = new InMemoryNotificationStore()
    store.publish(base)
    store.publish({ ...base, id: 'n2', dedupeKey: 'sync:2' })
    expect(store.markAllRead(base.storeId, base.recipientId, 500)).toBe(2)
    expect(store.unreadCount(base.storeId, base.recipientId)).toBe(0)
  })
})
