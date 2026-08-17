import type { StoreId } from '@profitpilot/types'
import type { QueryResultRow, SqlExecutor } from '@profitpilot/db'
import type { AgentId } from './domain.js'

export type AgentSettings = Readonly<{ agent: AgentId; paused: boolean; updatedAt: number }>

/** Per-store agent settings — currently just pause/resume, persisted so the PAUSED status survives restarts. */
export interface AgentSettingsRepository {
  forStore(storeId: StoreId): Promise<ReadonlyMap<AgentId, AgentSettings>>
  setPaused(storeId: StoreId, agent: AgentId, paused: boolean, now?: number): Promise<AgentSettings>
}

export class InMemoryAgentSettingsRepository implements AgentSettingsRepository {
  private readonly records = new Map<string, AgentSettings>()

  public async forStore(storeId: StoreId): Promise<ReadonlyMap<AgentId, AgentSettings>> {
    const map = new Map<AgentId, AgentSettings>()
    for (const [key, value] of this.records) {
      if (key.startsWith(`${storeId}::`)) map.set(value.agent, value)
    }
    return map
  }

  public async setPaused(storeId: StoreId, agent: AgentId, paused: boolean, now = Date.now()): Promise<AgentSettings> {
    const settings: AgentSettings = { agent, paused, updatedAt: now }
    this.records.set(`${storeId}::${agent}`, settings)
    return settings
  }
}

type SettingsRow = QueryResultRow & { agent: AgentId; paused: boolean; updated_at: Date | string }

export class PostgresAgentSettingsRepository implements AgentSettingsRepository {
  private readonly executor: SqlExecutor
  public constructor(executor: SqlExecutor) { this.executor = executor }

  public async forStore(storeId: StoreId): Promise<ReadonlyMap<AgentId, AgentSettings>> {
    const result = await this.executor.query<SettingsRow>('SELECT agent, paused, updated_at FROM ai_agent_settings WHERE store_id = $1', [storeId])
    return new Map(result.rows.map((row) => [row.agent, { agent: row.agent, paused: row.paused, updatedAt: new Date(row.updated_at).valueOf() }]))
  }

  public async setPaused(storeId: StoreId, agent: AgentId, paused: boolean, now = Date.now()): Promise<AgentSettings> {
    await this.executor.query('INSERT INTO ai_agent_settings (store_id, agent, paused, updated_at) VALUES ($1, $2, $3, to_timestamp($4 / 1000.0)) ON CONFLICT (store_id, agent) DO UPDATE SET paused = EXCLUDED.paused, updated_at = EXCLUDED.updated_at', [storeId, agent, paused, now])
    return { agent, paused, updatedAt: now }
  }
}
