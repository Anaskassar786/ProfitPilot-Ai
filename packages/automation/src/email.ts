import nodemailer from 'nodemailer'
import { AppError } from '@profitpilot/types'
import { hmacSha256Hex, safeEqualHex } from '@profitpilot/crypto'

export type EmailMessage = Readonly<{ to: string; from: string; fromName: string; subject: string; html: string; headers?: Readonly<Record<string, string>> }>
export type EmailTransport = Readonly<{ send(message: EmailMessage): Promise<Readonly<{ messageId: string }>> }>
export type MerchantEmailConfig = Readonly<{ shopId: string; merchantEmail: string; fromName: string; verified: boolean; verificationSentAt: number | null; verifiedAt: number | null }>

export class SmtpMailer implements EmailTransport {
  private readonly transport: nodemailer.Transporter
  public constructor(transport: nodemailer.Transporter) { this.transport = transport }
  public async send(message: EmailMessage): Promise<Readonly<{ messageId: string }>> { const info = await this.transport.sendMail({ to: message.to, from: `${message.fromName} <${message.from}>`, subject: message.subject, html: message.html, headers: message.headers }); return { messageId: info.messageId }
  }
}

export function createBrevoMailer(env: Readonly<Record<string, string | undefined>>): SmtpMailer {
  const host = env.SMTP_HOST?.trim(); const user = env.SMTP_USER?.trim(); const password = env.SMTP_PASSWORD?.trim(); if (!host || !user || !password) throw new AppError('DEPENDENCY_ERROR', 'SMTP configuration is incomplete', 503)
  const port = Number(env.SMTP_PORT ?? '587')
  return new SmtpMailer(nodemailer.createTransport({ host, port, secure: env.SMTP_SECURE === 'true', auth: { user, pass: password } }))
}

export class MerchantEmailVerifier {
  private readonly secret: string
  private readonly configs = new Map<string, MerchantEmailConfig>()
  public constructor(secret: string) { if (!secret.trim()) throw new TypeError('Merchant email verification secret is required'); this.secret = secret }
  public save(shopId: string, merchantEmail: string, fromName: string): MerchantEmailConfig { if (!/^\S+@\S+\.\S+$/.test(merchantEmail)) throw new AppError('VALIDATION_ERROR', 'Merchant email is invalid', 400); const config: MerchantEmailConfig = { shopId, merchantEmail, fromName, verified: false, verificationSentAt: null, verifiedAt: null }; this.configs.set(shopId, config); return config }
  public get(shopId: string): MerchantEmailConfig | null { return this.configs.get(shopId) ?? null }
  public token(shopId: string, email: string, expiresAt: number): string { const payload = `${shopId}|${email}|${expiresAt}`; return `${payload}|${hmacSha256Hex(this.secret, payload)}` }
  public verify(token: string, now = Date.now()): MerchantEmailConfig { const parts = token.split('|'); if (parts.length !== 4) throw new AppError('VALIDATION_ERROR', 'Invalid merchant email verification token', 400); const [shopId, email, expiresRaw, signature] = parts; const expiresAt = Number(expiresRaw); const payload = `${shopId}|${email}|${expiresAt}`; const config = shopId ? this.configs.get(shopId) : null; if (!shopId || !email || !signature || !config || config.merchantEmail !== email || expiresAt <= now || !safeEqualHex(signature, hmacSha256Hex(this.secret, payload))) throw new AppError('VALIDATION_ERROR', 'Invalid or expired merchant email verification token', 400); const verified = { ...config, verified: true, verifiedAt: now }; this.configs.set(shopId, verified); return verified }
}

export class CampaignEmailService {
  private readonly systemMailer: EmailTransport
  private readonly merchantMailer: EmailTransport
  private readonly merchantEmails: MerchantEmailVerifier
  private readonly systemFrom: string
  private readonly systemFromName: string
  public constructor(systemMailer: EmailTransport, merchantMailer: EmailTransport, merchantEmails: MerchantEmailVerifier, systemFrom: string, systemFromName = 'ProfitPilot') { this.systemMailer = systemMailer; this.merchantMailer = merchantMailer; this.merchantEmails = merchantEmails; this.systemFrom = systemFrom; this.systemFromName = systemFromName }
  public sendSystem(to: string, subject: string, html: string): Promise<Readonly<{ messageId: string }>> { return this.systemMailer.send({ to, from: this.systemFrom, fromName: this.systemFromName, subject, html }) }
  public async sendCampaign(shopId: string, message: Omit<EmailMessage, 'from' | 'fromName'>): Promise<Readonly<{ messageId: string }>> { const config = this.merchantEmails.get(shopId); if (!config?.verified) throw new AppError('FORBIDDEN', 'Merchant email must be verified before campaigns send', 403, { shopId }); return this.merchantMailer.send({ ...message, from: config.merchantEmail, fromName: config.fromName }) }
}
