import { AppError } from '@profitpilot/types'

export type AutomationMode = 'MANUAL' | 'SEMI_AUTOMATIC' | 'FULLY_AUTOMATIC'
export type AutomationPolicy = Readonly<{ mode: AutomationMode; explicitOptIn: boolean; perRunCap: number; perDayCap: number; highRiskConfirmation: boolean }>
export type AutomationAction = 'EMAIL' | 'SMS' | 'TAG' | 'DISCOUNT' | 'WAIT'

export const DEFAULT_POLICY: AutomationPolicy = { mode: 'MANUAL', explicitOptIn: false, perRunCap: 10, perDayCap: 50, highRiskConfirmation: true }

export function canAutoExecute(policy: AutomationPolicy, action: AutomationAction, approved: boolean): boolean {
  if (action === 'WAIT' || action === 'TAG') return policy.mode !== 'MANUAL' || approved
  if (action === 'EMAIL' || action === 'SMS' || action === 'DISCOUNT') return approved && (policy.mode !== 'FULLY_AUTOMATIC' || policy.explicitOptIn)
  return false
}

export function assertPolicy(policy: AutomationPolicy, action: AutomationAction, approved: boolean, runCount: number, dayCount: number): void {
  if (policy.perRunCap < 1 || policy.perDayCap < 1) throw new AppError('VALIDATION_ERROR', 'Automation safety caps must be positive', 400)
  if (!canAutoExecute(policy, action, approved)) throw new AppError('FORBIDDEN', 'Automation policy requires merchant approval', 403, { action, mode: policy.mode })
  if (runCount >= policy.perRunCap || dayCount >= policy.perDayCap) throw new AppError('RATE_LIMITED', 'Automation safety cap reached', 429, { action, runCount, dayCount })
}
