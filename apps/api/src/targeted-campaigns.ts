import { randomUUID } from 'node:crypto'
import { BatchSender, CampaignEmailService, InMemorySendLedger, SuppressionLedger, compileTemplate, renderTemplate } from '@profitpilot/automation'
import type { CampaignTemplate, MerchantEmailConfig, MerchantEmailConfigRepository, MerchantEmailVerifier, TemplateRepository } from '@profitpilot/automation'
import type { BillingRepository } from '@profitpilot/billing'
import { isReadOnly, limitForPlan } from '@profitpilot/billing'
import { planAtLeast } from '@profitpilot/ai'
import { hmacSha256Hex, safeEqualHex, sha256Hex } from '@profitpilot/crypto'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import type { CustomerRepository, CustomerView } from './customers.js'

export type CampaignDeliveryStatus = 'sent' | 'suppressed' | 'failed'
export type TargetedCampaignInput = Readonly<{ storeId: StoreId; customerId: string; templateId: string; idempotencyKey: string; reviewed: boolean }>
export type TargetedCampaignResult = Readonly<{ status: CampaignDeliveryStatus; jobId: string; campaignId: string; customerId: string; templateId: string; providerMessageId: string | null; idempotent: boolean; reason: string | null }>
export type CampaignPreview = Readonly<{ templateId: string; templateName: string; subject: string; html: string; customerId: string; variables: readonly string[]; sender: Readonly<{ fromName: string; email: string }> }>

type ReservedSend = Readonly<{ jobId: string; campaignId: string; customerId: string; templateId: string; fingerprint: string; status: 'pending' | CampaignDeliveryStatus; providerMessageId: string | null; reason: string | null }>

export interface CampaignSendStore {
  find(storeId: StoreId, jobId: string): Promise<ReservedSend | null>
  reserve(input: Readonly<{ storeId: StoreId; jobId: string; customerId: string; templateId: string; fingerprint: string; campaignName: string; quotaLimit: number | null }>): Promise<Readonly<{ send: ReservedSend; created: boolean }>>
  suppressed(storeId: StoreId, recipientKey: string): Promise<string | null>
  finish(storeId: StoreId, jobId: string, status: CampaignDeliveryStatus, providerMessageId: string | null, reason: string | null): Promise<ReservedSend>
  unsubscribe(storeId: StoreId, jobId: string): Promise<Readonly<{ alreadySuppressed: boolean }>>
}

export class PostgresCampaignSendStore implements CampaignSendStore {
  public constructor(private readonly executor: SqlExecutor) {}

  public find(storeId: StoreId, jobId: string): Promise<ReservedSend | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<SendRow>(`SELECT job_id, campaign_id, recipient_key, template_id, idempotency_fingerprint, status, provider_message_id, failure_reason FROM campaign_sends WHERE store_id = $1 AND job_id = $2 LIMIT 1`, [storeId, jobId])
      return result.rows[0] ? mapSend(result.rows[0]) : null
    })
  }

  public reserve(input: Readonly<{ storeId: StoreId; jobId: string; customerId: string; templateId: string; fingerprint: string; campaignName: string; quotaLimit: number | null }>): Promise<Readonly<{ send: ReservedSend; created: boolean }>> {
    return withTenantContext(this.executor, input.storeId, async (client) => {
      // Serialize one idempotency key inside this tenant before quota mutation.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${input.storeId}:${input.jobId}`])
      const existing = await client.query<SendRow>(`SELECT job_id, campaign_id, recipient_key, template_id, idempotency_fingerprint, status, provider_message_id, failure_reason FROM campaign_sends WHERE store_id = $1 AND job_id = $2 LIMIT 1`, [input.storeId, input.jobId])
      if (existing.rows[0]) return { send: mapSend(existing.rows[0]), created: false }
      const quota = await client.query<QueryResultRow & { used: string | number }>(
        `INSERT INTO billing_usage (shop_id, feature, period_start, used)
         VALUES ($1, 'email_sends_month', date_trunc('month', now())::date, 1)
         ON CONFLICT (shop_id, feature, period_start)
         DO UPDATE SET used = billing_usage.used + 1
         WHERE $2::bigint IS NULL OR billing_usage.used < $2::bigint
         RETURNING used`,
        [input.storeId, input.quotaLimit],
      )
      if (!quota.rows[0]) throw new AppError('FORBIDDEN', 'Monthly email send quota reached', 403, { feature: 'email_sends_month', limit: input.quotaLimit, reason: 'QUOTA_REACHED' })
      const campaignId = randomUUID()
      await client.query(`INSERT INTO campaigns (id, store_id, name, status) VALUES ($1, $2, $3, 'SENDING')`, [campaignId, input.storeId, input.campaignName])
      const result = await client.query<SendRow>(
        `INSERT INTO campaign_sends (job_id, campaign_id, store_id, recipient_key, template_id, idempotency_fingerprint, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', now())
         RETURNING job_id, campaign_id, recipient_key, template_id, idempotency_fingerprint, status, provider_message_id, failure_reason`,
        [input.jobId, campaignId, input.storeId, input.customerId, input.templateId, input.fingerprint],
      )
      const row = result.rows[0]
      if (!row) throw new Error('Campaign send reservation returned no row')
      return { send: mapSend(row), created: true }
    })
  }

  public suppressed(storeId: StoreId, recipientKey: string): Promise<string | null> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<QueryResultRow & { reason: string }>('SELECT reason FROM suppression_ledger WHERE store_id = $1 AND recipient_key = $2 LIMIT 1', [storeId, recipientKey])
      return result.rows[0]?.reason ?? null
    })
  }

  public finish(storeId: StoreId, jobId: string, status: CampaignDeliveryStatus, providerMessageId: string | null, reason: string | null): Promise<ReservedSend> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const result = await client.query<SendRow>(
        `UPDATE campaign_sends SET status = $3, provider_message_id = $4, failure_reason = $5, sent_at = CASE WHEN $3 = 'SENT' THEN now() ELSE NULL END, updated_at = now()
         WHERE store_id = $1 AND job_id = $2 AND status = 'PENDING'
         RETURNING job_id, campaign_id, recipient_key, template_id, idempotency_fingerprint, status, provider_message_id, failure_reason`,
        [storeId, jobId, status.toUpperCase(), providerMessageId, reason],
      )
      const row = result.rows[0]
      if (row) {
        if (status !== 'sent') await client.query(`UPDATE billing_usage SET used = GREATEST(0, used - 1) WHERE shop_id = $1 AND feature = 'email_sends_month' AND period_start = date_trunc('month', now())::date`, [storeId])
        await client.query(`UPDATE campaigns SET status = $3 WHERE store_id = $1 AND id = $2`, [storeId, row.campaign_id, status === 'sent' ? 'SENT' : status === 'suppressed' ? 'SUPPRESSED' : 'FAILED'])
        return mapSend(row)
      }
      const existing = await client.query<SendRow>(`SELECT job_id, campaign_id, recipient_key, template_id, idempotency_fingerprint, status, provider_message_id, failure_reason FROM campaign_sends WHERE store_id = $1 AND job_id = $2 LIMIT 1`, [storeId, jobId])
      if (!existing.rows[0]) throw new Error('Campaign send reservation disappeared')
      return mapSend(existing.rows[0])
    })
  }

  public unsubscribe(storeId: StoreId, jobId: string): Promise<Readonly<{ alreadySuppressed: boolean }>> {
    return withTenantContext(this.executor, storeId, async (client) => {
      const send = await client.query<QueryResultRow & { recipient_key: string }>('SELECT recipient_key FROM campaign_sends WHERE store_id = $1 AND job_id = $2 LIMIT 1', [storeId, jobId])
      const recipient = send.rows[0]?.recipient_key
      if (!recipient) throw new AppError('NOT_FOUND', 'Campaign unsubscribe link was not found', 404)
      const result = await client.query(`INSERT INTO suppression_ledger (store_id, recipient_key, reason) VALUES ($1, $2, 'UNSUBSCRIBED') ON CONFLICT (store_id, recipient_key) DO NOTHING`, [storeId, recipient])
      return { alreadySuppressed: result.rowCount === 0 }
    })
  }
}

type SendRow = QueryResultRow & { job_id: string; campaign_id: string; recipient_key: string; template_id: string; idempotency_fingerprint: string; status: string; provider_message_id: string | null; failure_reason: string | null }
function mapSend(row: SendRow): ReservedSend { const status = row.status.toLowerCase(); return { jobId: row.job_id, campaignId: row.campaign_id, customerId: row.recipient_key, templateId: row.template_id, fingerprint: row.idempotency_fingerprint, status: status === 'sent' || status === 'suppressed' || status === 'failed' ? status : 'pending', providerMessageId: row.provider_message_id, reason: row.failure_reason } }

export class TargetedCampaignService {
  private readonly appBaseUrl: string | null
  public constructor(
    private readonly customers: CustomerRepository,
    private readonly billing: Pick<BillingRepository, 'get'>,
    private readonly templates: TemplateRepository,
    private readonly merchantConfigs: MerchantEmailConfigRepository,
    private readonly merchantVerifier: MerchantEmailVerifier,
    private readonly email: CampaignEmailService,
    private readonly sends: CampaignSendStore,
    private readonly storeDomain: (storeId: StoreId) => Promise<string | null>,
    private readonly unsubscribeSecret: string,
    appBaseUrl: string | null,
    private readonly audit: Readonly<{ locked(storeId: StoreId, plan: string): Promise<void> }>,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!unsubscribeSecret.trim()) throw new TypeError('Campaign unsubscribe secret is required')
    this.appBaseUrl = appBaseUrl?.trim().replace(/\/$/, '') || null
  }

  public async preview(input: TargetedCampaignInput): Promise<CampaignPreview> {
    const checked = await this.validate(input)
    const suppression = await this.sends.suppressed(input.storeId, checked.customer.id)
    if (suppression) throw new AppError('FORBIDDEN', suppressionReason(suppression), 403, { suppressed: true, reason: suppression })
    const rendered = this.render(checked.customer, checked.template, checked.merchant, checked.shopDomain, input.storeId, input.idempotencyKey)
    return { templateId: checked.template.id, templateName: checked.template.name, subject: rendered.subject, html: rendered.body, customerId: checked.customer.id, variables: checked.template.variables, sender: { fromName: checked.merchant.fromName, email: checked.merchant.merchantEmail } }
  }

  public async send(input: TargetedCampaignInput): Promise<TargetedCampaignResult> {
    const account = await this.requireGrowth(input.storeId)
    assertSendInput(input)
    const fingerprint = sha256Hex(`${input.storeId}|${input.customerId}|${input.templateId}`)
    const existing = await this.sends.find(input.storeId, input.idempotencyKey)
    if (existing) return this.idempotentResult(existing, fingerprint)
    if (!input.reviewed) throw new AppError('VALIDATION_ERROR', 'Merchant review is required before sending', 400, { reviewed: false })
    const checked = await this.validateAfterPlan(input)
    const suppression = await this.sends.suppressed(input.storeId, checked.customer.id)
    const reserved = await this.sends.reserve({ storeId: input.storeId, jobId: input.idempotencyKey, customerId: checked.customer.id, templateId: checked.template.id, fingerprint, campaignName: checked.template.name, quotaLimit: limitForPlan(account.plan, 'email_sends_month') })
    if (!reserved.created) return this.idempotentResult(reserved.send, fingerprint)
    if (suppression) return this.finish(input.storeId, reserved.send, 'suppressed', null, suppressionReason(suppression))

    // Consent and suppression are checked again after the idempotent quota/send
    // reservation and immediately before transport use.
    const current = await this.customers.get(input.storeId, checked.customer.id)
    if (!current?.email || current.marketingState !== 'subscribed') return this.finish(input.storeId, reserved.send, 'suppressed', null, current?.emailDisabledReason ?? 'Customer marketing consent changed before send')
    const secondSuppression = await this.sends.suppressed(input.storeId, checked.customer.id)
    if (secondSuppression) return this.finish(input.storeId, reserved.send, 'suppressed', null, suppressionReason(secondSuppression))
    const rendered = this.render(current, checked.template, checked.merchant, checked.shopDomain, input.storeId, input.idempotencyKey)
    const sender = new BatchSender(
      { send: async (message) => this.email.sendCampaign(input.storeId, { to: message.to, subject: message.subject, html: message.html, ...(message.headers ? { headers: message.headers } : {}) }) },
      new SuppressionLedger(),
      new InMemorySendLedger(),
      1,
    )
    const batch = await sender.send([{ shopId: input.storeId, recipientKey: current.id, jobId: input.idempotencyKey, messageId: input.idempotencyKey, to: current.email, from: checked.merchant.merchantEmail, fromName: checked.merchant.fromName, subject: rendered.subject, html: rendered.body, headers: { 'List-Unsubscribe': `<${this.unsubscribeUrl(input.storeId, input.idempotencyKey)}>` } }])
    if (batch.sent === 1) return this.finish(input.storeId, reserved.send, 'sent', batch.messageIds[0] ?? null, null)
    if (batch.suppressed === 1) return this.finish(input.storeId, reserved.send, 'suppressed', null, 'Recipient is suppressed')
    return this.finish(input.storeId, reserved.send, 'failed', null, 'Email provider did not accept the message')
  }

  public async unsubscribe(token: string): Promise<Readonly<{ status: 'unsubscribed'; alreadySuppressed: boolean }>> {
    const parsed = this.verifyUnsubscribeToken(token)
    const result = await this.sends.unsubscribe(parsed.storeId, parsed.jobId)
    return { status: 'unsubscribed', alreadySuppressed: result.alreadySuppressed }
  }

  private async validate(input: TargetedCampaignInput) { await this.requireGrowth(input.storeId); assertSendInput(input); return this.validateAfterPlan(input) }

  private async validateAfterPlan(input: TargetedCampaignInput): Promise<Readonly<{ customer: CustomerView; template: CampaignTemplate; merchant: MerchantEmailConfig; shopDomain: string }>> {
    if (!this.appBaseUrl) throw new AppError('DEPENDENCY_ERROR', 'Campaign application URL is not configured', 503)
    const [customer, template, merchant, shopDomain] = await Promise.all([this.customers.get(input.storeId, input.customerId), this.templates.get(input.storeId, input.templateId), this.merchantConfigs.get(input.storeId), this.storeDomain(input.storeId)])
    if (!customer) throw new AppError('NOT_FOUND', 'Campaign recipient customer was not found', 404)
    if (!customer.email) throw new AppError('VALIDATION_ERROR', customer.emailDisabledReason ?? 'Customer email is unavailable', 400, { customerId: customer.id, canEmail: false })
    if (customer.marketingState !== 'subscribed') throw new AppError('FORBIDDEN', customer.emailDisabledReason ?? 'Customer is not subscribed to email marketing', 403, { customerId: customer.id, canEmail: false, marketingState: customer.marketingState })
    if (!template || template.storeId !== input.storeId) throw new AppError('NOT_FOUND', 'Tenant-scoped campaign template was not found', 404)
    const compiled = compileTemplate({ id: template.id, storeId: template.storeId, name: template.name, kind: template.kind, subject: template.subject, body: template.body })
    if (compiled.kind !== 'EMAIL') throw new AppError('VALIDATION_ERROR', 'Targeted customer sends require an EMAIL template', 400)
    if (!compiled.body.includes('{{unsubscribe.url}}')) throw new AppError('VALIDATION_ERROR', 'Email template must contain an unsubscribe URL', 400)
    if (!merchant?.verified) throw new AppError('FORBIDDEN', 'Merchant sender email must be verified before campaign sending', 403, { senderVerified: false })
    if (!shopDomain) throw new AppError('DEPENDENCY_ERROR', 'Shopify store domain is unavailable', 503)
    this.merchantVerifier.hydrate(merchant)
    return { customer, template: compiled, merchant, shopDomain }
  }

  private render(customer: CustomerView, template: CampaignTemplate, merchant: MerchantEmailConfig, shopDomain: string, storeId: StoreId, jobId: string) {
    const context: Record<string, string | number> = {
      'unsubscribe.url': this.unsubscribeUrl(storeId, jobId),
      'campaign.name': cleanVariable(template.name),
      'store.name': cleanVariable(merchant.fromName),
      'store.url': `https://${shopDomain}`,
    }
    if (customer.firstName) context['customer.first_name'] = cleanVariable(customer.firstName)
    if (customer.totalSpent !== null && customer.currency) context['customer.lifetime_value'] = `${customer.totalSpent} ${customer.currency}`
    return renderTemplate(template, context)
  }

  private unsubscribeUrl(storeId: StoreId, jobId: string): string {
    if (!this.appBaseUrl) throw new AppError('DEPENDENCY_ERROR', 'Campaign application URL is not configured', 503)
    const expiresAt = this.now() + 365 * 24 * 60 * 60_000
    const payload = `${storeId}|${jobId}|${expiresAt}`
    const token = Buffer.from(`${payload}|${hmacSha256Hex(this.unsubscribeSecret, payload)}`, 'utf8').toString('base64url')
    return `${this.appBaseUrl}/campaigns/unsubscribe?token=${encodeURIComponent(token)}`
  }

  private verifyUnsubscribeToken(token: string): Readonly<{ storeId: StoreId; jobId: string }> {
    let decoded = ''
    try { decoded = Buffer.from(token, 'base64url').toString('utf8') } catch { /* validation below */ }
    const [storeId, jobId, expiresRaw, signature, ...rest] = decoded.split('|')
    const expiresAt = Number(expiresRaw)
    const payload = `${storeId}|${jobId}|${expiresAt}`
    if (rest.length > 0 || !storeId || !jobId || !signature || !Number.isFinite(expiresAt) || expiresAt <= this.now() || !safeEqualHex(signature, hmacSha256Hex(this.unsubscribeSecret, payload))) throw new AppError('VALIDATION_ERROR', 'Invalid or expired campaign unsubscribe link', 400)
    return { storeId: storeId as StoreId, jobId }
  }

  private async requireGrowth(storeId: StoreId) {
    const account = await this.billing.get(storeId)
    const plan = account?.plan ?? 'trial'
    if (!planAtLeast(plan, 'growth')) { await this.audit.locked(storeId, plan); throw new AppError('FORBIDDEN', 'Upgrade to Growth to send targeted customer email', 403, { locked: true, feature: 'targeted_customer_email', required_plan: 'growth' }) }
    if (account && isReadOnly(account.state)) throw new AppError('FORBIDDEN', 'Billing account is read-only; campaign sending is disabled', 403, { reason: 'ACCOUNT_READ_ONLY' })
    return account ?? { plan: 'trial' as const, state: 'TRIAL_LIMITED' as const, currentPeriodEnd: null, version: 0, interval: null, chargeId: null }
  }

  private idempotentResult(send: ReservedSend, fingerprint: string): TargetedCampaignResult {
    if (send.fingerprint !== fingerprint) throw new AppError('CONFLICT', 'Idempotency key was already used for a different targeted send', 409, { idempotencyKey: send.jobId })
    if (send.status === 'pending') throw new AppError('CONFLICT', 'Targeted send is already in progress', 409, { idempotencyKey: send.jobId })
    return { status: send.status, jobId: send.jobId, campaignId: send.campaignId, customerId: send.customerId, templateId: send.templateId, providerMessageId: send.providerMessageId, idempotent: true, reason: send.reason }
  }

  private async finish(storeId: StoreId, send: ReservedSend, status: CampaignDeliveryStatus, providerMessageId: string | null, reason: string | null): Promise<TargetedCampaignResult> {
    const finished = await this.sends.finish(storeId, send.jobId, status, providerMessageId, reason)
    return { status, jobId: finished.jobId, campaignId: finished.campaignId, customerId: finished.customerId, templateId: finished.templateId, providerMessageId: finished.providerMessageId, idempotent: false, reason: finished.reason }
  }
}

function assertSendInput(input: TargetedCampaignInput): void {
  if (!input.customerId.trim() || input.customerId.length > 300) throw new AppError('VALIDATION_ERROR', 'A valid customerId is required', 400)
  if (!input.templateId.trim() || input.templateId.length > 200) throw new AppError('VALIDATION_ERROR', 'A valid templateId is required', 400)
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)) throw new AppError('VALIDATION_ERROR', 'A valid idempotencyKey is required', 400)
}
function suppressionReason(reason: string): string { return reason === 'UNSUBSCRIBED' ? 'Customer unsubscribed' : reason === 'BOUNCED' ? 'Customer email previously bounced' : reason === 'COMPLAINT' ? 'Customer reported an email complaint' : 'Customer is suppressed for a legal request' }
function cleanVariable(value: string): string { return value.replace(/[<>&"'\r\n]/g, '').trim() }

export class InMemoryCampaignSendStore implements CampaignSendStore {
  private readonly sends = new Map<string, ReservedSend>()
  private readonly suppressions = new Map<string, string>()
  private readonly usage = new Map<string, number>()
  public async find(storeId: StoreId, jobId: string) { return this.sends.get(`${storeId}:${jobId}`) ?? null }
  public async reserve(input: Readonly<{ storeId: StoreId; jobId: string; customerId: string; templateId: string; fingerprint: string; campaignName: string; quotaLimit: number | null }>) { const key = `${input.storeId}:${input.jobId}`; const existing = this.sends.get(key); if (existing) return { send: existing, created: false }; const used = this.usage.get(input.storeId) ?? 0; if (input.quotaLimit !== null && used >= input.quotaLimit) throw new AppError('FORBIDDEN', 'Monthly email send quota reached', 403, { feature: 'email_sends_month', limit: input.quotaLimit, reason: 'QUOTA_REACHED' }); this.usage.set(input.storeId, used + 1); const send: ReservedSend = { jobId: input.jobId, campaignId: randomUUID(), customerId: input.customerId, templateId: input.templateId, fingerprint: input.fingerprint, status: 'pending', providerMessageId: null, reason: null }; this.sends.set(key, send); return { send, created: true } }
  public async suppressed(storeId: StoreId, recipientKey: string) { return this.suppressions.get(`${storeId}:${recipientKey}`) ?? null }
  public async finish(storeId: StoreId, jobId: string, status: CampaignDeliveryStatus, providerMessageId: string | null, reason: string | null) { const key = `${storeId}:${jobId}`; const current = this.sends.get(key); if (!current) throw new Error('Unknown send'); if (current.status !== 'pending') return current; const next: ReservedSend = { ...current, status, providerMessageId, reason }; this.sends.set(key, next); if (status !== 'sent') this.usage.set(storeId, Math.max(0, (this.usage.get(storeId) ?? 1) - 1)); return next }
  public async unsubscribe(storeId: StoreId, jobId: string) { const send = await this.find(storeId, jobId); if (!send) throw new AppError('NOT_FOUND', 'Campaign unsubscribe link was not found', 404); const key = `${storeId}:${send.customerId}`; const alreadySuppressed = this.suppressions.has(key); this.suppressions.set(key, 'UNSUBSCRIBED'); return { alreadySuppressed } }
  public suppress(storeId: StoreId, customerId: string, reason = 'UNSUBSCRIBED') { this.suppressions.set(`${storeId}:${customerId}`, reason) }
  public used(storeId: StoreId) { return this.usage.get(storeId) ?? 0 }
}
