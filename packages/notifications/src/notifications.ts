import type { StoreId, UserId } from '@profitpilot/types'

export type NotificationKind = 'info' | 'success' | 'warning' | 'critical'
export type Notification = Readonly<{
  id: string
  storeId: StoreId
  recipientId: UserId
  kind: NotificationKind
  title: string
  body: string
  dedupeKey: string
  readAt: number | null
  createdAt: number
}>

export type PublishNotification = Readonly<{
  id: string
  storeId: StoreId
  recipientId: UserId
  kind: NotificationKind
  title: string
  body: string
  dedupeKey: string
  now?: number
}>

export class InMemoryNotificationStore {
  private readonly notifications = new Map<string, Notification>()
  private readonly dedupe = new Set<string>()

  public publish(input: PublishNotification): { created: boolean; notification: Notification } {
    if (this.dedupe.has(`${input.storeId}:${input.dedupeKey}`)) {
      const existing = [...this.notifications.values()].find((item) => item.storeId === input.storeId && item.dedupeKey === input.dedupeKey)
      if (!existing) throw new Error('Notification dedupe ledger is inconsistent')
      return { created: false, notification: existing }
    }
    const notification: Notification = { ...input, readAt: null, createdAt: input.now ?? Date.now() }
    this.notifications.set(input.id, notification)
    this.dedupe.add(`${input.storeId}:${input.dedupeKey}`)
    return { created: true, notification }
  }

  public list(storeId: StoreId, recipientId: UserId): readonly Notification[] {
    return [...this.notifications.values()].filter((item) => item.storeId === storeId && item.recipientId === recipientId).sort((left, right) => right.createdAt - left.createdAt)
  }

  public unreadCount(storeId: StoreId, recipientId: UserId): number {
    return this.list(storeId, recipientId).filter((item) => item.readAt === null).length
  }

  public markRead(id: string, now = Date.now()): boolean {
    const notification = this.notifications.get(id)
    if (!notification) return false
    this.notifications.set(id, { ...notification, readAt: notification.readAt ?? now })
    return true
  }

  public markAllRead(storeId: StoreId, recipientId: UserId, now = Date.now()): number {
    let count = 0
    for (const notification of this.list(storeId, recipientId)) {
      if (notification.readAt === null) {
        this.markRead(notification.id, now)
        count += 1
      }
    }
    return count
  }
}
