import type { SqlExecutor, QueryResultRow } from '@profitpilot/db'
import type { CampaignTemplate } from './campaigns.js'
import type { ActivatedWorkflow, WorkflowDefinition } from './workflows.js'

export interface WorkflowRepository { put(definition: WorkflowDefinition): Promise<void>; get(id: string): Promise<WorkflowDefinition | null>; activate(workflow: ActivatedWorkflow): Promise<void>; list(storeId: string): Promise<readonly WorkflowDefinition[]> }
export interface TemplateRepository { put(template: CampaignTemplate): Promise<void>; list(): Promise<readonly CampaignTemplate[]> }

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
  public async put(template: CampaignTemplate): Promise<void> { this.templates.set(template.id, template) }
  public async list(): Promise<readonly CampaignTemplate[]> { return [...this.templates.values()] }
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
  public async put(template: CampaignTemplate): Promise<void> { await this.executor.query(`INSERT INTO campaign_templates (id, store_id, name, kind, subject, body, variables) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, subject = EXCLUDED.subject, body = EXCLUDED.body, variables = EXCLUDED.variables`, [template.id, template.storeId, template.name, template.kind, template.subject, template.body, JSON.stringify(template.variables)]) }
  public async list(): Promise<readonly CampaignTemplate[]> { const result = await this.executor.query<TemplateRow>('SELECT id, store_id, name, kind, subject, body, variables FROM campaign_templates ORDER BY created_at DESC'); return result.rows.map((row) => ({ id: row.id, storeId: row.store_id, name: row.name, kind: row.kind, subject: row.subject, body: row.body, variables: row.variables as CampaignTemplate['variables'] })) }
}
