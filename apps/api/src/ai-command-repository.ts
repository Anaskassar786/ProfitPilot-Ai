import { randomUUID } from 'node:crypto'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import { withTenantContext } from '@profitpilot/db'
import { AppError } from '@profitpilot/types'
import type { StoreId } from '@profitpilot/types'
import {
  applyUsageLimits,
  defaultCommandPreferences,
  emptyUsage,
} from '@profitpilot/ai'
import type {
  AiCommandActionRecord,
  AiCommandActionStatus,
  AiCommandActionType,
  AiCommandConversation,
  AiCommandConversationStatus,
  AiCommandMessage,
  AiCommandPreferences,
  AiCommandRepository,
  AiCommandResponseStyle,
  AiCommandSavedCommand,
  AiCommandUsage,
} from '@profitpilot/ai'
import type { PlanTier } from '@profitpilot/types'

type ConversationRow = QueryResultRow & {
  id: string; store_id: string; title: string; messages: unknown; context: unknown; status: string
  created_at: Date; updated_at: Date; last_message_at: Date
}
type ActionRow = QueryResultRow & {
  id: string; store_id: string; conversation_id: string | null; action_type: string; action_params: unknown
  action_preview: unknown; merchant_approved: boolean; approved_at: Date | null; execution_status: string
  execution_result: unknown; error_details: unknown; rollback_available: boolean; rollback_deadline: Date | null
  rolled_back_at: Date | null; created_at: Date; completed_at: Date | null
}
type SavedRow = QueryResultRow & {
  id: string; store_id: string; name: string; command_text: string; category: string; use_count: number
  last_used_at: Date | null; created_at: Date
}
type UsageRow = QueryResultRow & {
  store_id: string; usage_date: Date | string; commands_used: number; actions_executed: number
  tokens_used: number; cost_micro_dollars: number
}
type PreferenceRow = QueryResultRow & {
  store_id: string; default_response_style: string; quick_commands_enabled: boolean
  auto_suggestions_enabled: boolean; thinking_animation_enabled: boolean
  conversation_memory_enabled: boolean; notification_on_action_complete: boolean
  created_at: Date; updated_at: Date
}

export class PostgresAiCommandRepository implements AiCommandRepository {
  public constructor(private readonly executor: SqlExecutor, private readonly planFor: (storeId: StoreId) => Promise<PlanTier>) {}

  public createConversation(conversation: AiCommandConversation): Promise<AiCommandConversation> {
    return this.scoped(conversation.storeId, async (client) => {
      await client.query(
        `INSERT INTO ai_command_conversations (id, store_id, title, messages, context, status, created_at, updated_at, last_message_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)`,
        [conversation.id, conversation.storeId, conversation.title, JSON.stringify(conversation.messages), JSON.stringify(conversation.context), conversation.status, conversation.createdAt, conversation.updatedAt, conversation.lastMessageAt],
      )
      return conversation
    })
  }

  public getConversation(storeId: StoreId, id: string): Promise<AiCommandConversation | null> {
    return this.scoped(storeId, async (client) => {
      const result = await client.query<ConversationRow>('SELECT * FROM ai_command_conversations WHERE store_id = $1 AND id = $2 LIMIT 1', [storeId, id])
      return result.rows[0] ? toConversation(result.rows[0]) : null
    })
  }

  public listConversations(storeId: StoreId, limit = 20): Promise<readonly AiCommandConversation[]> {
    return this.scoped(storeId, async (client) => {
      const result = await client.query<ConversationRow>('SELECT * FROM ai_command_conversations WHERE store_id = $1 ORDER BY last_message_at DESC LIMIT $2', [storeId, limit])
      return result.rows.map(toConversation)
    })
  }

  public saveConversation(conversation: AiCommandConversation): Promise<AiCommandConversation> {
    return this.scoped(conversation.storeId, async (client) => {
      await client.query(
        `INSERT INTO ai_command_conversations (id, store_id, title, messages, context, status, created_at, updated_at, last_message_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, messages = EXCLUDED.messages, context = EXCLUDED.context, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, last_message_at = EXCLUDED.last_message_at`,
        [conversation.id, conversation.storeId, conversation.title, JSON.stringify(conversation.messages), JSON.stringify(conversation.context), conversation.status, conversation.createdAt, conversation.updatedAt, conversation.lastMessageAt],
      )
      return conversation
    })
  }

  public deleteConversation(storeId: StoreId, id: string): Promise<boolean> {
    return this.scoped(storeId, async (client) => {
      const result = await client.query('DELETE FROM ai_command_conversations WHERE store_id = $1 AND id = $2', [storeId, id])
      return result.rowCount > 0
    })
  }

  public createAction(action: AiCommandActionRecord): Promise<AiCommandActionRecord> {
    return this.saveAction(action)
  }

  public getAction(storeId: StoreId, id: string): Promise<AiCommandActionRecord | null> {
    return this.scoped(storeId, async (client) => {
      const result = await client.query<ActionRow>('SELECT * FROM ai_command_actions WHERE store_id = $1 AND id = $2 LIMIT 1', [storeId, id])
      return result.rows[0] ? toAction(result.rows[0]) : null
    })
  }

  public listActions(storeId: StoreId, limit = 50): Promise<readonly AiCommandActionRecord[]> {
    return this.scoped(storeId, async (client) => {
      const result = await client.query<ActionRow>('SELECT * FROM ai_command_actions WHERE store_id = $1 ORDER BY created_at DESC LIMIT $2', [storeId, limit])
      return result.rows.map(toAction)
    })
  }

  public saveAction(action: AiCommandActionRecord): Promise<AiCommandActionRecord> {
    return this.scoped(action.storeId, async (client) => {
      await client.query(
        `INSERT INTO ai_command_actions (id, store_id, conversation_id, action_type, action_params, action_preview, merchant_approved, approved_at, execution_status, execution_result, error_details, rollback_available, rollback_deadline, rolled_back_at, created_at, completed_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16)
         ON CONFLICT (id) DO UPDATE SET merchant_approved = EXCLUDED.merchant_approved, approved_at = EXCLUDED.approved_at, execution_status = EXCLUDED.execution_status, execution_result = EXCLUDED.execution_result, error_details = EXCLUDED.error_details, rollback_available = EXCLUDED.rollback_available, rollback_deadline = EXCLUDED.rollback_deadline, rolled_back_at = EXCLUDED.rolled_back_at, completed_at = EXCLUDED.completed_at`,
        [action.id, action.storeId, action.conversationId, action.actionType, JSON.stringify(action.actionParams), JSON.stringify(action.actionPreview), action.merchantApproved, action.approvedAt, action.executionStatus, JSON.stringify(action.executionResult), JSON.stringify(action.errorDetails), action.rollbackAvailable, action.rollbackDeadline, action.rolledBackAt, action.createdAt, action.completedAt],
      )
      return action
    })
  }

  public listSaved(storeId: StoreId): Promise<readonly AiCommandSavedCommand[]> {
    return this.scoped(storeId, async (client) => {
      const result = await client.query<SavedRow>('SELECT * FROM ai_command_saved_commands WHERE store_id = $1 ORDER BY created_at DESC', [storeId])
      return result.rows.map(toSaved)
    })
  }

  public getSaved(storeId: StoreId, id: string): Promise<AiCommandSavedCommand | null> {
    return this.scoped(storeId, async (client) => {
      const result = await client.query<SavedRow>('SELECT * FROM ai_command_saved_commands WHERE store_id = $1 AND id = $2 LIMIT 1', [storeId, id])
      return result.rows[0] ? toSaved(result.rows[0]) : null
    })
  }

  public saveCommand(command: AiCommandSavedCommand): Promise<AiCommandSavedCommand> {
    return this.scoped(command.storeId, async (client) => {
      await client.query(
        `INSERT INTO ai_command_saved_commands (id, store_id, name, command_text, category, use_count, last_used_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, command_text = EXCLUDED.command_text, category = EXCLUDED.category, use_count = EXCLUDED.use_count, last_used_at = EXCLUDED.last_used_at`,
        [command.id, command.storeId, command.name, command.commandText, command.category, command.useCount, command.lastUsedAt, command.createdAt],
      )
      return command
    })
  }

  public deleteSaved(storeId: StoreId, id: string): Promise<boolean> {
    return this.scoped(storeId, async (client) => {
      const result = await client.query('DELETE FROM ai_command_saved_commands WHERE store_id = $1 AND id = $2', [storeId, id])
      return result.rowCount > 0
    })
  }

  public async incrementUsage(storeId: StoreId, usageDate: string, delta: Readonly<{ commands?: number; actions?: number; tokens?: number; costMicroDollars?: number }>): Promise<AiCommandUsage> {
    const plan = await this.planFor(storeId)
    return this.scoped(storeId, async (client) => {
      const result = await client.query<UsageRow>(
        `INSERT INTO ai_command_usage (id, store_id, usage_date, commands_used, actions_executed, tokens_used, cost_micro_dollars)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (store_id, usage_date) DO UPDATE SET
           commands_used = ai_command_usage.commands_used + EXCLUDED.commands_used,
           actions_executed = ai_command_usage.actions_executed + EXCLUDED.actions_executed,
           tokens_used = ai_command_usage.tokens_used + EXCLUDED.tokens_used,
           cost_micro_dollars = ai_command_usage.cost_micro_dollars + EXCLUDED.cost_micro_dollars
         RETURNING store_id, usage_date, commands_used, actions_executed, tokens_used, cost_micro_dollars`,
        [randomUUID(), storeId, usageDate, delta.commands ?? 0, delta.actions ?? 0, delta.tokens ?? 0, delta.costMicroDollars ?? 0],
      )
      return toUsage(result.rows[0]!, plan)
    })
  }

  public async getUsage(storeId: StoreId, usageDate: string): Promise<AiCommandUsage> {
    const plan = await this.planFor(storeId)
    return this.scoped(storeId, async (client) => {
      const result = await client.query<UsageRow>('SELECT store_id, usage_date, commands_used, actions_executed, tokens_used, cost_micro_dollars FROM ai_command_usage WHERE store_id = $1 AND usage_date = $2 LIMIT 1', [storeId, usageDate])
      return result.rows[0] ? toUsage(result.rows[0], plan) : emptyUsage(storeId, usageDate, plan)
    })
  }

  public async listUsage(storeId: StoreId, days: number): Promise<readonly AiCommandUsage[]> {
    const plan = await this.planFor(storeId)
    return this.scoped(storeId, async (client) => {
      const result = await client.query<UsageRow>('SELECT store_id, usage_date, commands_used, actions_executed, tokens_used, cost_micro_dollars FROM ai_command_usage WHERE store_id = $1 ORDER BY usage_date DESC LIMIT $2', [storeId, days])
      return result.rows.map((row) => toUsage(row, plan))
    })
  }

  public getPreferences(storeId: StoreId): Promise<AiCommandPreferences> {
    return this.scoped(storeId, async (client) => {
      const result = await client.query<PreferenceRow>('SELECT * FROM ai_command_preferences WHERE store_id = $1 LIMIT 1', [storeId])
      return result.rows[0] ? toPreferences(result.rows[0]) : defaultCommandPreferences(storeId)
    })
  }

  public savePreferences(preferences: AiCommandPreferences): Promise<AiCommandPreferences> {
    return this.scoped(preferences.storeId, async (client) => {
      await client.query(
        `INSERT INTO ai_command_preferences (store_id, default_response_style, quick_commands_enabled, auto_suggestions_enabled, thinking_animation_enabled, conversation_memory_enabled, notification_on_action_complete, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (store_id) DO UPDATE SET default_response_style = EXCLUDED.default_response_style, quick_commands_enabled = EXCLUDED.quick_commands_enabled, auto_suggestions_enabled = EXCLUDED.auto_suggestions_enabled, thinking_animation_enabled = EXCLUDED.thinking_animation_enabled, conversation_memory_enabled = EXCLUDED.conversation_memory_enabled, notification_on_action_complete = EXCLUDED.notification_on_action_complete, updated_at = EXCLUDED.updated_at`,
        [preferences.storeId, preferences.defaultResponseStyle, preferences.quickCommandsEnabled, preferences.autoSuggestionsEnabled, preferences.thinkingAnimationEnabled, preferences.conversationMemoryEnabled, preferences.notificationOnActionComplete, preferences.createdAt, preferences.updatedAt],
      )
      return preferences
    })
  }

  private scoped<Value>(storeId: StoreId, operation: (client: SqlExecutor) => Promise<Value>): Promise<Value> {
    return withTenantOrDirect(this.executor, storeId, operation)
  }
}

function toConversation(row: ConversationRow): AiCommandConversation {
  return {
    id: row.id,
    storeId: row.store_id as StoreId,
    title: row.title,
    messages: Array.isArray(row.messages) ? row.messages as AiCommandMessage[] : [],
    context: isRecord(row.context) ? row.context : {},
    status: row.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE' as AiCommandConversationStatus,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastMessageAt: row.last_message_at.toISOString(),
  }
}

function toAction(row: ActionRow): AiCommandActionRecord {
  return {
    id: row.id,
    storeId: row.store_id as StoreId,
    conversationId: row.conversation_id,
    actionType: row.action_type as AiCommandActionType,
    actionParams: isRecord(row.action_params) ? row.action_params : {},
    actionPreview: row.action_preview,
    merchantApproved: row.merchant_approved,
    approvedAt: row.approved_at?.toISOString() ?? null,
    executionStatus: row.execution_status as AiCommandActionStatus,
    executionResult: row.execution_result,
    errorDetails: row.error_details,
    rollbackAvailable: row.rollback_available,
    rollbackDeadline: row.rollback_deadline?.toISOString() ?? null,
    rolledBackAt: row.rolled_back_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  }
}

function toSaved(row: SavedRow): AiCommandSavedCommand {
  return {
    id: row.id,
    storeId: row.store_id as StoreId,
    name: row.name,
    commandText: row.command_text,
    category: row.category,
    useCount: Number(row.use_count),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  }
}

function toUsage(row: UsageRow, plan: PlanTier): AiCommandUsage {
  const date = row.usage_date instanceof Date ? row.usage_date.toISOString().slice(0, 10) : String(row.usage_date).slice(0, 10)
  return applyUsageLimits({
    storeId: row.store_id as StoreId,
    usageDate: date,
    commandsUsed: Number(row.commands_used),
    actionsExecuted: Number(row.actions_executed),
    tokensUsed: Number(row.tokens_used),
    costMicroDollars: Number(row.cost_micro_dollars),
    limit: null,
    remaining: null,
    actionsEnabled: false,
  }, plan)
}

function toPreferences(row: PreferenceRow): AiCommandPreferences {
  const style = row.default_response_style
  return {
    storeId: row.store_id as StoreId,
    defaultResponseStyle: style === 'DETAILED' || style === 'TECHNICAL' ? style : 'CONCISE' as AiCommandResponseStyle,
    quickCommandsEnabled: row.quick_commands_enabled,
    autoSuggestionsEnabled: row.auto_suggestions_enabled,
    thinkingAnimationEnabled: row.thinking_animation_enabled,
    conversationMemoryEnabled: row.conversation_memory_enabled,
    notificationOnActionComplete: row.notification_on_action_complete,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function withTenantOrDirect<Value>(executor: SqlExecutor, storeId: string, operation: (client: SqlExecutor) => Promise<Value>): Promise<Value> {
  try {
    return await withTenantContext(executor, storeId, operation)
  } catch (scopedError: unknown) {
    try {
      return await operation(executor)
    } catch (directError: unknown) {
      if (directError instanceof AppError) throw directError
      throw new AppError('DEPENDENCY_ERROR', `AI Command storage is unavailable: ${directError instanceof Error ? directError.message : String(directError)}`, 503)
    }
  }
}
