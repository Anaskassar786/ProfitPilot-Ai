import { AppError } from '@profitpilot/types'
import type { WorkflowAction, WorkflowNode } from './workflows.js'

export type AutomationMode = 'MANUAL' | 'SEMI_AUTOMATIC' | 'FULLY_AUTOMATIC'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type AutomationPolicy = Readonly<{ mode: AutomationMode; explicitOptIn: boolean; perRunCap: number; perDayCap: number; highRiskConfirmation: boolean; emailPerRunCap?: number; inventoryAdjustmentCap?: number }>
export type AutomationAction = 'EMAIL' | 'TAG_CUSTOMER' | 'CREATE_DISCOUNT' | 'INTERNAL_NOTIFICATION' | 'UPDATE_INVENTORY' | 'WAIT'

export const DEFAULT_POLICY: AutomationPolicy = { mode: 'MANUAL', explicitOptIn: false, perRunCap: 10, perDayCap: 100, highRiskConfirmation: true, emailPerRunCap: 100, inventoryAdjustmentCap: 1_000 }

export function riskForAction(action: WorkflowAction, payload: Readonly<Record<string, unknown>> = {}): RiskLevel {
  if (action === 'tag_customer' || action === 'internal_notification' || action === 'update_inventory') return 'LOW'
  if (action === 'email') return Number(payload.recipientCount ?? 1) > 1 ? 'HIGH' : 'MEDIUM'
  return 'HIGH'
}

export function canAutoExecute(policy: AutomationPolicy, action: AutomationAction, approved: boolean, risk: RiskLevel = action === 'EMAIL' ? 'MEDIUM' : action === 'CREATE_DISCOUNT' ? 'HIGH' : 'LOW'): boolean {
  if (policy.mode === 'MANUAL') return approved
  if (risk === 'HIGH') return approved
  if (risk === 'MEDIUM') return approved || (policy.mode === 'FULLY_AUTOMATIC' && policy.explicitOptIn)
  return true
}

export function assertPolicy(policy: AutomationPolicy, action: AutomationAction, approved: boolean, runCount: number, dayCount: number, risk?: RiskLevel): void {
  if (policy.perRunCap < 1 || policy.perDayCap < 1) throw new AppError('VALIDATION_ERROR', 'Automation safety caps must be positive', 400)
  if (!canAutoExecute(policy, action, approved, risk)) throw new AppError('FORBIDDEN', 'Automation policy requires merchant approval', 403, { action, mode: policy.mode })
  if (runCount >= policy.perRunCap || dayCount >= policy.perDayCap) throw new AppError('RATE_LIMITED', 'Automation safety cap reached', 429, { action, runCount, dayCount })
}

export function validateActionCaps(node: WorkflowNode, policy: AutomationPolicy = DEFAULT_POLICY): void {
  if (node.type !== 'action') return
  if (node.config.action === 'email' && typeof node.config.maxRecipients === 'number' && node.config.maxRecipients > (policy.emailPerRunCap ?? 100)) throw new AppError('VALIDATION_ERROR', 'Email recipient cap cannot exceed 100 per run', 400, { nodeId: node.id })
  if (node.config.action === 'create_discount' && (typeof node.config.amount !== 'number' || node.config.amount < 1 || node.config.amount > 50)) throw new AppError('VALIDATION_ERROR', 'Discount must be between 1 and 50 percent', 400, { nodeId: node.id })
  if (node.config.action === 'update_inventory' && (typeof node.config.adjustment !== 'number' || Math.abs(node.config.adjustment) > (policy.inventoryAdjustmentCap ?? 1_000))) throw new AppError('VALIDATION_ERROR', 'Inventory adjustment exceeds the workflow safety cap', 400, { nodeId: node.id })
}
