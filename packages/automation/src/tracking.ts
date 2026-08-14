import { hmacSha256Hex, safeEqualHex } from '@profitpilot/crypto'
import { AppError } from '@profitpilot/types'

export type TrackingToken = Readonly<{ storeId: string; campaignId: string; messageId: string; kind: 'OPEN' | 'CLICK'; target: string | null; expiresAt: number }>
export class TrackingService {
  private readonly secret: string
  public constructor(secret: string) { if (!secret.trim()) throw new TypeError('Tracking secret is required'); this.secret = secret }
  public createToken(input: TrackingToken): string { const payload = [input.storeId, input.campaignId, input.messageId, input.kind, input.target ?? '', input.expiresAt].join('|'); return `${payload}|${hmacSha256Hex(this.secret, payload)}` }
  public verifyToken(token: string, now = Date.now()): TrackingToken { const parts = token.split('|'); if (parts.length !== 7) throw new AppError('VALIDATION_ERROR', 'Invalid tracking token', 400); const [storeId, campaignId, messageId, kind, target, expiresRaw, signature] = parts; const expiresAt = Number(expiresRaw); const payload = [storeId, campaignId, messageId, kind, target, expiresAt].join('|'); if (!storeId || !campaignId || !messageId || (kind !== 'OPEN' && kind !== 'CLICK') || !Number.isFinite(expiresAt) || expiresAt <= now || !signature || !safeEqualHex(signature, hmacSha256Hex(this.secret, payload))) throw new AppError('VALIDATION_ERROR', 'Invalid or expired tracking token', 400); return { storeId, campaignId, messageId, kind, target: target || null, expiresAt }
  }
  public pixelUrl(token: string): string { return `/tracking/open?token=${encodeURIComponent(token)}` }
  public clickUrl(token: string): string { return `/tracking/click?token=${encodeURIComponent(token)}` }
}
