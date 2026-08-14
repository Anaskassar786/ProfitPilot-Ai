import { randomUUID } from 'node:crypto'
import { AppError } from '@profitpilot/types'

export type MaintenanceState = Readonly<{ enabled: boolean; message: string; version: number; updatedBy: string; updatedAt: number }>
export type MerchantFlags = Readonly<{ storeId: string; aiEnabled: boolean; automationEnabled: boolean; suspended: boolean; version: number; updatedBy: string; updatedAt: number }>
export type ControlAuditEvent = Readonly<{ id: string; storeId: string | null; actorId: string; action: 'MAINTENANCE_CHANGED' | 'MERCHANT_FLAGS_CHANGED' | 'JOB_RETRIED' | 'MERCHANT_SUSPENDED'; before: Readonly<Record<string, string | number | boolean | null>>; after: Readonly<Record<string, string | number | boolean | null>>; at: number }>

export interface F9ControlRepository {
  getMaintenance(): Promise<MaintenanceState>
  saveMaintenance(next: MaintenanceState, expectedVersion: number): Promise<boolean>
  getFlags(storeId: string): Promise<MerchantFlags>
  saveFlags(next: MerchantFlags, expectedVersion: number): Promise<boolean>
  appendAudit(event: ControlAuditEvent): Promise<void>
  listAudit(storeId?: string): Promise<readonly ControlAuditEvent[]>
}

export class InMemoryF9ControlRepository implements F9ControlRepository {
  private maintenance: MaintenanceState = { enabled: false, message: 'ProfitPilot is temporarily under maintenance.', version: 0, updatedBy: 'system', updatedAt: 0 }
  private readonly flags = new Map<string, MerchantFlags>()
  private readonly audit: ControlAuditEvent[] = []
  public async getMaintenance(): Promise<MaintenanceState> { return this.maintenance }
  public async saveMaintenance(next: MaintenanceState, expectedVersion: number): Promise<boolean> { if (this.maintenance.version !== expectedVersion) return false; this.maintenance = next; return true }
  public async getFlags(storeId: string): Promise<MerchantFlags> { return this.flags.get(storeId) ?? { storeId, aiEnabled: true, automationEnabled: true, suspended: false, version: 0, updatedBy: 'system', updatedAt: 0 } }
  public async saveFlags(next: MerchantFlags, expectedVersion: number): Promise<boolean> { const current = await this.getFlags(next.storeId); if (current.version !== expectedVersion) return false; this.flags.set(next.storeId, next); return true }
  public async appendAudit(event: ControlAuditEvent): Promise<void> { this.audit.push(event) }
  public async listAudit(storeId?: string): Promise<readonly ControlAuditEvent[]> { return this.audit.filter((event) => storeId === undefined || event.storeId === storeId) }
}

export class F9ControlService {
  private readonly repository: F9ControlRepository
  private readonly now: () => number
  public constructor(repository: F9ControlRepository, now: () => number = () => Date.now()) { this.repository = repository; this.now = now }
  public maintenance(): Promise<MaintenanceState> { return this.repository.getMaintenance() }
  public flags(storeId: string): Promise<MerchantFlags> { return this.repository.getFlags(storeId) }
  public async setMaintenance(input: Readonly<{ enabled: boolean; message: string; actorId: string; expectedVersion: number }>): Promise<MaintenanceState> {
    const current = await this.repository.getMaintenance()
    const next: MaintenanceState = { enabled: input.enabled, message: input.message.trim().slice(0, 500) || 'ProfitPilot is temporarily under maintenance.', version: current.version + 1, updatedBy: input.actorId, updatedAt: this.now() }
    if (!(await this.repository.saveMaintenance(next, input.expectedVersion))) throw new AppError('CONFLICT', 'Maintenance state changed; reload before updating', 409)
    await this.repository.appendAudit({ id: randomUUID(), storeId: null, actorId: input.actorId, action: 'MAINTENANCE_CHANGED', before: { enabled: current.enabled, version: current.version }, after: { enabled: next.enabled, version: next.version, message: next.message }, at: next.updatedAt })
    return next
  }
  public async setFlags(input: Readonly<{ storeId: string; aiEnabled: boolean; automationEnabled: boolean; suspended: boolean; actorId: string; expectedVersion: number }>): Promise<MerchantFlags> {
    const current = await this.repository.getFlags(input.storeId)
    const next: MerchantFlags = { storeId: input.storeId, aiEnabled: input.aiEnabled, automationEnabled: input.automationEnabled, suspended: input.suspended, version: current.version + 1, updatedBy: input.actorId, updatedAt: this.now() }
    if (!(await this.repository.saveFlags(next, input.expectedVersion))) throw new AppError('CONFLICT', 'Merchant flags changed; reload before updating', 409)
    const action = input.suspended ? 'MERCHANT_SUSPENDED' : 'MERCHANT_FLAGS_CHANGED'
    await this.repository.appendAudit({ id: randomUUID(), storeId: input.storeId, actorId: input.actorId, action, before: { aiEnabled: current.aiEnabled, automationEnabled: current.automationEnabled, suspended: current.suspended, version: current.version }, after: { aiEnabled: next.aiEnabled, automationEnabled: next.automationEnabled, suspended: next.suspended, version: next.version }, at: next.updatedAt })
    return next
  }
  public audit(storeId?: string): Promise<readonly ControlAuditEvent[]> { return this.repository.listAudit(storeId) }
}
