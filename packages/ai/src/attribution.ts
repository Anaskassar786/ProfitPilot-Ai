import { hmacSha256Hex, safeEqualHex } from '@profitpilot/crypto'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'

export type AttributionTouch = Readonly<{ storeId: StoreId; actionId: string; checkoutToken?: string; discountCode?: string; clickedAt: number; attributedRevenue: number; orderId: string }>
export type AttributionMatch = Readonly<{ method: 'CHECKOUT_TOKEN' | 'DISCOUNT_CODE' | 'TIME_WINDOW'; actionId: string; revenue: number; orderId: string }>

export class AttributionTracker {
  private readonly secret: string
  private readonly windowMs: number
  private readonly touches: AttributionTouch[] = []

  public constructor(secret: string, windowMs = 7 * 24 * 60 * 60 * 1000) {
    if (!secret.trim()) throw new TypeError('Attribution tracking secret cannot be empty')
    if (windowMs < 1) throw new RangeError('Attribution window must be positive')
    this.secret = secret
    this.windowMs = windowMs
  }

  public createCheckoutToken(storeId: StoreId, actionId: string, checkoutId: string, expiresAt: number): string {
    const payload = `${storeId}.${actionId}.${checkoutId}.${expiresAt}`
    return `${payload}.${hmacSha256Hex(this.secret, payload)}`
  }

  public verifyCheckoutToken(token: string, now = Date.now()): Readonly<{ storeId: StoreId; actionId: string; checkoutId: string; expiresAt: number }> {
    const parts = token.split('.')
    if (parts.length !== 5) throw new AppError('VALIDATION_ERROR', 'Invalid attribution token', 400)
    const [store, action, checkout, expires, signature] = parts
    const payload = `${store}.${action}.${checkout}.${expires}`
    const expiresAt = Number(expires)
    if (!store || !action || !checkout || !signature || !Number.isFinite(expiresAt) || expiresAt < now || !safeEqualHex(signature, hmacSha256Hex(this.secret, payload))) throw new AppError('VALIDATION_ERROR', 'Invalid or expired attribution token', 400)
    return { storeId: store as StoreId, actionId: action, checkoutId: checkout, expiresAt }
  }

  public record(touch: AttributionTouch): boolean {
    if (this.touches.some((item) => item.storeId === touch.storeId && item.orderId === touch.orderId)) return false
    this.touches.push(touch)
    return true
  }

  public match(storeId: StoreId, order: Readonly<{ orderId: string; checkoutToken?: string; discountCode?: string; createdAt: number; total: number }>): AttributionMatch | null {
    if (order.checkoutToken) {
      const verified = this.verifyCheckoutToken(order.checkoutToken, order.createdAt)
      if (verified.storeId === storeId) return { method: 'CHECKOUT_TOKEN', actionId: verified.actionId, revenue: order.total, orderId: order.orderId }
    }
    const discount = this.touches.find((touch) => touch.storeId === storeId && touch.discountCode && touch.discountCode === order.discountCode && Math.abs(order.createdAt - touch.clickedAt) <= this.windowMs)
    if (discount) return { method: 'DISCOUNT_CODE', actionId: discount.actionId, revenue: order.total, orderId: order.orderId }
    const timeWindow = this.touches.find((touch) => touch.storeId === storeId && Math.abs(order.createdAt - touch.clickedAt) <= this.windowMs)
    return timeWindow ? { method: 'TIME_WINDOW', actionId: timeWindow.actionId, revenue: order.total, orderId: order.orderId } : null
  }
}
