import type { SqlExecutor, QueryResultRow } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import type { CampaignTemplate } from './campaigns.js'
import type { MerchantEmailConfig } from './email.js'
import type { ActivatedWorkflow, WorkflowDefinition } from './workflows.js'

export interface WorkflowRepository { put(definition: WorkflowDefinition): Promise<void>; get(id: string): Promise<WorkflowDefinition | null>; activate(workflow: ActivatedWorkflow): Promise<void>; list(storeId: string): Promise<readonly WorkflowDefinition[]> }
export interface TemplateRepository { put(template: CampaignTemplate): Promise<void>; get(storeId: string, id: string): Promise<CampaignTemplate | null>; list(storeId?: string): Promise<readonly CampaignTemplate[]> }
export interface MerchantEmailConfigRepository { put(config: MerchantEmailConfig): Promise<void>; get(storeId: string): Promise<MerchantEmailConfig | null> }

export class InMemoryWorkflowRepository implements WorkflowRepository {
  private readonly drafts = new Map<string, WorkflowDefinition>()
  private readonly active = new Map<string, ActivatedWorkflow>()
  public async put(definition: WorkflowDefinition): Promise<void> { this.drafts.set(definition.id, definition) }
  public async get(id: string): Promise<WorkflowDefinition | null> { return this.drafts.get(id) ?? null }
  public async activate(workflow: ActivatedWorkflow): Promise<void> { this.active.set(workflow.id, workflow); this.drafts.set(workflow.id, workflow) }
  public async list(storeId: string): Promise<readonly WorkflowDefinition[]> { return [...this.drafts.values()].filter((workflow) => workflow.storeId === storeId) }
  public activeFor(id: string): ActivatedWorkflow | null { return this.active.get(id) ?? null }
}

export class InMemoryTemplateRepository implements TemplateRepository {
  private readonly templates = new Map<string, CampaignTemplate>()
  public async put(template: CampaignTemplate): Promise<void> { this.templates.set(`${template.storeId}:${template.id}`, template) }
  public async get(storeId: string, id: string): Promise<CampaignTemplate | null> { return this.templates.get(`${storeId}:${id}`) ?? null }
  public async list(storeId?: string): Promise<readonly CampaignTemplate[]> { return [...this.templates.values()].filter((template) => storeId === undefined || template.storeId === storeId) }
}

export class InMemoryMerchantEmailConfigRepository implements MerchantEmailConfigRepository {
  private readonly configs = new Map<string, MerchantEmailConfig>()
  public async put(config: MerchantEmailConfig): Promise<void> { this.configs.set(config.shopId, { ...config }) }
  public async get(storeId: string): Promise<MerchantEmailConfig | null> { return this.configs.get(storeId) ?? null }
}

type WorkflowRow = QueryResultRow & { id: string; store_id: string; version: number; definition: unknown; definition_hash: string | null; status: string }
type TemplateRow = QueryResultRow & { id: string; store_id: string; name: string; kind: 'EMAIL' | 'SMS'; subject: string; body: string; variables: readonly string[] }

export class PostgresWorkflowRepository implements WorkflowRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async put(definition: WorkflowDefinition): Promise<void> { await this.executor.query(`INSERT INTO workflows (id, store_id, version, definition_hash, definition, status) VALUES ($1, $2, $3, '', $4::jsonb, 'DRAFT') ON CONFLICT (store_id, id, version) DO UPDATE SET definition = EXCLUDED.definition`, [definition.id, definition.storeId, definition.version, JSON.stringify(definition)]) }
  public async get(id: string): Promise<WorkflowDefinition | null> { const result = await this.executor.query<WorkflowRow>('SELECT id, store_id, version, definition, definition_hash, status FROM workflows WHERE id = $1 ORDER BY version DESC LIMIT 1', [id]); const row = result.rows[0]; return row ? row.definition as WorkflowDefinition : null }
  public async activate(workflow: ActivatedWorkflow): Promise<void> { await this.executor.query(`INSERT INTO workflows (id, store_id, version, definition_hash, definition, status, activated_at) VALUES ($1, $2, $3, $4, $5::jsonb, 'ACTIVE', $6) ON CONFLICT (store_id, id, version) DO UPDATE SET status = 'ACTIVE', definition_hash = EXCLUDED.definition_hash, activated_at = EXCLUDED.activated_at`, [workflow.id, workflow.storeId, workflow.version, workflow.definitionHash, JSON.stringify(workflow), workflow.activatedAt]) }
  public async list(storeId: string): Promise<readonly WorkflowDefinition[]> { const result = await this.executor.query<WorkflowRow>('SELECT id, store_id, version, definition, definition_hash, status FROM workflows WHERE store_id = $1 ORDER BY created_at DESC', [storeId]); return result.rows.map((row) => row.definition as WorkflowDefinition) }
}

export class PostgresTemplateRepository implements TemplateRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }
  public async put(template: CampaignTemplate): Promise<void> { await withTenantContext(this.executor, template.storeId, async (client) => { await client.query(`INSERT INTO campaign_templates (id, store_id, name, kind, subject, body, variables) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, subject = EXCLUDED.subject, body = EXCLUDED.body, variables = EXCLUDED.variables WHERE campaign_templates.store_id = EXCLUDED.store_id`, [template.id, template.storeId, template.name, template.kind, template.subject, template.body, JSON.stringify(template.variables)]) }) }
  public async get(storeId: string, id: string): Promise<CampaignTemplate | null> { return withTenantContext(this.executor, storeId, async (client) => { const result = await client.query<TemplateRow>('SELECT id, store_id, name, kind, subject, body, variables FROM campaign_templates WHERE store_id = $1 AND id = $2 LIMIT 1', [storeId, id]); const row = result.rows[0]; return row ? toTemplate(row) : null }) }
  public async list(storeId?: string): Promise<readonly CampaignTemplate[]> { if (!storeId) return []; return withTenantContext(this.executor, storeId, async (client) => { const result = await client.query<TemplateRow>('SELECT id, store_id, name, kind, subject, body, variables FROM campaign_templates WHERE store_id = $1 ORDER BY created_at DESC', [storeId]); return result.rows.map(toTemplate) }) }
}

export class PostgresMerchantEmailConfigRepository implements MerchantEmailConfigRepository {
  public constructor(private readonly executor: SqlExecutor) {}
  public put(config: MerchantEmailConfig): Promise<void> { return withTenantContext(this.executor, config.shopId, async (client) => { await client.query(`INSERT INTO merchant_email_configs (store_id, merchant_email, from_name, verified, verification_sent_at, verified_at) VALUES ($1, $2, $3, $4, CASE WHEN $5::bigint IS NULL THEN NULL ELSE to_timestamp($5 / 1000.0) END, CASE WHEN $6::bigint IS NULL THEN NULL ELSE to_timestamp($6 / 1000.0) END) ON CONFLICT (store_id) DO UPDATE SET merchant_email = EXCLUDED.merchant_email, from_name = EXCLUDED.from_name, verified = EXCLUDED.verified, verification_sent_at = EXCLUDED.verification_sent_at, verified_at = EXCLUDED.verified_at`, [config.shopId, config.merchantEmail, config.fromName, config.verified, config.verificationSentAt, config.verifiedAt]) }) }
  public get(storeId: string): Promise<MerchantEmailConfig | null> { return withTenantContext(this.executor, storeId, async (client) => { const result = await client.query<QueryResultRow & { store_id: string; merchant_email: string; from_name: string; verified: boolean; verification_sent_at: Date | null; verified_at: Date | null }>('SELECT store_id, merchant_email, from_name, verified, verification_sent_at, verified_at FROM merchant_email_configs WHERE store_id = $1 LIMIT 1', [storeId]); const row = result.rows[0]; return row ? { shopId: row.store_id, merchantEmail: row.merchant_email, fromName: row.from_name, verified: row.verified, verificationSentAt: row.verification_sent_at?.valueOf() ?? null, verifiedAt: row.verified_at?.valueOf() ?? null } : null }) }
}

function toTemplate(row: TemplateRow): CampaignTemplate { return { id: row.id, storeId: row.store_id, name: row.name, kind: row.kind, subject: row.subject, body: row.body, variables: row.variables as CampaignTemplate['variables'] } }
